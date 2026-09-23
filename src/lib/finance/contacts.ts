import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "./audit";
import { gcCustomerName, listActiveMandates, listCustomers } from "./gc";
import { isJunkContactName, normName } from "./xero-mirror";

// The contact worksheet (docs/finance-CONTEXT.md D5, D6): every GoCardless
// customer with a live mandate → the Xero contact that carries its invoices.
// Reads the local mirror only — no Xero calls. Mitchell decides; nothing is
// renamed anywhere until the explicit "apply names" action (phase 2).

export interface Candidate { contact_id: string; name: string; invoices: number; total: number; last: string | null; amounts: string[] }
export interface WorksheetRow {
  gc_customer_id: string;
  gc_name: string;
  gc_email: string | null;
  active_subs: number;
  monthly_cents: number;
  crm_site: string | null;
  crm_site_id: string | null;
  stored_contact: string | null;
  stored_contact_id: string | null;
  status: string; // linked | proposed | unlinked | ignored
  canonical_name: string | null;
  xero_contact_id: string | null;
  candidates: Candidate[];
  suggestion: string; // ok | key | re-point | split | no-carrier
}

export async function refreshGcCustomers(svc: SupabaseClient): Promise<{ customers: number; withMandate: number }> {
  const [mandates, customers] = await Promise.all([listActiveMandates(), listCustomers()]);
  const mandated = new Set(mandates.map((m) => m.links?.customer).filter(Boolean) as string[]);
  const rows = customers.filter((c) => mandated.has(c.id)).map((c) => ({ gc_customer_id: c.id, gc_name: gcCustomerName(c), gc_email: c.email ?? null }));
  for (const r of rows) {
    // keep decisions: only touch name/email on existing rows
    const { data: ex } = await svc.from("finance_gc_customers").select("gc_customer_id").eq("gc_customer_id", r.gc_customer_id).maybeSingle();
    if (ex) await svc.from("finance_gc_customers").update({ gc_name: r.gc_name, gc_email: r.gc_email, updated_at: new Date().toISOString() }).eq("gc_customer_id", r.gc_customer_id);
    else await svc.from("finance_gc_customers").insert({ ...r, status: "unlinked" });
  }
  return { customers: customers.length, withMandate: rows.length };
}

export async function buildWorksheet(svc: SupabaseClient): Promise<WorksheetRow[]> {
  const [{ data: gcc }, { data: contacts }, { data: invoices }, { data: plans }, { data: links }, { data: sites }, { data: subsAgg }] = await Promise.all([
    svc.from("finance_gc_customers").select("*"),
    svc.from("finance_xero_contacts").select("contact_id, name, status"),
    svc.from("finance_xero_invoices").select("invoice_id, invoice_number, contact_id, status, date, total").eq("type", "ACCREC"),
    svc.from("recurring_plans").select("id, site_id, customer_id, gc_customer_id, gc_mandate_id, xero_contact_id, status"),
    svc.from("recurring_plan_gc_subscriptions").select("plan_id, gc_subscription_id, gc_status, amount_cents, interval_unit"),
    svc.from("customer_sites").select("id, name, xero_contact_id"),
    svc.from("finance_payout_items").select("gc_customer_id, gc_subscription_id").not("gc_customer_id", "is", null),
  ]);
  const contactById = new Map((contacts ?? []).map((c) => [c.contact_id as string, c as { contact_id: string; name: string; status: string | null }]));
  const invByContact = new Map<string, { status: string; date: string | null; total: number | null; invoice_number: string | null }[]>();
  for (const i of invoices ?? []) { if (!i.contact_id) continue; if (!invByContact.has(i.contact_id)) invByContact.set(i.contact_id, []); invByContact.get(i.contact_id)!.push(i as never); }
  const siteById = new Map((sites ?? []).map((s) => [s.id as string, s as { id: string; name: string; xero_contact_id: string | null }]));
  const plansByGc = new Map<string, typeof plans>();
  for (const p of plans ?? []) { if (p.gc_customer_id) { const k = p.gc_customer_id as string; if (!plansByGc.has(k)) plansByGc.set(k, []); plansByGc.get(k)!.push(p); } }
  const subsByPlan = new Map<string, NonNullable<typeof links>>();
  for (const l of links ?? []) { const k = l.plan_id as string; if (!subsByPlan.has(k)) subsByPlan.set(k, []); subsByPlan.get(k)!.push(l); }
  // GC customer → plans also via payout items' subscriptions
  const subToGc = new Map<string, string>();
  for (const s of subsAgg ?? []) if (s.gc_subscription_id) subToGc.set(s.gc_subscription_id as string, s.gc_customer_id as string);
  const linkPlanByGc = new Map<string, Set<string>>();
  for (const l of links ?? []) { const gc = subToGc.get(l.gc_subscription_id as string); if (gc) { if (!linkPlanByGc.has(gc)) linkPlanByGc.set(gc, new Set()); linkPlanByGc.get(gc)!.add(l.plan_id as string); } }

  const score = (cid: string): Candidate | null => {
    const c = contactById.get(cid);
    if (!c || isJunkContactName(c.name, c.status)) return null;
    const live = (invByContact.get(cid) ?? []).filter((i) => !["VOIDED", "DELETED", "DRAFT"].includes(i.status));
    return { contact_id: cid, name: c.name, invoices: live.length, total: live.reduce((t, i) => t + Number(i.total ?? 0), 0), last: live.map((i) => i.date ?? "").sort().at(-1) || null, amounts: [...new Set(live.map((i) => Number(i.total ?? 0).toFixed(2)))].slice(0, 5) };
  };
  const frag = (s: string) => normName(s).replace(/^snap fitness /, "").replace(/^planet fitness /, "").split(" ").filter((w) => w.length > 3).slice(0, 2).join(" ");

  const rows: WorksheetRow[] = [];
  for (const g of gcc ?? []) {
    const planIds = new Set<string>([...(plansByGc.get(g.gc_customer_id as string) ?? []).map((p) => p.id as string), ...(linkPlanByGc.get(g.gc_customer_id as string) ?? [])]);
    const planRows = [...planIds].map((id) => (plans ?? []).find((p) => p.id === id)).filter(Boolean) as NonNullable<typeof plans>;
    const active = planRows.filter((p) => p.status === "active");
    const site = (active[0] ?? planRows[0])?.site_id ? siteById.get((active[0] ?? planRows[0]).site_id as string) : undefined;
    const storedId = (g.xero_contact_id as string | null) ?? (active[0] ?? planRows[0])?.xero_contact_id ?? site?.xero_contact_id ?? null;
    const subs = [...planIds].flatMap((id) => subsByPlan.get(id) ?? []).filter((s) => s.gc_status === "active");
    const cands = new Map<string, Candidate>();
    const add = (cid?: string | null) => { if (!cid || cands.has(cid)) return; const s = score(cid); if (s) cands.set(cid, s); };
    add(storedId);
    for (const needle of [frag(g.gc_name ?? ""), site ? frag(site.name) : ""].filter(Boolean)) {
      for (const c of contacts ?? []) if (needle && normName(c.name as string).includes(needle)) add(c.contact_id as string);
    }
    const list = [...cands.values()].sort((a, b) => (b.last ?? "").localeCompare(a.last ?? "") || b.invoices - a.invoices).slice(0, 6);
    const carriers = list.filter((c) => c.invoices > 0);
    const storedName = storedId ? contactById.get(storedId)?.name ?? null : null;
    let suggestion: string;
    if (g.status === "linked") suggestion = "ok";
    else if (!carriers.length) suggestion = "no-carrier";
    else if (carriers.length > 1) suggestion = "split";
    else if (storedId && carriers[0].contact_id === storedId) suggestion = "ok";
    else if (storedId) suggestion = "re-point";
    else suggestion = "key";
    rows.push({
      gc_customer_id: g.gc_customer_id as string, gc_name: (g.gc_name as string) ?? "", gc_email: g.gc_email as string | null,
      active_subs: subs.length, monthly_cents: subs.filter((s) => s.interval_unit === "monthly").reduce((t, s) => t + Number(s.amount_cents ?? 0), 0),
      crm_site: site?.name ?? null, crm_site_id: site?.id ?? null, stored_contact: storedName, stored_contact_id: storedId,
      status: g.status as string, canonical_name: g.canonical_name as string | null, xero_contact_id: g.xero_contact_id as string | null,
      candidates: list, suggestion,
    });
  }
  const order: Record<string, number> = { split: 0, "re-point": 1, key: 2, "no-carrier": 3, ok: 4 };
  return rows.sort((a, b) => (order[a.suggestion] ?? 9) - (order[b.suggestion] ?? 9) || a.gc_name.localeCompare(b.gc_name));
}

export async function decideContact(svc: SupabaseClient, input: { gc_customer_id: string; xero_contact_id: string | null; canonical_name: string; site_id?: string | null; status?: "linked" | "ignored"; actor: string }): Promise<void> {
  const { data: before } = await svc.from("finance_gc_customers").select("*").eq("gc_customer_id", input.gc_customer_id).maybeSingle();
  const status = input.status ?? "linked";
  const after = { xero_contact_id: input.xero_contact_id, canonical_name: input.canonical_name, site_id: input.site_id ?? before?.site_id ?? null, status, decided_by: input.actor, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const { error } = await svc.from("finance_gc_customers").upsert({ gc_customer_id: input.gc_customer_id, gc_name: before?.gc_name ?? input.canonical_name, ...after }, { onConflict: "gc_customer_id" });
  if (error) throw new Error(error.message);
  if (after.site_id && input.xero_contact_id) {
    await svc.from("customer_sites").update({ xero_contact_id: input.xero_contact_id }).eq("id", after.site_id);
  }
  await audit(svc, { actor: input.actor, action: "contact.decided", entity: "finance_gc_customers", entityId: input.gc_customer_id, before, after, rule: "D5/D6" });
  // re-open matching for this customer's payments on the next cycle
  await svc.from("finance_payout_items").update({ match_status: "unmatched", match_note: "re-match after contact decision" }).eq("gc_customer_id", input.gc_customer_id).in("match_status", ["no_contact", "no_invoice", "ambiguous", "unmatched"]);
  await svc.from("finance_review_items").update({ status: "resolved", resolution: { by: input.actor, reason: "contact decided", xero_contact_id: input.xero_contact_id }, resolved_by: null, resolved_at: new Date().toISOString() }).eq("gc_customer_id", input.gc_customer_id).eq("kind", "contact_unlinked").eq("status", "open");
}
