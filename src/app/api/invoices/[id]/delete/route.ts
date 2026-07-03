import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";
import { fetchXeroInvoice } from "@/lib/xero/invoices";

/**
 * POST /api/invoices/[id]/delete — delete a DRAFT invoice (Mitchell's
 * suggestion 2026-07-03: "we need to be able to delete draft invoices").
 *
 * Drafts only — anything authorised must be VOIDED in Xero instead so the
 * paper trail survives. When the draft has already been pushed to Xero we
 * re-verify it's still DRAFT there (someone may have authorised it in the
 * Xero UI), mark it DELETED in Xero, then remove the CRM row.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: staffRow } = await supabase.from("staff").select("is_active").eq("id", user.id).maybeSingle();
  if (!staffRow?.is_active) return NextResponse.json({ error: "Staff only" }, { status: 403 });

  const svc = createServiceRoleClient();
  const { data: invoice } = await svc
    .from("invoices")
    .select("id, status, xero_invoice_id, xero_invoice_number")
    .eq("id", id)
    .maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (invoice.status !== "draft") {
    return NextResponse.json(
      { error: `Only draft invoices can be deleted — this one is ${invoice.status}. Void it in Xero instead.` },
      { status: 400 },
    );
  }

  // Xero side first: verify still DRAFT there, then mark DELETED.
  if (invoice.xero_invoice_id) {
    try {
      const { client, conn } = await getAuthedClient(svc);
      const latest = await fetchXeroInvoice(client, conn.tenant_id, invoice.xero_invoice_id);
      if (latest.status.toUpperCase() !== "DRAFT") {
        // Someone authorised/paid it in Xero — sync the local row and refuse.
        await svc
          .from("invoices")
          .update({
            status: latest.status.toLowerCase() === "voided" ? "void" : latest.status.toLowerCase(),
            amount_due: latest.amountDue,
            amount_paid: latest.amountPaid,
            xero_last_synced_at: new Date().toISOString(),
          })
          .eq("id", id);
        return NextResponse.json(
          { error: `Xero says this invoice is ${latest.status}, not draft — status re-synced, nothing deleted.` },
          { status: 409 },
        );
      }
      await client.accountingApi.updateInvoice(conn.tenant_id, invoice.xero_invoice_id, {
        invoices: [{ status: "DELETED" } as Record<string, unknown>],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `Xero delete failed: ${msg}` }, { status: 502 });
    }
  }

  // CRM side: clear dependents, then the invoice row.
  await svc.from("invoice_reminders").delete().eq("invoice_id", id);
  const { error: delErr } = await svc.from("invoices").delete().eq("id", id);
  if (delErr) return NextResponse.json({ error: `CRM delete failed: ${delErr.message}` }, { status: 500 });

  return NextResponse.json({ ok: true, ref: invoice.xero_invoice_number });
}
