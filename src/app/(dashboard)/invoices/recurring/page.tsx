import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth/current-staff";
import Link from "next/link";
import { BackfillSubscriptionsButton } from "./backfill-subscriptions-button";
import { nextMonthlyOccurrence } from "@/lib/recurring/next-occurrence";

const STATUS_LABEL: Record<string, string> = {
  pending_mandate: "Awaiting Mandate",
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
  failed: "Failed",
};
const STATUS_COLOURS: Record<string, string> = {
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
  frequency: "monthly" | "yearly";
  quantity: number;
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
  const monthly = Number(item.price_inc_gst) * (item.quantity ?? 1) * (item.frequency === "yearly" ? 1 / 12 : 1);
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
    const simMonthly = simRate * (item.quantity ?? 1) * (item.frequency === "yearly" ? 1 / 12 : 1);
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

export default async function RecurringInvoicesPage() {
  const supabase = await createClient();

  const { data: plans } = await supabase
    .from("recurring_plans")
    .select(`
      id, status, next_invoice_date, alias_email, signup_emailed_at, signup_link_url,
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
  const activeCount = list.filter((p) => p.status === "active").length;
  const pendingCount = list.filter((p) => p.status === "pending_mandate").length;

  const isAdmin = await isCurrentUserAdmin();

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
          <p className="num-display mt-2 text-2xl font-semibold text-emerald-400">{activeCount}</p>
        </div>
        <div className="surface-card card-hover p-5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Awaiting mandate</p>
          <p className={`num-display mt-2 text-2xl font-semibold ${pendingCount > 0 ? "text-amber-400" : "text-muted-foreground"}`}>{pendingCount}</p>
        </div>
      </div>

      <div className="surface-card mt-6 overflow-x-auto">
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
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground text-sm">
                  No recurring plans yet. Click "New recurring plan" to start one.
                </td>
              </tr>
            )}
            {list.map((p) => {
              const items = p.recurring_plan_items ?? [];
              const monthly = items.filter((i) => i.frequency === "monthly")
                .reduce((s, i) => s + Number(i.price_inc_gst) * (i.quantity ?? 1), 0);
              const yearly = items.filter((i) => i.frequency === "yearly")
                .reduce((s, i) => s + Number(i.price_inc_gst) * (i.quantity ?? 1), 0);
              const colour = STATUS_COLOURS[p.status] ?? "#6b7280";
              const customerName = p.customers?.name ?? "—";
              const siteName = p.customer_sites?.name;

              return (
                <tr key={p.id} className="transition-colors hover:bg-accent/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/invoices/recurring/${p.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
                      {customerName}
                    </Link>
                    {siteName && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">{siteName}</p>
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
                    </span>
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
