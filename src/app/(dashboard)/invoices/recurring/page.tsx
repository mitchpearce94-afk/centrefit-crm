import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

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

interface PlanItemRow {
  service_name: string;
  price_inc_gst: number | string;
  frequency: "monthly" | "yearly";
  quantity: number;
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
      recurring_plan_items(service_name, price_inc_gst, frequency, quantity)
    `)
    .order("created_at", { ascending: false });

  const list = (plans ?? []) as unknown as PlanRow[];

  // Top-line metrics
  const monthlyMRR = list
    .filter((p) => p.status === "active")
    .reduce((sum, p) => {
      const monthly = (p.recurring_plan_items ?? [])
        .filter((i) => i.frequency === "monthly")
        .reduce((s, i) => s + Number(i.price_inc_gst) * (i.quantity ?? 1), 0);
      const yearly = (p.recurring_plan_items ?? [])
        .filter((i) => i.frequency === "yearly")
        .reduce((s, i) => s + Number(i.price_inc_gst) * (i.quantity ?? 1), 0);
      return sum + monthly + yearly / 12;
    }, 0);
  const activeCount = list.filter((p) => p.status === "active").length;
  const pendingCount = list.filter((p) => p.status === "pending_mandate").length;

  return (
    <>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Recurring</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Direct-debit subscriptions. Linked to GoCardless mandates and Xero RepeatingInvoices.
          </p>
        </div>
        <Link
          href="/invoices/recurring/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + New recurring plan
        </Link>
      </div>

      {/* Metrics */}
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="surface-card card-hover p-5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Effective MRR</p>
          <p className="num-display num-gradient mt-2 text-2xl font-semibold">${fmt(monthlyMRR)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Monthly recurring (yearly ÷ 12), incl. GST</p>
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
                      ? <span className="text-muted-foreground">{new Date(p.next_invoice_date).toLocaleDateString("en-AU")}</span>
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
