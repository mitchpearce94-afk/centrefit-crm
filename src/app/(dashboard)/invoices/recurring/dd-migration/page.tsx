import Link from "next/link";
import { requirePermissionOrNotFound } from "@/lib/auth/route-guards";
import { getCurrentStaff } from "@/lib/auth/current-staff";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { reconcileDdTargets, type DdTargetRow } from "@/lib/recurring/dd-migration";
import { DD_STATUS_COLOUR, DD_STATUS_LABEL, type DdStatus } from "@/lib/recurring/dd-migration-shared";
import { ListSearch } from "@/components/ui/list-search";
import { SyncButton } from "./sync-button";
import { TargetActions } from "./target-actions";
import { TemplateEditor } from "./template-editor";

/**
 * /invoices/recurring/dd-migration — the finance officer's weekly list of
 * recurring customers still paying by invoice, and where each one is up to
 * on the way to direct debit. Targets are legacy Xero repeating invoices
 * synced from Xero (see lib/recurring/dd-migration.ts); the page never
 * emails anyone — "Draft invitation email" opens a personal email from
 * accounts@ with a fresh GoCardless link filled in.
 */

type Tab = "todo" | "invited" | "mandate_pending" | "dd_live" | "done" | "parked" | "already_dd";
const TAB_STATUSES: Record<Tab, DdStatus[]> = {
  todo: ["todo"],
  invited: ["invited"],
  mandate_pending: ["mandate_pending"],
  dd_live: ["dd_live"],
  done: ["ri_retired"],
  parked: ["declined", "excluded", "ri_gone"],
  already_dd: ["already_dd"],
};
const TAB_LABEL: Record<Tab, string> = {
  todo: "To do",
  invited: "Invited",
  mandate_pending: "Awaiting mandate",
  dd_live: "DD live — retire RI",
  done: "Done",
  parked: "Declined / excluded",
  already_dd: "Already on DD",
};
const WEEKLY_TARGET = "10–15";

interface Row extends DdTargetRow {
  customer_sites: { id: string; name: string; suburb: string | null } | Array<{ id: string; name: string; suburb: string | null }> | null;
  customers: { name: string | null } | Array<{ name: string | null }> | null;
  recurring_plans:
    | { id: string; status: string; first_invoice_date: string | null }
    | Array<{ id: string; status: string; first_invoice_date: string | null }>
    | null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}
const fmt = (n: number) => n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null);

export default async function DdMigrationPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  await requirePermissionOrNotFound("invoices.manage_recurring");
  const staff = await getCurrentStaff();
  const params = await searchParams;
  const tab = (Object.keys(TAB_STATUSES).includes(params.tab ?? "") ? params.tab : "todo") as Tab;
  const q = (params.q ?? "").trim().toLowerCase();

  const svc = createServiceRoleClient();
  // Cheap plan-only refresh so a mandate signed a minute ago shows as DD live.
  await reconcileDdTargets(svc);

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: targetRows }, { data: weekTouches }, { data: settings }] = await Promise.all([
    svc
      .from("dd_migration_targets")
      .select("*, customer_sites(id, name, suburb), customers(name), recurring_plans(id, status, first_invoice_date)")
      .order("monthly_value", { ascending: false, nullsFirst: false }),
    svc.from("dd_migration_touches").select("target_id, channel, created_at").gte("created_at", weekAgo),
    svc.from("dd_migration_settings").select("email_subject, email_body").limit(1).maybeSingle(),
  ]);
  const all = (targetRows ?? []) as unknown as Row[];

  const byStatus = (statuses: DdStatus[]) => all.filter((t) => statuses.includes(t.status));
  const remaining = byStatus(["todo", "invited", "mandate_pending"]);
  const remainingMonthly = remaining.reduce((s, t) => s + Number(t.monthly_value ?? 0), 0);
  const converted = byStatus(["dd_live", "ri_retired"]);
  const convertedThisMonth = converted.filter((t) => (t.dd_live_at ?? t.ri_retired_at ?? "") >= monthAgo).length;
  const alreadyDd = byStatus(["already_dd"]);
  const ddLive = byStatus(["dd_live"]);
  const invitedThisWeek = new Set((weekTouches ?? []).filter((t) => t.channel === "email").map((t) => t.target_id)).size;
  const coverageDen = converted.length + alreadyDd.length + remaining.length;
  const coverage = coverageDen > 0 ? Math.round(((converted.length + alreadyDd.length) / coverageDen) * 100) : 0;
  const lastSynced = all.reduce<string | null>((m, t) => (t.last_synced_at && (!m || t.last_synced_at > m) ? t.last_synced_at : m), null);

  const searchList = q
    ? all.filter((t) =>
        [t.xero_contact_name, one(t.customer_sites)?.name, one(t.customers)?.name, t.contact_email, t.line_text, t.xero_reference]
          .some((v) => v && String(v).toLowerCase().includes(q)),
      )
    : null;
  const list = searchList ?? byStatus(TAB_STATUSES[tab]);
  if (tab === "invited" && !q) {
    // Oldest invitation first — that's who needs the follow-up.
    list.sort((a, b) => (a.invited_at ?? "") < (b.invited_at ?? "") ? -1 : 1);
  }

  const template = {
    subject: settings?.email_subject ?? "",
    body: settings?.email_body ?? "",
  };
  const senderName = staff?.display_name ?? "Centrefit Accounts";

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link href="/invoices/recurring" className="hover:text-foreground transition-colors">Recurring</Link> / DD migration
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Direct-debit migration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Recurring customers still paying by invoice. Aim for {WEEKLY_TARGET} invitations a week until everyone eligible is on GoCardless.
          </p>
        </div>
        <SyncButton lastSyncedAt={lastSynced} />
      </div>

      {ddLive.length > 0 && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <span className="font-semibold text-destructive">{ddLive.length} customer{ddLive.length === 1 ? "" : "s"} now on direct debit with the legacy repeating invoice still live</span>
          <span className="text-muted-foreground"> — they&rsquo;ll be invoiced twice next cycle. </span>
          <Link href="/invoices/recurring/dd-migration?tab=dd_live" className="font-medium text-destructive underline-offset-2 hover:underline">
            Retire them now
          </Link>
        </div>
      )}

      {/* Metrics */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="surface-card card-hover p-5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Still on invoice</p>
          <p className="num-display mt-2 text-2xl font-semibold">{remaining.length}</p>
          <p className="text-[11px] text-muted-foreground mt-1">${fmt(remainingMonthly)}/mo not yet on DD</p>
        </div>
        <div className={`surface-card card-hover p-5 ${invitedThisWeek >= 10 ? "border-emerald-500/30 bg-emerald-500/5" : ""}`}>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Invited · last 7 days</p>
          <p className={`num-display mt-2 text-2xl font-semibold ${invitedThisWeek >= 10 ? "text-emerald-400" : ""}`}>{invitedThisWeek}</p>
          <p className="text-[11px] text-muted-foreground mt-1">target {WEEKLY_TARGET} a week</p>
        </div>
        <div className="surface-card card-hover p-5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Converted</p>
          <p className="num-display mt-2 text-2xl font-semibold text-emerald-400">{converted.length}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{convertedThisMonth} in the last 30 days</p>
        </div>
        <div className="surface-card card-hover p-5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">DD coverage</p>
          <p className="num-display num-gradient mt-2 text-2xl font-semibold">{coverage}%</p>
          <p className="text-[11px] text-muted-foreground mt-1">of eligible recurring customers</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-5 flex flex-nowrap items-center gap-1 border-b border-border overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
        {(Object.keys(TAB_STATUSES) as Tab[]).map((key) => {
          const count = byStatus(TAB_STATUSES[key]).length;
          const active = tab === key && !q;
          const accent = key === "dd_live" && count > 0;
          if (key === "already_dd" && count === 0) return null;
          const p = new URLSearchParams();
          if (key !== "todo") p.set("tab", key);
          const qs = p.toString();
          return (
            <Link
              key={key}
              href={qs ? `/invoices/recurring/dd-migration?${qs}` : "/invoices/recurring/dd-migration"}
              className={`relative shrink-0 -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {TAB_LABEL[key]}
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    accent ? "bg-destructive/20 text-destructive" : active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ListSearch placeholder="Search customer, site, email or service…" defaultValue={params.q ?? ""} />
        {q && <p className="text-xs text-muted-foreground">{list.length} match{list.length === 1 ? "" : "es"} across all tabs</p>}
      </div>

      <div className="surface-card mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Customer / Site</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Services on the invoice</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider text-right">Monthly</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Next fires</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Status</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Email</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground text-sm">
                  {q
                    ? "Nothing matches your search."
                    : all.length === 0
                    ? "No legacy repeating invoices loaded yet — click \"Sync from Xero\"."
                    : tab === "todo"
                    ? "Everyone has been invited. Nice."
                    : tab === "dd_live"
                    ? "No legacy invoices waiting to be retired."
                    : `Nothing in ${TAB_LABEL[tab].toLowerCase()}.`}
                </td>
              </tr>
            )}
            {list.map((t) => {
              const site = one(t.customer_sites);
              const customer = one(t.customers);
              const plan = one(t.recurring_plans);
              const colour = DD_STATUS_COLOUR[t.status];
              const invitedDays = t.status === "invited" ? daysSince(t.invited_at) : null;
              const displayName = site?.name ?? t.xero_contact_name ?? "—";
              return (
                <tr key={t.id} className="transition-colors hover:bg-accent/40">
                  <td className="px-4 py-2.5">
                    {site ? (
                      <Link href={`/sites/${site.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
                        {displayName}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">{displayName}</span>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {site
                        ? [site.suburb, customer?.name].filter(Boolean).join(" · ")
                        : <span className="text-amber-500">Not matched to a site — link it</span>}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[26rem]">
                    <span className="line-clamp-2">{t.line_text ?? "—"}</span>
                    {t.xero_reference && <span className="block text-[10px] opacity-70">ref {t.xero_reference}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm">
                    {Number(t.monthly_value ?? 0) > 0 ? `$${fmt(Number(t.monthly_value))}` : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {t.next_scheduled_date ? new Date(t.next_scheduled_date).toLocaleDateString("en-AU") : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{ backgroundColor: `${colour}20`, color: colour }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colour }} />
                      {DD_STATUS_LABEL[t.status]}
                      {invitedDays !== null && invitedDays > 0 && ` · ${invitedDays}d`}
                    </span>
                    {t.touch_count > 0 && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {t.touch_count} touch{t.touch_count === 1 ? "" : "es"}
                        {t.last_touch_at ? ` · last ${new Date(t.last_touch_at).toLocaleDateString("en-AU")}` : ""}
                      </p>
                    )}
                    {t.status_reason && (t.status === "declined" || t.status === "excluded" || t.status === "already_dd" || t.status === "ri_gone") && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{t.status_reason}</p>
                    )}
                    {t.status === "mandate_pending" && plan && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        plan {plan.status.replace("_", " ")}
                        {plan.first_invoice_date ? ` · first invoice ${new Date(plan.first_invoice_date).toLocaleDateString("en-AU")}` : ""}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {t.contact_email ? (
                      <span className="text-muted-foreground">{t.contact_email}</span>
                    ) : (
                      <span className="text-amber-500">none — add one</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <TargetActions
                      target={{
                        id: t.id,
                        status: t.status,
                        siteId: site?.id ?? t.site_id,
                        siteName: site?.name ?? null,
                        contactName: customer?.name ?? t.xero_contact_name ?? "",
                        contactEmail: t.contact_email,
                        planId: plan?.id ?? t.recurring_plan_id,
                        planStatus: plan?.status ?? null,
                        planFirstInvoiceDate: plan?.first_invoice_date ?? null,
                        riId: t.xero_repeating_invoice_id,
                        riReference: t.xero_reference,
                        riTotal: Number(t.ri_total ?? 0),
                        nextScheduledDate: t.next_scheduled_date,
                        monthlyValue: Number(t.monthly_value ?? 0),
                        lineText: t.line_text,
                        notes: t.notes,
                      }}
                      template={template}
                      senderName={senderName}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details className="surface-card mt-6 p-5">
        <summary className="cursor-pointer text-sm font-semibold">Invitation email template</summary>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          Edit the wording you and Mitchell agree on. Placeholders are filled per customer when you draft an email.
        </p>
        <TemplateEditor initialSubject={template.subject} initialBody={template.body} />
      </details>
    </>
  );
}
