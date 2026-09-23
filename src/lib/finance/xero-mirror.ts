import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasDailyHeadroom, xeroDate, xeroDateTime, type XeroRest } from "./xero-rest";

// Local Xero mirror (docs/finance-CONTEXT.md D9): bulk-paged pulls of contacts
// and receivable invoices so matching never spends a Xero call per customer.
// ~25 calls per full refresh; refuses to start a page below the daily floor.

interface XeroContactRow { ContactID: string; Name: string; ContactStatus?: string; EmailAddress?: string; IsCustomer?: boolean; UpdatedDateUTC?: string }
interface XeroInvoiceRow {
  InvoiceID: string; InvoiceNumber?: string; Type: string; Status: string; Date?: string; DueDate?: string;
  Total?: number; AmountDue?: number; AmountPaid?: number; Reference?: string; UpdatedDateUTC?: string;
  Contact?: { ContactID?: string; Name?: string };
}

export interface MirrorSyncResult {
  contacts: number;
  invoices: number;
  pages: number;
  partial: boolean;
  reason?: string;
  dayRemaining: number | null;
}

export async function syncXeroMirror(
  svc: SupabaseClient,
  x: XeroRest,
  opts: { since: string; floor: number; contacts?: boolean },
): Promise<MirrorSyncResult> {
  const out: MirrorSyncResult = { contacts: 0, invoices: 0, pages: 0, partial: false, dayRemaining: null };
  const stop = (reason: string) => { out.partial = true; out.reason = reason; out.dayRemaining = x.limits.dayRemaining; return out; };

  if (opts.contacts !== false) {
    for (let page = 1; page <= 40; page++) {
      if (!hasDailyHeadroom(x, opts.floor)) return stop(`daily headroom below ${opts.floor} before contacts page ${page}`);
      const res = await x.get<{ Contacts?: XeroContactRow[] }>(`Contacts?page=${page}&includeArchived=true`);
      out.pages += 1;
      const rows = res?.Contacts ?? [];
      if (rows.length) {
        const { error } = await svc.from("finance_xero_contacts").upsert(
          rows.map((c) => ({
            contact_id: c.ContactID,
            name: c.Name,
            status: c.ContactStatus ?? null,
            email: c.EmailAddress ?? null,
            is_customer: c.IsCustomer ?? null,
            updated_utc: xeroDateTime(c.UpdatedDateUTC),
            synced_at: new Date().toISOString(),
          })),
          { onConflict: "contact_id" },
        );
        if (error) throw new Error(`mirror contacts upsert: ${error.message}`);
        out.contacts += rows.length;
      }
      if (rows.length < 100) break;
    }
  }

  const [y, m, d] = opts.since.split("-");
  const where = encodeURIComponent(`Type=="ACCREC" AND Date>=DateTime(${y},${m},${d})`);
  for (let page = 1; page <= 60; page++) {
    if (!hasDailyHeadroom(x, opts.floor)) return stop(`daily headroom below ${opts.floor} before invoices page ${page}`);
    const res = await x.get<{ Invoices?: XeroInvoiceRow[] }>(`Invoices?where=${where}&order=Date&page=${page}`);
    out.pages += 1;
    const rows = res?.Invoices ?? [];
    if (rows.length) {
      const { error } = await svc.from("finance_xero_invoices").upsert(
        rows.map((i) => ({
          invoice_id: i.InvoiceID,
          invoice_number: i.InvoiceNumber ?? null,
          contact_id: i.Contact?.ContactID ?? null,
          contact_name: i.Contact?.Name ?? null,
          type: i.Type,
          status: i.Status,
          date: xeroDate(i.Date),
          due_date: xeroDate(i.DueDate),
          total: i.Total ?? null,
          amount_due: i.AmountDue ?? null,
          amount_paid: i.AmountPaid ?? null,
          reference: i.Reference ?? null,
          updated_utc: xeroDateTime(i.UpdatedDateUTC),
          synced_at: new Date().toISOString(),
        })),
        { onConflict: "invoice_id" },
      );
      if (error) throw new Error(`mirror invoices upsert: ${error.message}`);
      out.invoices += rows.length;
    }
    if (rows.length < 100) break;
  }
  out.dayRemaining = x.limits.dayRemaining;
  return out;
}

/** Junk contacts the old bank rule minted ("PAYMENT FROM …") and archived ones never win a match. */
export const isJunkContactName = (name: string, status?: string | null) =>
  /^PAYMENT FROM/i.test(name) || status === "ARCHIVED";

export const normName = (s: string | null | undefined) =>
  String(s ?? "").toLowerCase().replace(/pty\.? ?ltd\.?/g, "").replace(/\bt\/a\b/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
