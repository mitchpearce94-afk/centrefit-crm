import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedClient } from "@/lib/xero/client";
import { nameMatches, norm } from "@/lib/recurring/billing-match";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * Direct-debit migration tracker (Mitchell 2026-08-26).
 *
 * The finance officer emails 10–15 invoice-paid recurring customers a week
 * onto GoCardless. The customers who still pay by invoice live ONLY in Xero —
 * as AUTHORISED repeating invoices (RIs) that no CRM plan owns — so this
 * module pulls that list, matches each RI back to a CRM site, and keeps the
 * campaign state (`dd_migration_targets`) in step with what the plans say:
 *
 *   todo → invited → mandate_pending → dd_live → ri_retired
 *                                    ↘ declined / excluded (manual, never overwritten)
 *
 * `dd_live` is the dangerous state: the customer's new CRM plan has its own
 * DD-themed RI + GC subscription, but the legacy RI is still authorised —
 * two invoices per cycle until someone retires it. activatePlan deliberately
 * never deletes RIs (see the June–July 2026 RI-swap incident in
 * billing-gap-watchdog), so retiring is an explicit, confirmed action here.
 */

import { DD_STATUS_COLOUR, DD_STATUS_LABEL, renderDdTemplate, type DdStatus } from "@/lib/recurring/dd-migration-shared";
export { DD_STATUS_COLOUR, DD_STATUS_LABEL, renderDdTemplate };
export type { DdStatus };

/** Statuses a human set that the sync must never overwrite. */
const MANUAL_STATUSES = new Set<DdStatus>(["declined", "excluded", "ri_retired"]);

export interface DdTargetRow {
  id: string;
  source: "xero_ri" | "crm_plan";
  xero_repeating_invoice_id: string | null;
  xero_contact_id: string | null;
  xero_contact_name: string | null;
  xero_reference: string | null;
  xero_ri_status: string | null;
  line_text: string | null;
  ri_total: number | string | null;
  schedule_unit: string | null;
  schedule_period: number | null;
  next_scheduled_date: string | null;
  monthly_value: number | string | null;
  site_id: string | null;
  customer_id: string | null;
  recurring_plan_id: string | null;
  contact_email: string | null;
  status: DdStatus;
  status_reason: string | null;
  invited_at: string | null;
  last_touch_at: string | null;
  touch_count: number;
  dd_live_at: string | null;
  ri_retired_at: string | null;
  notes: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PlanLite {
  id: string;
  status: string;
  source: string;
  site_id: string | null;
  customer_id: string | null;
  gc_mandate_id: string | null;
  xero_repeating_invoice_id: string | null;
  xero_repeating_invoice_secondary_id: string | null;
  first_invoice_date: string | null;
  created_at: string;
}

interface SiteLite {
  id: string;
  name: string | null;
  invoice_name: string | null;
  customer_id: string | null;
  xero_contact_id: string | null;
  billing_email: string | null;
  email: string | null;
  invoice_only: boolean;
  customers:
    | { name: string | null; xero_contact_id: string | null; billing_email: string | null }
    | Array<{ name: string | null; xero_contact_id: string | null; billing_email: string | null }>
    | null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** Monthly-equivalent value of an RI from its Xero schedule. */
export function monthlyFromSchedule(total: number, unit: string | null, period: number | null): number {
  const p = period && period > 0 ? period : 1;
  if ((unit ?? "").toUpperCase() === "WEEKLY") return (total * 52) / 12 / p;
  return total / p;
}

// Xero hands dates back as Date objects, ISO strings or "/Date(ms)/" — normalise.
function toIsoDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const ms = s.match(/\/Date\((\d+)/);
  if (ms) return new Date(Number(ms[1])).toISOString().slice(0, 10);
  return null;
}

interface Derived {
  status: DdStatus;
  reason: string | null;
  planId: string | null;
}

/**
 * Work out what the plans say about a target. Manual statuses win; otherwise
 * an invoice-only site is excluded, a mandated CRM plan on the site means the
 * migration is complete (legacy RI now redundant → dd_live), a mandated
 * *imported* plan means the customer was already collecting via GC before
 * this campaign (already_dd — the RI is their invoice, not a duplicate), and
 * a draft/pending plan means we're waiting on the signature.
 */
function derive(existing: Pick<DdTargetRow, "status" | "recurring_plan_id"> | null, site: SiteLite | null, plans: PlanLite[]): Derived {
  if (existing && MANUAL_STATUSES.has(existing.status)) {
    return { status: existing.status, reason: null, planId: existing.recurring_plan_id };
  }
  if (site?.invoice_only) return { status: "excluded", reason: "Invoice-only site", planId: null };

  const sitePlans = site ? plans.filter((p) => p.site_id === site.id) : [];
  const mandated = sitePlans
    .filter((p) => !!p.gc_mandate_id && (p.status === "active" || p.status === "paused"))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  // A CRM-created plan is the only thing this campaign can produce, so its
  // presence means the legacy RI is now a duplicate. An imported plan is the
  // customer's pre-existing GC billing — the legacy RI IS their invoice.
  const crmLive = mandated.find((p) => p.source === "crm");
  if (crmLive) return { status: "dd_live", reason: null, planId: crmLive.id };
  const importedLive = mandated.find((p) => p.source !== "crm");
  if (importedLive) {
    return { status: "already_dd", reason: "Collecting via legacy GoCardless subscription", planId: importedLive.id };
  }
  const pending = sitePlans
    .filter((p) => !p.gc_mandate_id && (p.status === "draft" || p.status === "pending_mandate"))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  if (pending) return { status: "mandate_pending", reason: null, planId: pending.id };

  if (existing && (existing.status === "todo" || existing.status === "invited")) {
    return { status: existing.status, reason: null, planId: null };
  }
  return { status: "todo", reason: null, planId: null };
}

async function loadPlansAndSites(svc: SupabaseClient): Promise<{ plans: PlanLite[]; sites: SiteLite[] }> {
  const [{ data: plans }, { data: sites }] = await Promise.all([
    svc
      .from("recurring_plans")
      .select("id, status, source, site_id, customer_id, gc_mandate_id, xero_repeating_invoice_id, xero_repeating_invoice_secondary_id, first_invoice_date, created_at"),
    svc
      .from("customer_sites")
      .select("id, name, invoice_name, customer_id, xero_contact_id, billing_email, email, invoice_only, customers(name, xero_contact_id, billing_email)"),
  ]);
  return {
    plans: (plans ?? []) as unknown as PlanLite[],
    sites: (sites ?? []) as unknown as SiteLite[],
  };
}

function buildSiteIndex(sites: SiteLite[]) {
  const byContact = new Map<string, SiteLite>();
  const byCustomerContact = new Map<string, SiteLite[]>();
  const byName = new Map<string, SiteLite>();
  for (const s of sites) {
    if (s.xero_contact_id) byContact.set(s.xero_contact_id, s);
    const cust = one(s.customers);
    if (cust?.xero_contact_id) {
      const list = byCustomerContact.get(cust.xero_contact_id) ?? [];
      list.push(s);
      byCustomerContact.set(cust.xero_contact_id, list);
    }
    for (const n of [s.name, s.invoice_name]) {
      const k = norm(n);
      if (k && !byName.has(k)) byName.set(k, s);
    }
  }
  return {
    resolve(contactId: string | null, contactName: string | null): SiteLite | null {
      if (contactId) {
        const direct = byContact.get(contactId);
        if (direct) return direct;
        const viaCustomer = byCustomerContact.get(contactId);
        if (viaCustomer && viaCustomer.length === 1) return viaCustomer[0];
        if (viaCustomer && contactName) {
          const k = norm(contactName);
          const hit = viaCustomer.find((s) => norm(s.name) === k || norm(s.invoice_name) === k);
          if (hit) return hit;
        }
      }
      const k = norm(contactName);
      const exact = k ? byName.get(k) : undefined;
      if (exact) return exact;
      // Legacy Xero contacts are entity-named ("Gladesville Fitness Pty Ltd -
      // SF Meadowbank"); the site's own location tokens ("meadowbank") must
      // all appear in the contact name. Only an unambiguous single hit counts.
      if (contactName) {
        const hits = new Map<string, SiteLite>();
        for (const s of sites) {
          if ((s.name && nameMatches(s.name, contactName)) || (s.invoice_name && nameMatches(s.invoice_name, contactName))) {
            hits.set(s.id, s);
          }
        }
        if (hits.size === 1) return [...hits.values()][0];
      }
      return null;
    },
  };
}

function defaultEmail(site: SiteLite | null): string | null {
  if (!site) return null;
  const cust = one(site.customers);
  return site.billing_email || cust?.billing_email || site.email || null;
}

export interface SyncResult {
  seen: number;
  created: number;
  updated: number;
  gone: number;
  ddLive: number;
  alreadyDd: number;
  unmatched: number;
}

interface XeroRiLite {
  repeatingInvoiceID?: string;
  status?: unknown;
  type?: unknown;
  total?: number;
  reference?: string;
  contact?: { contactID?: string; name?: string };
  schedule?: { unit?: unknown; period?: number; nextScheduledDate?: unknown };
  lineItems?: Array<{ description?: string }>;
}

/**
 * Pull every AUTHORISED sales RI from Xero, drop the ones a CRM plan owns,
 * match the rest to sites, and upsert the campaign rows. Also notices RIs
 * that vanished since last time (retired by hand, or linked to a plan).
 */
export async function syncDdMigrationTargets(svc: SupabaseClient): Promise<SyncResult> {
  const { client: xero, conn } = await getAuthedClient(svc);
  const res = await xero.accountingApi.getRepeatingInvoices(conn.tenant_id);
  const ris = ((res.body.repeatingInvoices ?? []) as unknown as XeroRiLite[]).filter(
    (r) => String(r.type) === "ACCREC" && String(r.status) === "AUTHORISED" && !!r.repeatingInvoiceID,
  );

  const { plans, sites } = await loadPlansAndSites(svc);
  const index = buildSiteIndex(sites);
  const linked = new Set<string>();
  for (const p of plans) {
    if (p.xero_repeating_invoice_id) linked.add(p.xero_repeating_invoice_id);
    if (p.xero_repeating_invoice_secondary_id) linked.add(p.xero_repeating_invoice_secondary_id);
  }

  const { data: existingRows } = await svc.from("dd_migration_targets").select("*");
  const existing = new Map<string, DdTargetRow>();
  for (const t of (existingRows ?? []) as DdTargetRow[]) {
    if (t.xero_repeating_invoice_id) existing.set(t.xero_repeating_invoice_id, t);
  }

  const result: SyncResult = { seen: 0, created: 0, updated: 0, gone: 0, ddLive: 0, alreadyDd: 0, unmatched: 0 };
  const now = new Date().toISOString();
  const seen = new Set<string>();

  for (const r of ris) {
    const riId = r.repeatingInvoiceID as string;
    if (linked.has(riId)) continue;
    seen.add(riId);
    result.seen += 1;

    const contactId = r.contact?.contactID ?? null;
    const contactName = r.contact?.name ?? null;
    const site = index.resolve(contactId, contactName);
    const prev = existing.get(riId) ?? null;
    // A site the hire linked by hand wins over name/contact matching.
    const siteId = prev?.site_id ?? site?.id ?? null;
    const siteForDerive = siteId ? (sites.find((s) => s.id === siteId) ?? null) : null;
    if (!siteForDerive) result.unmatched += 1;

    const total = Number(r.total ?? 0);
    const unit = r.schedule?.unit != null ? String(r.schedule.unit) : null;
    const period = r.schedule?.period != null ? Number(r.schedule.period) : null;
    const d = derive(prev, siteForDerive, plans);
    if (d.status === "dd_live") result.ddLive += 1;
    if (d.status === "already_dd") result.alreadyDd += 1;

    const row = {
      source: "xero_ri" as const,
      xero_repeating_invoice_id: riId,
      xero_contact_id: contactId,
      xero_contact_name: contactName,
      xero_reference: r.reference ?? null,
      xero_ri_status: "AUTHORISED",
      line_text: (r.lineItems ?? [])
        .map((li) => (li.description ?? "").trim())
        .filter(Boolean)
        .join(" • ")
        .slice(0, 600) || null,
      ri_total: total,
      schedule_unit: unit,
      schedule_period: period,
      next_scheduled_date: toIsoDate(r.schedule?.nextScheduledDate),
      monthly_value: Math.round(monthlyFromSchedule(total, unit, period) * 100) / 100,
      site_id: siteId,
      customer_id: prev?.customer_id ?? siteForDerive?.customer_id ?? null,
      recurring_plan_id: d.planId ?? prev?.recurring_plan_id ?? null,
      contact_email: prev?.contact_email ?? defaultEmail(siteForDerive),
      status: d.status,
      status_reason: d.reason ?? (prev && MANUAL_STATUSES.has(prev.status) ? prev.status_reason : null),
      dd_live_at: d.status === "dd_live" ? (prev?.dd_live_at ?? now) : prev?.dd_live_at ?? null,
      last_synced_at: now,
    };

    const { error } = await svc
      .from("dd_migration_targets")
      .upsert(row, { onConflict: "xero_repeating_invoice_id" });
    if (error) throw new Error(`dd_migration_targets upsert failed for ${riId}: ${error.message}`);
    if (prev) result.updated += 1;
    else result.created += 1;
  }

  // RIs we tracked that Xero no longer lists as authorised: either retired
  // (good — the migration finished) or adopted by a CRM plan (linkage project).
  for (const t of existing.values()) {
    const riId = t.xero_repeating_invoice_id as string;
    if (seen.has(riId)) continue;
    if (["ri_retired", "ri_gone", "excluded", "declined"].includes(t.status)) continue;
    const nowLinked = linked.has(riId);
    const next: Partial<DdTargetRow> = nowLinked
      ? { status: "already_dd", status_reason: "Legacy RI is now linked to a CRM plan" }
      : t.status === "dd_live"
      ? { status: "ri_retired", ri_retired_at: now, xero_ri_status: "DELETED" }
      : { status: "ri_gone", status_reason: "Repeating invoice no longer authorised in Xero", xero_ri_status: "DELETED" };
    await svc.from("dd_migration_targets").update({ ...next, last_synced_at: now }).eq("id", t.id);
    result.gone += 1;
  }

  return result;
}

/**
 * Cheap, Xero-free refresh used on page load: re-derive status from the
 * plans for every row still in play, so a mandate signed five minutes ago
 * shows as dd_live without waiting for the weekly sync.
 */
export async function reconcileDdTargets(svc: SupabaseClient, onlyIds?: string[]): Promise<number> {
  let q = svc
    .from("dd_migration_targets")
    .select("*")
    .in("status", ["todo", "invited", "mandate_pending", "dd_live", "already_dd"]);
  if (onlyIds && onlyIds.length) q = q.in("id", onlyIds);
  const { data } = await q;
  const rows = (data ?? []) as DdTargetRow[];
  if (rows.length === 0) return 0;

  const { plans, sites } = await loadPlansAndSites(svc);
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const now = new Date().toISOString();
  let changed = 0;
  for (const t of rows) {
    const site = t.site_id ? (siteById.get(t.site_id) ?? null) : null;
    const d = derive(t, site, plans);
    const planId = d.planId ?? t.recurring_plan_id;
    const email = t.contact_email ?? defaultEmail(site);
    if (d.status === t.status && planId === t.recurring_plan_id && email === t.contact_email) continue;
    await svc
      .from("dd_migration_targets")
      .update({
        status: d.status,
        status_reason: d.reason,
        recurring_plan_id: planId,
        contact_email: email,
        customer_id: t.customer_id ?? site?.customer_id ?? null,
        ...(d.status === "dd_live" && !t.dd_live_at ? { dd_live_at: now } : {}),
      })
      .eq("id", t.id);
    changed += 1;
  }
  return changed;
}

/**
 * GC webhook hook: the moment a migrated customer's plan activates, flag the
 * legacy RI for retirement and ring the bell. Imported plans never trigger
 * this — their legacy RI is the customer's invoice, not a duplicate.
 */
export async function markDdTargetsLiveForPlan(svc: SupabaseClient, planId: string): Promise<number> {
  const { data: plan } = await svc
    .from("recurring_plans")
    .select("id, site_id, source, customer_sites(name)")
    .eq("id", planId)
    .maybeSingle();
  if (!plan || plan.source !== "crm") return 0;

  const filters = [`recurring_plan_id.eq.${planId}`];
  if (plan.site_id) filters.push(`site_id.eq.${plan.site_id}`);
  const now = new Date().toISOString();
  const { data: rows } = await svc
    .from("dd_migration_targets")
    .update({ status: "dd_live", status_reason: null, dd_live_at: now, recurring_plan_id: planId })
    .or(filters.join(","))
    .in("status", ["todo", "invited", "mandate_pending"])
    .select("id, xero_contact_name");
  const hit = rows ?? [];
  if (hit.length === 0) return 0;

  const siteRel = (plan as { customer_sites?: { name?: string } | Array<{ name?: string }> | null }).customer_sites;
  const siteName = one(siteRel)?.name ?? hit[0].xero_contact_name ?? "customer";
  await enqueueNotification({
    typeCode: "dd_migration.dd_live",
    refType: "recurring_plan",
    refId: planId,
    audience: { allActive: true },
    title: `Direct debit live: ${siteName} — retire the legacy repeating invoice`,
    body: "The mandate is signed and the CRM plan is active, but the old Xero repeating invoice is still authorised. Retire it from the DD migration tracker so the customer isn't invoiced twice.",
    href: "/invoices/recurring/dd-migration?tab=dd_live",
  });
  return hit.length;
}
