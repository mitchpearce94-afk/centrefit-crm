import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth/current-staff";
import { currentUserHasPermission } from "@/lib/auth/permissions";
import Link from "next/link";
import { BackfillSubscriptionsButton } from "./backfill-subscriptions-button";
import { nextMonthlyOccurrence } from "@/lib/recurring/next-occurrence";
import { ListSearch } from "@/components/ui/list-search";
import { brisbaneDateISO } from "@/lib/dates";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft — Not Sent",
  pending_mandate: "Awaiting Mandate",
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
  failed: "Failed",
};
const STATUS_COLOURS: Record<string, string> = {
  draft: "#a78bfa",
  pending_mandate: "#fb923c",
  active: "#22c55e",
  paused: "#94a3b8",
  cancelled: "#64748b",
  failed: "#ef4444",
};

function fmt(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StreamLine({
  label,
  value,
  fmt,
  colour,
}: {
  label: string;
  value: number;
  fmt: (n: number) => string;
  colour: string;
}) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="h-2 w-2 rounded-full" style={{ background: colour }} />
        {label}
      </span>
      <span className="num-display font-medium text-foreground">${fmt(value)}</span>
    </div>
  );
}

interface PlanItemRow {
  service_name: string;
  service_code: string | null;
  account_code: string | null;
  price_inc_gst: number | string;
  frequency: "monthly" | "yearly" | "quarterly";
  quantity: number;
}

/** Convert a line's cadence to its monthly-equivalent factor. */
function monthlyFactor(frequency: string): number {
  return frequency === "yearly" ? 1 / 12 : frequency === "quarterly" ? 1 / 3 : 1;
}

type RevenueStream = "security" | "sim" | "nbn" | "other";
type StreamSplit = Record<RevenueStream, number>;

// Allocate one recurring line's monthly value across the revenue streams.
// Combo services (e.g. "Security Monitoring + SIM Card") bundle a SIM, so we
// peel the standard SIM rate off into the SIM stream and leave the remainder
// in the base stream — letting Mitchell gauge the true value of each service
// even though Xero books the whole combo to one GL. Stream of the base part
// leads with the Xero account code (NBN=204, SIM=207, security=208/209) and
// falls back to the code/name so new services still land sensibly.
function allocate(item: PlanItemRow, simRate: number): StreamSplit {
  const out: StreamSplit = { security: 0, sim: 0, nbn: 0, other: 0 };
  const monthly = Number(item.price_inc_gst) * (item.quantity ?? 1) * monthlyFactor(item.frequency);
  const acct = (item.account_code ?? "").trim();
  const code = (item.service_code ?? "").toLowerCase();
  const name = (item.service_name ?? "").toLowerCase();

  if (acct === "204" || code.startsWith("nbn") || name.includes("nbn")) {
    out.nbn = monthly;
    return out;
  }
  if (acct === "207" || code === "sim-card") {
    out.sim = monthly;
    return out;
  }

  const baseStream: RevenueStream =
    acct === "208" || acct === "209" || /monitor|alarm|duress|verification|security/.test(`${code} ${name}`)
      ? "security"
      : "other";

  // Combo line bundling a SIM (code like "*-sim" or "+ SIM Card" in the name)?
  const bundlesSim = /(^|[-_ ])sim($|[-_ ])/.test(code) || name.includes("sim card");
  if (bundlesSim) {
    const simMonthly = simRate * (item.quantity ?? 1) * monthlyFactor(item.frequency);
    const simPart = Math.min(simMonthly, monthly);
    out.sim += simPart;
    out[baseStream] += monthly - simPart;
    return out;
  }

  out[baseStream] += monthly;
  return out;
}

interface PlanRow {
  id: string;
  status: string;
  source: string | null;
  created_at: string;
  first_invoice_date: string | null;
  next_invoice_date: string | null;
  alias_email: string | null;
  signup_emailed_at: string | null;
  signup_link_url: string | null;
  customer_id: string;
  site_id: string | null;
  customers: { id: string; name: string } | null;
  customer_sites: { id: string; name: string } | null;
  recurring_plan_items: PlanItemRow[];
}

type Tab = "active" | "pending" | "draft" | "paused" | "failed" | "cancelled";

export default async function RecurringInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const supabase = await createClient();
  const params = await searchParams;
  const tab = (params.tab ?? "active") as Tab;
  const q = (params.q ?? "").trim().toLowerCase();

  const { data: plans } = await supabase
    .from("recurring_plans")
    .select(`
      id, status, source, created_at, first_invoice_date, next_invoice_date,
      alias_email, signup_emailed_at, signup_link_url,
      customer_id, site_id,
      customers(id, name),
      customer_sites(id, name),
      recurring_plan_items(service_name, service_code, account_code, price_inc_gst, frequency, quantity)
    `)
    .order("created_at", { ascending: false });

  const list = (plans ?? []) as unknown as PlanRow[];

  // Standard SIM rate, used to peel the SIM portion out of combo lines. Read
  // live from the service template so a price change flows through; falls back
  // to the known $24.75 rate if the template ever goes missing.
  const { data: simSvc } = await supabase
    .from("recurring_services")
    .select("price_inc_gst")
    .eq("code", "sim-card")
    .maybeSingle();
  const simRate = Number(simSvc?.price_inc_gst ?? 24.75) || 24.75;

  const planMonthly = (p: PlanRow): number =>
    (p.recurring_plan_items ?? []).reduce(
      (s, i) => s + Number(i.price_inc_gst) * (i.quantity ?? 1) * monthlyFactor(i.frequency),
      0,
    );

  // Top-line metrics, split across revenue streams (yearly cadences ÷ 12).
  const streamMRR: StreamSplit = { security: 0, sim: 0, nbn: 0, other: 0 };
  for (const p of list) {
    if (p.status !== "active") continue;
    for (const i of p.recurring_plan_items ?? []) {
      const a = allocate(i, simRate);
      streamMRR.security += a.security;
      streamMRR.sim += a.sim;
      streamMRR.nbn += a.nbn;
      streamMRR.other += a.other;
    }
  }
  const monthlyMRR = streamMRR.security + streamMRR.sim + streamMRR.nbn + streamMRR.other;

  const activeList = list.filter((p) => p.status === "active");
  const draftList = list.filter((p) => p.status === "draft");
  const pendingList = list.filter((p) => p.status === "pending_mandate");
  const pausedList = list.filter((p) => p.status === "paused");
  const failedList = list.filter((p) => p.status === "failed");
  const cancelledList = list.filter((p) => p.status === "cancelled");
  // $ we're carrying costs on but not collecting — the unsigned-mandate leak.
  const pendingMRR = pendingList.reduce((s, p) => s + planMonthly(p), 0);

  // Search cuts across every tab — you shouldn't have to know whether the
  // plan you're hunting is active, pending or cancelled to find it.
  const searchList = q
    ? list.filter((p) =>
        [
          p.customers?.name,
          p.customer_sites?.name,
          p.alias_email,
          ...(p.recurring_plan_items ?? []).map((i) => i.service_name),
        ].some((v) => v && String(v).toLowerCase().includes(q)),
      )
    : null;

  const filtered =
    searchList ??
    (tab === "pending" ? pendingList
    : tab === "draft" ? draftList
    : tab === "paused" ? pausedList
    : tab === "failed" ? failedList
    : tab === "cancelled" ? cancelledList
    : activeList);

  const todayStr = brisbaneDateISO(new Date());
  const isAdmin = await isCurrentUserAdmin();
  const canManageRecurring = await currentUserHasPermission("invoices.manage_recurring");

  return (
    <>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Recurring</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Direct-debit subscriptions. Linked to GoCardless mandates and Xero RepeatingInvoices.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && <BackfillSubscriptionsButton />}
          {canManageRecurring && (
            <Link
              href="/invoices/recurring/dd-migration"
              className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              DD migration
            </Link>
          )}
          <Link
            href="/invoices/recurring/new"
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            + New recurring plan
          </Link>
        </div>
      </div>

      {/* Metrics */}
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="surface-card card-hover p-5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Effective MRR</p>
          <p className="num-display num-gradient mt-2 text-2xl font-semibold">${fmt(monthlyMRR)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Monthly recurring (yearly ÷ 12), incl. GST</p>
          {monthlyMRR > 0 && (
            <div className="mt-3 space-y-1 border-t border-border pt-3">
              <StreamLine label="Security monitoring" value={streamMRR.security} fmt={fmt} colour="#22c55e" />
              <StreamLine label="SIM cards" value={streamMRR.sim} fmt={fmt} colour="#06b6d4" />
              <StreamLine label="NBN" value={streamMRR.nbn} fmt={fmt} colour="#8b5cf6" />
              {streamMRR.other > 0 && (
                <StreamLine label="Other" value={streamMRR.other} fmt={fmt} colour="#64748b" />
              )}
            </div>
          )}
        </div>
        <div className="surface-card card-hover p-5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Active plans</p>
          <p className="num-display mt-2 text-2xl font-semibold text-emerald-400">{activeList.length}</p>
        </div>
        <div className={`surface-card card-hover p-5 ${pendingList.length > 0 ? "border-amber-500/30 bg-amber-500/5" : ""}`}>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Awaiting mandate</p>
          <p className={`num-display mt-2 text-2xl font-semibold ${pendingList.length > 0 ? "text-amber-400" : "text-muted-foreground"}`}>{pendingList.length}</p>
          {pendingMRR > 0 && (
            <p className="text-[11px] text-amber-400/80 mt-1">
              ${fmt(pendingMRR)}/mo not being collected
            </p>
          )}
        </div>
      </div>

      {/* Tab strip — matches the invoices page so the two feel like siblings */}
      <div className="mt-5 flex flex-nowrap items-center gap-1 border-b border-border overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
        {[
          { key: "active", label: "Active", count: activeList.length },
          { key: "pending", label: "Awaiting Mandate", count: pendingList.length, accent: pendingList.length > 0 },
          ...(draftList.length > 0 ? [{ key: "draft", label: "Drafts", count: draftList.length }] : []),
          { key: "failed", label: "Failed", count: failedList.length, accent: failedList.length > 0 },
          { key: "paused", label: "Paused", count: pausedList.length },
          { key: "cancelled", label: "Cancelled", count: cancelledList.length },
        ].map((t) => {
          const active = tab === t.key;
          return (
            <Link
              key={t.key}
              href={(() => {
                const p = new URLSearchParams();
                if (t.key !== "active") p.set("tab", t.key);
                if (q) p.set("q", params.q!.trim());
                const qs = p.toString();
                return qs ? `/invoices/recurring?${qs}` : "/invoices/recurring";
              })()}
              className={`relative shrink-0 -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    t.accent
                      ? "bg-destructive/20 text-destructive"
                      : active
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {t.count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Search — cuts across every tab while active */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ListSearch placeholder="Search customer, site, service or alias email…" defaultValue={params.q ?? ""} />
        {q && (
          <p className="text-xs text-muted-foreground">
            {filtered.length} match{filtered.length === 1 ? "" : "es"} across all tabs
          </p>
        )}
      </div>

      <div className="surface-card mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Customer / Site</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Services</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Status</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider text-right">Monthly</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider text-right">Yearly</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Next invoice</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground text-sm">
                  {q
                    ? "No plans match your search."
                    : tab === "active"
                    ? "No active plans yet. Click \"New recurring plan\" to start one."
                    : tab === "pending"
                    ? "No plans waiting on a mandate — everyone's signed."
                    : `No ${STATUS_LABEL[tab]?.toLowerCase() ?? tab} plans.`}
                </td>
              </tr>
            )}
            {filtered.map((p) => {
              const items = p.recurring_plan_items ?? [];
              // Monthly column = monthly-equivalent of monthly + quarterly lines
              const monthly = items.filter((i) => i.frequency !== "yearly")
                .reduce((s, i) => s + Number(i.price_inc_gst) * (i.quantity ?? 1) * monthlyFactor(i.frequency), 0);
              const yearly = items.filter((i) => i.frequency === "yearly")
                .reduce((s, i) => s + Number(i.price_inc_gst) * (i.quantity ?? 1), 0);
              const colour = STATUS_COLOURS[p.status] ?? "#6b7280";
              const customerName = p.customers?.name ?? "—";
              const siteName = p.customer_sites?.name;
              // Unsigned-mandate ageing: how long we've been paying for the
              // service with nothing collectable behind it.
              const waitingDays = p.status === "pending_mandate"
                ? Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86_400_000)
                : null;
              const startBlown = p.status === "pending_mandate"
                && !!p.first_invoice_date && p.first_invoice_date < todayStr;

              return (
                <tr key={p.id} className="transition-colors hover:bg-accent/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/invoices/recurring/${p.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
                      {siteName ?? customerName}
                    </Link>
                    {siteName && (
                      <p className="text-[11px] text-muted-foreground">{customerName}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {items.length === 0
                      ? "—"
                      : items.slice(0, 3).map((i) => i.service_name).join(", ") +
                        (items.length > 3 ? ` +${items.length - 3} more` : "")}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{ backgroundColor: `${colour}20`, color: colour }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colour }} />
                      {STATUS_LABEL[p.status] ?? p.status}
                      {waitingDays !== null && waitingDays > 0 && ` · ${waitingDays}d`}
                    </span>
                    {startBlown && (
                      <p className="mt-0.5 text-[10px] font-medium text-destructive">
                        start date passed — chase signup
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm">
                    {monthly > 0 ? `$${fmt(monthly)}` : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm">
                    {yearly > 0 ? `$${fmt(yearly)}` : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {p.next_invoice_date
                      ? <span className="text-muted-foreground">{(p.status === "active"
                          ? nextMonthlyOccurrence(p.next_invoice_date)
                          : new Date(p.next_invoice_date)).toLocaleDateString("en-AU")}</span>
                      : p.status === "pending_mandate" && p.first_invoice_date
                      ? <span className={startBlown ? "text-destructive" : "text-muted-foreground"}>
                          wanted {new Date(p.first_invoice_date).toLocaleDateString("en-AU")}
                        </span>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
