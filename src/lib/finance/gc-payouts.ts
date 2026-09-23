import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "./audit";
import { getCustomer, getMandate, getPayment, gcCustomerName, listPayoutItems, listPayoutsSince, payoutItemCents } from "./gc";
import { isJunkContactName, normName } from "./xero-mirror";
import { type XeroRest } from "./xero-rest";

// GoCardless payouts → Xero (docs/finance-CONTEXT.md D3, D5–D8, D10).
// ingest → match → plan → (live) post → refresh reconciled. Nothing here
// touches a bank; the only Xero writes are invoice payments and the fee
// spend-money, and only when gc_payouts_mode = 'live'.

export interface FinanceSettings {
  gc_payouts_mode: "off" | "dry_run" | "live";
  stripe_verify_mode: "off" | "dry_run" | "live";
  draft_bills_mode: "off" | "dry_run" | "live";
  paused: boolean;
  bank_account_code: string;
  fee_account_code: string;
  fee_tax_type: string;
  fee_contact_name: string;
  match_window_days: number;
  ingest_since: string;
  xero_day_floor: number;
  viewer_staff_ids: string[];
}

export async function loadSettings(svc: SupabaseClient): Promise<FinanceSettings> {
  const { data, error } = await svc.from("finance_settings").select("*").eq("id", 1).single();
  if (error || !data) throw new Error(`finance_settings missing: ${error?.message}`);
  return data as FinanceSettings;
}

// ---------------------------------------------------------------- ingest
export interface IngestResult { payouts: number; newPayouts: number; items: number; gcCalls: number }

export async function ingestGcPayouts(svc: SupabaseClient, since: string): Promise<IngestResult> {
  const out: IngestResult = { payouts: 0, newPayouts: 0, items: 0, gcCalls: 0 };
  const payouts = await listPayoutsSince(since);
  out.gcCalls += 1;
  out.payouts = payouts.length;
  const { data: existing } = await svc.from("finance_payouts").select("id, provider_payout_id, items_total").eq("provider", "gocardless");
  const known = new Map((existing ?? []).map((r) => [r.provider_payout_id as string, r]));
  const mandateCustomer = new Map<string, string>();

  for (const p of payouts.sort((a, b) => a.arrival_date.localeCompare(b.arrival_date))) {
    const row = known.get(p.id);
    let payoutId = row?.id as string | undefined;
    if (!payoutId) {
      const { data: ins, error } = await svc
        .from("finance_payouts")
        .insert({ provider: "gocardless", provider_payout_id: p.id, arrival_date: p.arrival_date, currency: p.currency, net_cents: p.amount, fee_cents: p.deducted_fees ?? 0, gross_cents: p.amount + (p.deducted_fees ?? 0), status: "new" })
        .select("id")
        .single();
      if (error || !ins) throw new Error(`insert payout ${p.id}: ${error?.message}`);
      payoutId = ins.id as string;
      out.newPayouts += 1;
    } else if ((row?.items_total ?? 0) > 0) {
      continue; // already itemised
    }
    const items = await listPayoutItems(p.id);
    out.gcCalls += 1;
    const rows: Record<string, unknown>[] = [];
    let paymentCount = 0;
    for (const it of items) {
      const cents = payoutItemCents(it);
      if (it.type === "payment_paid_out" && it.links?.payment) {
        const pay = await getPayment(it.links.payment);
        out.gcCalls += 1;
        let customerId: string | null = null;
        const mandateId = pay.links?.mandate ?? null;
        if (mandateId) {
          if (!mandateCustomer.has(mandateId)) {
            const m = await getMandate(mandateId);
            out.gcCalls += 1;
            mandateCustomer.set(mandateId, m.links?.customer ?? "");
          }
          customerId = mandateCustomer.get(mandateId) || null;
        }
        rows.push({
          payout_id: payoutId, provider_payment_id: it.links.payment, item_type: it.type, amount_cents: cents,
          charge_date: pay.charge_date ?? null, description: pay.description ?? null,
          gc_subscription_id: pay.links?.subscription ?? null, gc_mandate_id: mandateId, gc_customer_id: customerId,
          match_status: "unmatched",
        });
        paymentCount += 1;
      } else if (it.type.endsWith("_fee") || it.type === "gocardless_fee" || it.type === "app_fee" || it.type === "surcharge_fee") {
        rows.push({ payout_id: payoutId, provider_payment_id: `${p.id}:${it.type}`, item_type: it.type, amount_cents: cents, match_status: "fee" });
      } else {
        rows.push({ payout_id: payoutId, provider_payment_id: it.links?.refund ?? it.links?.payment ?? `${p.id}:${it.type}:${rows.length}`, item_type: it.type, amount_cents: cents, match_status: it.type.includes("refund") ? "refund" : "skipped" });
      }
    }
    if (rows.length) {
      const { error } = await svc.from("finance_payout_items").upsert(rows, { onConflict: "payout_id,provider_payment_id,item_type", ignoreDuplicates: true });
      if (error) throw new Error(`insert items for ${p.id}: ${error.message}`);
      out.items += rows.length;
    }
    await svc.from("finance_payouts").update({ items_total: paymentCount, updated_at: new Date().toISOString() }).eq("id", payoutId);
  }
  return out;
}

/** Keep finance_gc_customers populated (names/emails) for every GC customer we've seen on a payout. */
export async function upsertSeenGcCustomers(svc: SupabaseClient): Promise<number> {
  const { data: items } = await svc.from("finance_payout_items").select("gc_customer_id").not("gc_customer_id", "is", null);
  const ids = [...new Set((items ?? []).map((r) => r.gc_customer_id as string))];
  const { data: known } = await svc.from("finance_gc_customers").select("gc_customer_id").in("gc_customer_id", ids.length ? ids : ["-"]);
  const have = new Set((known ?? []).map((r) => r.gc_customer_id as string));
  let n = 0;
  for (const id of ids.filter((i) => !have.has(i))) {
    try {
      const c = await getCustomer(id);
      await svc.from("finance_gc_customers").upsert({ gc_customer_id: id, gc_name: gcCustomerName(c), gc_email: c.email ?? null, status: "unlinked" }, { onConflict: "gc_customer_id", ignoreDuplicates: true });
      n += 1;
    } catch (err) {
      console.error("[finance] gc customer fetch failed", id, err instanceof Error ? err.message : err);
    }
  }
  return n;
}

// ----------------------------------------------------------------- match
interface MirrorContact { contact_id: string; name: string; status: string | null }
interface MirrorInvoice { invoice_id: string; invoice_number: string | null; contact_id: string | null; contact_name: string | null; status: string; date: string | null; total: number | null; amount_due: number | null }
interface ItemRow { id: string; payout_id: string; provider_payment_id: string; item_type: string; amount_cents: number; charge_date: string | null; description: string | null; gc_subscription_id: string | null; gc_mandate_id: string | null; gc_customer_id: string | null; match_status: string; resolved_by: string | null }

export interface MatchContext {
  contactsById: Map<string, MirrorContact>;
  contactsByNorm: Map<string, MirrorContact[]>;
  invoicesByContact: Map<string, MirrorInvoice[]>;
  invoiceCarriers: Set<string>; // contact ids with ≥1 ACCREC invoice in the mirror
  gcLinks: Map<string, { site_id: string | null; xero_contact_id: string | null; canonical_name: string | null; status: string; gc_name: string | null }>;
  subToPlan: Map<string, string>;
  plans: Map<string, { id: string; site_id: string | null; customer_id: string | null; gc_customer_id: string | null; gc_mandate_id: string | null; xero_contact_id: string | null }>;
  plansByGcCustomer: Map<string, string[]>;
  plansByMandate: Map<string, string[]>;
  sites: Map<string, { id: string; name: string; xero_contact_id: string | null; customer_id: string | null }>;
  customers: Map<string, { id: string; name: string; xero_contact_id: string | null }>;
  windowDays: number;
}

export async function buildMatchContext(svc: SupabaseClient, windowDays: number): Promise<MatchContext> {
  const [{ data: contacts }, { data: invoices }, { data: gcc }, { data: links }, { data: plans }, { data: sites }, { data: customers }] = await Promise.all([
    svc.from("finance_xero_contacts").select("contact_id, name, status"),
    svc.from("finance_xero_invoices").select("invoice_id, invoice_number, contact_id, contact_name, status, date, total, amount_due").eq("type", "ACCREC"),
    svc.from("finance_gc_customers").select("gc_customer_id, site_id, xero_contact_id, canonical_name, status, gc_name"),
    svc.from("recurring_plan_gc_subscriptions").select("plan_id, gc_subscription_id"),
    svc.from("recurring_plans").select("id, site_id, customer_id, gc_customer_id, gc_mandate_id, gc_subscription_id, gc_subscription_secondary_id, xero_contact_id"),
    svc.from("customer_sites").select("id, name, xero_contact_id, customer_id"),
    svc.from("customers").select("id, name, xero_contact_id"),
  ]);
  const ctx: MatchContext = {
    contactsById: new Map(), contactsByNorm: new Map(), invoicesByContact: new Map(), invoiceCarriers: new Set(),
    gcLinks: new Map(), subToPlan: new Map(), plans: new Map(), plansByGcCustomer: new Map(), plansByMandate: new Map(),
    sites: new Map(), customers: new Map(), windowDays,
  };
  for (const c of (contacts ?? []) as MirrorContact[]) {
    ctx.contactsById.set(c.contact_id, c);
    const k = normName(c.name);
    if (!ctx.contactsByNorm.has(k)) ctx.contactsByNorm.set(k, []);
    ctx.contactsByNorm.get(k)!.push(c);
  }
  for (const i of (invoices ?? []) as MirrorInvoice[]) {
    if (!i.contact_id) continue;
    if (!ctx.invoicesByContact.has(i.contact_id)) ctx.invoicesByContact.set(i.contact_id, []);
    ctx.invoicesByContact.get(i.contact_id)!.push(i);
    if (!["VOIDED", "DELETED", "DRAFT"].includes(i.status)) ctx.invoiceCarriers.add(i.contact_id);
  }
  for (const g of gcc ?? []) ctx.gcLinks.set(g.gc_customer_id as string, { site_id: g.site_id, xero_contact_id: g.xero_contact_id, canonical_name: g.canonical_name, status: g.status, gc_name: g.gc_name });
  for (const l of links ?? []) ctx.subToPlan.set(l.gc_subscription_id as string, l.plan_id as string);
  for (const p of plans ?? []) {
    ctx.plans.set(p.id as string, p as MatchContext["plans"] extends Map<string, infer V> ? V : never);
    for (const s of [p.gc_subscription_id, p.gc_subscription_secondary_id]) if (s && !ctx.subToPlan.has(s as string)) ctx.subToPlan.set(s as string, p.id as string);
    if (p.gc_customer_id) { const k = p.gc_customer_id as string; if (!ctx.plansByGcCustomer.has(k)) ctx.plansByGcCustomer.set(k, []); ctx.plansByGcCustomer.get(k)!.push(p.id as string); }
    if (p.gc_mandate_id) { const k = p.gc_mandate_id as string; if (!ctx.plansByMandate.has(k)) ctx.plansByMandate.set(k, []); ctx.plansByMandate.get(k)!.push(p.id as string); }
  }
  for (const s of sites ?? []) ctx.sites.set(s.id as string, s as { id: string; name: string; xero_contact_id: string | null; customer_id: string | null });
  for (const c of customers ?? []) ctx.customers.set(c.id as string, c as { id: string; name: string; xero_contact_id: string | null });
  return ctx;
}

const UNPAID = new Set(["AUTHORISED", "SUBMITTED"]);
const daysBetween = (a: string, b: string) => Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

interface Resolved { contactId: string | null; contactName: string | null; siteId: string | null; planId: string | null; how: string }

function resolveContact(item: ItemRow, ctx: MatchContext): Resolved {
  // 1. Mitchell's decision (D5)
  const link = item.gc_customer_id ? ctx.gcLinks.get(item.gc_customer_id) : undefined;
  if (link?.status === "linked" && link.xero_contact_id) {
    return { contactId: link.xero_contact_id, contactName: ctx.contactsById.get(link.xero_contact_id)?.name ?? link.canonical_name, siteId: link.site_id, planId: null, how: "gc_customer link" };
  }
  // 2. CRM plan → site/customer stored ids
  let planId = item.gc_subscription_id ? ctx.subToPlan.get(item.gc_subscription_id) ?? null : null;
  if (!planId && item.gc_customer_id) planId = (ctx.plansByGcCustomer.get(item.gc_customer_id) ?? [])[0] ?? null;
  if (!planId && item.gc_mandate_id) planId = (ctx.plansByMandate.get(item.gc_mandate_id) ?? [])[0] ?? null;
  const plan = planId ? ctx.plans.get(planId) : undefined;
  const site = plan?.site_id ? ctx.sites.get(plan.site_id) : undefined;
  const customer = plan?.customer_id ? ctx.customers.get(plan.customer_id) : undefined;
  const stored = plan?.xero_contact_id ?? site?.xero_contact_id ?? customer?.xero_contact_id ?? null;
  if (stored) {
    const c = ctx.contactsById.get(stored);
    // D6: a stored contact that carries no invoices is suspect — fall through to name search, keep it as a hint
    if (c && !isJunkContactName(c.name, c.status) && ctx.invoiceCarriers.has(stored)) return { contactId: stored, contactName: c.name, siteId: site?.id ?? null, planId: planId, how: "stored id" };
  }
  // 3. exact name in the mirror, only if that contact carries invoices (D6)
  for (const name of [site?.name, link?.gc_name, customer?.name].filter(Boolean) as string[]) {
    const cands = (ctx.contactsByNorm.get(normName(name)) ?? []).filter((c) => !isJunkContactName(c.name, c.status) && ctx.invoiceCarriers.has(c.contact_id));
    if (cands.length === 1) return { contactId: cands[0].contact_id, contactName: cands[0].name, siteId: site?.id ?? null, planId, how: `exact name "${name}"` };
  }
  if (stored) {
    const c = ctx.contactsById.get(stored);
    return { contactId: null, contactName: c?.name ?? null, siteId: site?.id ?? null, planId, how: `stored contact "${c?.name ?? stored}" carries no invoices` };
  }
  return { contactId: null, contactName: null, siteId: site?.id ?? null, planId, how: "no contact anywhere" };
}

interface InvoiceMatch { invoiceIds: string[]; numbers: string[]; status: "matched" | "already_paid" | "ambiguous" | "no_invoice"; note: string; amountsCents?: number[] }

function subsetSum(invs: MirrorInvoice[], target: number, maxN = 4): MirrorInvoice[] | null {
  // small sets only (recurring customers have a handful of unpaid invoices)
  const cents = invs.map((i) => Math.round(Number(i.total ?? 0) * 100));
  const n = invs.length;
  const results: MirrorInvoice[][] = [];
  const walk = (start: number, sum: number, picked: number[]) => {
    if (picked.length > maxN || results.length > 3) return;
    if (sum === target && picked.length >= 2) { results.push(picked.map((k) => invs[k])); return; }
    if (sum >= target) return;
    for (let k = start; k < n; k++) walk(k + 1, sum + cents[k], [...picked, k]);
  };
  walk(0, 0, []);
  return results.length === 1 ? results[0] : null;
}

function matchInvoice(item: ItemRow, contactId: string, siblings: ItemRow[], ctx: MatchContext): InvoiceMatch {
  const all = ctx.invoicesByContact.get(contactId) ?? [];
  const charge = item.charge_date ?? new Date().toISOString().slice(0, 10);
  const inWindow = all.filter((i) => i.date && daysBetween(i.date, charge) <= ctx.windowDays && !["VOIDED", "DELETED", "DRAFT"].includes(i.status));
  const cents = (i: MirrorInvoice) => Math.round(Number(i.total ?? 0) * 100);
  const exactUnpaid = inWindow.filter((i) => UNPAID.has(i.status) && cents(i) === item.amount_cents).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  if (exactUnpaid.length >= 1) {
    const pick = exactUnpaid[0]; // oldest unpaid of that amount (D8)
    return { invoiceIds: [pick.invoice_id], numbers: [pick.invoice_number ?? ""], status: "matched", note: exactUnpaid.length > 1 ? `oldest of ${exactUnpaid.length} unpaid invoices for this amount` : "exact amount, unpaid" };
  }
  const exactPaid = inWindow.filter((i) => i.status === "PAID" && cents(i) === item.amount_cents);
  if (exactPaid.length) return { invoiceIds: [exactPaid[0].invoice_id], numbers: [exactPaid[0].invoice_number ?? ""], status: "already_paid", note: `invoice ${exactPaid[0].invoice_number} already PAID in Xero` };
  // one payment = several unpaid invoices (D8)
  const unpaid = inWindow.filter((i) => UNPAID.has(i.status));
  const combo = subsetSum(unpaid, item.amount_cents);
  if (combo) return { invoiceIds: combo.map((i) => i.invoice_id), numbers: combo.map((i) => i.invoice_number ?? ""), status: "matched", note: `one payment covers ${combo.length} invoices (${combo.map((i) => i.invoice_number).join(" + ")})`, amountsCents: combo.map(cents) };
  // several same-day payments = one unpaid invoice (D8)
  const sameDay = siblings.filter((s) => s.charge_date === item.charge_date);
  if (sameDay.length > 1) {
    const sum = sameDay.reduce((t, s) => t + s.amount_cents, 0);
    const hit = unpaid.filter((i) => cents(i) === sum);
    if (hit.length === 1) return { invoiceIds: [hit[0].invoice_id], numbers: [hit[0].invoice_number ?? ""], status: "matched", note: `${sameDay.length} same-day payments sum to invoice ${hit[0].invoice_number}` };
  }
  if (unpaid.length > 1 && unpaid.some((i) => Math.abs(cents(i) - item.amount_cents) <= 5)) return { invoiceIds: [], numbers: [], status: "ambiguous", note: `near-miss amounts on ${unpaid.length} unpaid invoices: ${unpaid.map((i) => `${i.invoice_number} $${Number(i.total).toFixed(2)}`).join(", ")}` };
  const paidSame = inWindow.filter((i) => i.status === "PAID");
  return { invoiceIds: [], numbers: [], status: "no_invoice", note: `no unpaid invoice for $${(item.amount_cents / 100).toFixed(2)} on this contact within ${ctx.windowDays} days of ${charge}${inWindow.length ? ` (${inWindow.length} in window: ${inWindow.slice(0, 4).map((i) => `${i.invoice_number} $${Number(i.total).toFixed(2)} ${i.status}`).join(", ")})` : " (no invoices in window)"}${paidSame.length ? "" : ""}` };
}

export interface MatchResult { payoutId: string; items: number; matched: number; alreadyPaid: number; review: number }

export async function matchPayout(svc: SupabaseClient, payoutId: string, ctx: MatchContext): Promise<MatchResult> {
  const { data: rows } = await svc.from("finance_payout_items").select("*").eq("payout_id", payoutId).eq("item_type", "payment_paid_out");
  const items = (rows ?? []) as ItemRow[];
  const out: MatchResult = { payoutId, items: items.length, matched: 0, alreadyPaid: 0, review: 0 };
  const reviews: { kind: string; title: string; evidence: Record<string, unknown>; payout_item_id: string; gc_customer_id: string | null }[] = [];
  const contactOf = new Map<string, Resolved>();
  for (const it of items) contactOf.set(it.id, resolveContact(it, ctx));

  for (const it of items) {
    if (it.match_status === "matched_manual" || it.resolved_by) { out.matched += 1; continue; } // a human decided — keep it
    const r = contactOf.get(it.id)!;
    let update: Record<string, unknown> = { xero_contact_id: r.contactId, xero_contact_name: r.contactName, site_id: r.siteId, plan_id: r.planId };
    if (!r.contactId) {
      update = { ...update, match_status: "no_contact", match_note: r.how, xero_invoice_id: null, invoice_number: null, invoice_ids: null };
      reviews.push({ kind: "contact_unlinked", title: `${r.contactName ?? it.description ?? "Unknown customer"} — which Xero contact carries this customer's invoices?`, evidence: { how: r.how, amount_cents: it.amount_cents, charge_date: it.charge_date, description: it.description, gc_customer_id: it.gc_customer_id, gc_subscription_id: it.gc_subscription_id, plan_id: r.planId, site_id: r.siteId }, payout_item_id: it.id, gc_customer_id: it.gc_customer_id });
    } else {
      const siblings = items.filter((s) => contactOf.get(s.id)?.contactId === r.contactId);
      const m = matchInvoice(it, r.contactId, siblings, ctx);
      update = { ...update, match_status: m.status, match_note: `${m.note} · contact via ${r.how}`, xero_invoice_id: m.invoiceIds[0] ?? null, invoice_number: m.numbers.filter(Boolean).join(" + ") || null, invoice_ids: m.invoiceIds.length ? m.invoiceIds : null };
      if (m.status === "matched") out.matched += 1;
      else if (m.status === "already_paid") out.alreadyPaid += 1;
      else reviews.push({ kind: m.status === "ambiguous" ? "invoice_ambiguous" : "invoice_missing", title: `${r.contactName}: $${(it.amount_cents / 100).toFixed(2)} collected ${it.charge_date ?? ""} — ${m.status === "ambiguous" ? "several invoices could be it" : "no invoice to pay"}`, evidence: { note: m.note, amount_cents: it.amount_cents, charge_date: it.charge_date, description: it.description, xero_contact_id: r.contactId, xero_contact_name: r.contactName, gc_customer_id: it.gc_customer_id }, payout_item_id: it.id, gc_customer_id: it.gc_customer_id });
    }
    await svc.from("finance_payout_items").update(update).eq("id", it.id);
  }
  // review items: one open row per (kind, item)
  if (reviews.length) {
    const { data: open } = await svc.from("finance_review_items").select("kind, payout_item_id").eq("payout_id", payoutId).eq("status", "open");
    const have = new Set((open ?? []).map((o) => `${o.kind}|${o.payout_item_id}`));
    const fresh = reviews.filter((r) => !have.has(`${r.kind}|${r.payout_item_id}`)).map((r) => ({ ...r, payout_id: payoutId }));
    if (fresh.length) { const { error } = await svc.from("finance_review_items").insert(fresh); if (error) console.error("[finance] review insert:", error.message); }
    out.review = reviews.length;
  }
  // close review items whose payment now matches
  const matchedIds = items.filter((it) => !reviews.some((r) => r.payout_item_id === it.id)).map((it) => it.id);
  if (matchedIds.length) await svc.from("finance_review_items").update({ status: "resolved", resolution: { by: "agent", reason: "matched on a later run" }, resolved_at: new Date().toISOString() }).eq("payout_id", payoutId).eq("status", "open").in("payout_item_id", matchedIds);
  await svc.from("finance_payouts").update({ items_matched: out.matched + out.alreadyPaid, updated_at: new Date().toISOString() }).eq("id", payoutId);
  return out;
}

// ------------------------------------------------------------------ plan
export interface PayoutPlan {
  payments: { payout_item_id: string; invoice_id: string; invoice_number: string; contact: string; amount_cents: number }[];
  already_paid: { payout_item_id: string; invoice_number: string; contact: string; amount_cents: number }[];
  unresolved: { payout_item_id: string; status: string; note: string; amount_cents: number; contact: string | null }[];
  fee: { account_code: string; tax_type: string; amount_cents: number; contact: string };
  bank_account_code: string;
  gross_cents: number;
  fee_cents: number;
  net_cents: number;
  arrival_date: string;
  reference: string;
}

export async function planPayout(svc: SupabaseClient, payoutId: string, settings: FinanceSettings): Promise<{ status: string; plan: PayoutPlan }> {
  const { data: p } = await svc.from("finance_payouts").select("*").eq("id", payoutId).single();
  const { data: rows } = await svc.from("finance_payout_items").select("*").eq("payout_id", payoutId);
  const items = (rows ?? []) as (ItemRow & { xero_invoice_id: string | null; invoice_number: string | null; invoice_ids: string[] | null; xero_contact_name: string | null; match_note: string | null })[];
  const pay = items.filter((i) => i.item_type === "payment_paid_out");
  const feeCents = items.filter((i) => i.match_status === "fee").reduce((t, i) => t + Math.abs(i.amount_cents), 0) || Number(p.fee_cents);
  const plan: PayoutPlan = {
    payments: [], already_paid: [], unresolved: [],
    fee: { account_code: settings.fee_account_code, tax_type: settings.fee_tax_type, amount_cents: feeCents, contact: settings.fee_contact_name },
    bank_account_code: settings.bank_account_code, gross_cents: Number(p.gross_cents), fee_cents: feeCents, net_cents: Number(p.net_cents),
    arrival_date: p.arrival_date, reference: `GC payout ${p.provider_payout_id}`,
  };
  for (const it of pay) {
    if ((it.match_status === "matched" || it.match_status === "matched_manual") && it.invoice_ids?.length) {
      if (it.invoice_ids.length === 1) plan.payments.push({ payout_item_id: it.id, invoice_id: it.invoice_ids[0], invoice_number: it.invoice_number ?? "", contact: it.xero_contact_name ?? "", amount_cents: it.amount_cents });
      else {
        // one payment across several invoices: pay each at its own total
        const { data: invs } = await svc.from("finance_xero_invoices").select("invoice_id, invoice_number, total").in("invoice_id", it.invoice_ids);
        for (const inv of invs ?? []) plan.payments.push({ payout_item_id: it.id, invoice_id: inv.invoice_id, invoice_number: inv.invoice_number ?? "", contact: it.xero_contact_name ?? "", amount_cents: Math.round(Number(inv.total) * 100) });
      }
    } else if (it.match_status === "already_paid") plan.already_paid.push({ payout_item_id: it.id, invoice_number: it.invoice_number ?? "", contact: it.xero_contact_name ?? "", amount_cents: it.amount_cents });
    else plan.unresolved.push({ payout_item_id: it.id, status: it.match_status, note: it.match_note ?? "", amount_cents: it.amount_cents, contact: it.xero_contact_name });
  }
  let status: string;
  if (pay.length && plan.already_paid.length === pay.length) status = "reconciled"; // Mitchell did it by hand (D10)
  else if (plan.unresolved.length) status = "exception";
  else if (plan.already_paid.length) status = "exception"; // partly reconciled by hand — needs a look, never a double payment
  else status = "planned";
  const exception = status === "exception" ? `${plan.unresolved.length} unresolved, ${plan.already_paid.length} already paid, ${plan.payments.length} ready` : null;
  const before = { status: p.status };
  await svc.from("finance_payouts").update({ status, plan, exception, planned_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...(status === "reconciled" && !p.reconciled_at ? { reconciled_at: new Date().toISOString() } : {}) }).eq("id", payoutId);
  if (before.status !== status) await audit(svc, { action: "payout.planned", entity: "finance_payouts", entityId: payoutId, before, after: { status, payments: plan.payments.length, unresolved: plan.unresolved.length, already_paid: plan.already_paid.length }, rule: "D3/D7/D10" });
  return { status, plan };
}

// ------------------------------------------------------------------ post
export async function postPayout(svc: SupabaseClient, x: XeroRest, payoutId: string): Promise<{ ok: boolean; note: string }> {
  const { data: p } = await svc.from("finance_payouts").select("*").eq("id", payoutId).single();
  if (!p || p.status !== "planned" || !p.plan) return { ok: false, note: `not planned (${p?.status})` };
  const plan = p.plan as PayoutPlan;
  if (!plan.payments.length) return { ok: false, note: "no payments in plan" };
  const posted: { payment_ids: string[]; bank_transaction_id: string | null } = { payment_ids: [], bank_transaction_id: null };
  try {
    const body = { Payments: plan.payments.map((pm) => ({ Invoice: { InvoiceID: pm.invoice_id }, Account: { Code: plan.bank_account_code }, Date: plan.arrival_date, Amount: pm.amount_cents / 100, Reference: plan.reference })) };
    const res = await x.post<{ Payments?: { PaymentID: string; Invoice?: { InvoiceID?: string } }[] }>("Payments", body, `finance-${payoutId}-payments`);
    posted.payment_ids = (res?.Payments ?? []).map((r) => r.PaymentID);
    for (const r of res?.Payments ?? []) {
      const pm = plan.payments.find((q) => q.invoice_id === r.Invoice?.InvoiceID);
      if (pm) await svc.from("finance_payout_items").update({ xero_payment_id: r.PaymentID }).eq("id", pm.payout_item_id);
    }
    await audit(svc, { action: "xero.payments.created", entity: "xero.payment", entityId: payoutId, after: { count: posted.payment_ids.length, ids: posted.payment_ids, reference: plan.reference }, rule: "D3" });
    if (plan.fee.amount_cents > 0) {
      const feeBody = { BankTransactions: [{ Type: "SPEND", Contact: { Name: plan.fee.contact }, BankAccount: { Code: plan.bank_account_code }, Date: plan.arrival_date, Reference: plan.reference, LineAmountTypes: "Inclusive", LineItems: [{ Description: `GoCardless fees — payout ${p.provider_payout_id}`, Quantity: 1, UnitAmount: plan.fee.amount_cents / 100, AccountCode: plan.fee.account_code, TaxType: plan.fee.tax_type }] }] };
      const fres = await x.post<{ BankTransactions?: { BankTransactionID: string }[] }>("BankTransactions", feeBody, `finance-${payoutId}-fee`);
      posted.bank_transaction_id = fres?.BankTransactions?.[0]?.BankTransactionID ?? null;
      await audit(svc, { action: "xero.fee.created", entity: "xero.banktransaction", entityId: posted.bank_transaction_id, after: { amount_cents: plan.fee.amount_cents, account: plan.fee.account_code, tax: plan.fee.tax_type }, rule: "D3" });
    }
    await svc.from("finance_payouts").update({ status: "posted", posted, posted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", payoutId);
    return { ok: true, note: `${posted.payment_ids.length} payments + fee posted` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await svc.from("finance_payouts").update({ status: "exception", exception: `post failed: ${msg.slice(0, 300)}`, posted, updated_at: new Date().toISOString() }).eq("id", payoutId);
    await audit(svc, { action: "xero.post.failed", entity: "finance_payouts", entityId: payoutId, after: { error: msg.slice(0, 500), posted }, rule: "D2" });
    return { ok: false, note: msg };
  }
}

/** posted → reconciled once Xero reports every payment reconciled (D10). */
export async function refreshReconciled(svc: SupabaseClient, x: XeroRest): Promise<number> {
  const { data: posted } = await svc.from("finance_payouts").select("id, posted").eq("status", "posted");
  let n = 0;
  for (const p of posted ?? []) {
    const ids = ((p.posted as { payment_ids?: string[] } | null)?.payment_ids ?? []).filter(Boolean);
    if (!ids.length) continue;
    const res = await x.get<{ Payments?: { PaymentID: string; IsReconciled?: boolean }[] }>(`Payments?IDs=${ids.join(",")}`);
    const all = res?.Payments ?? [];
    if (all.length && all.every((pm) => pm.IsReconciled)) {
      await svc.from("finance_payouts").update({ status: "reconciled", reconciled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", p.id);
      await audit(svc, { action: "payout.reconciled", entity: "finance_payouts", entityId: p.id as string, rule: "D10" });
      n += 1;
    }
  }
  return n;
}
