import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

function fmt(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_COLOURS: Record<string, string> = {
  draft: "#6b7280",
  authorised: "#3b82f6",
  paid: "#22c55e",
  void: "#ef4444",
};

const TYPE_LABEL: Record<string, string> = {
  full: "Full",
  progress_pp1: "PP1",
  progress_pp2: "PP2",
  adhoc: "Ad-hoc",
};

export default async function InvoicesPage() {
  const supabase = await createClient();

  const { data: invoices } = await supabase
    .from("invoices")
    .select("*, customer:customers(id, name), quote:quotes(id, ref)")
    .order("created_at", { ascending: false })
    .limit(500);

  const list = (invoices ?? []) as any[];

  // Top-line metrics
  const outstanding = list
    .filter((i) => i.status === "authorised")
    .reduce((s, i) => s + Number(i.amount_due), 0);
  const overdue = list
    .filter((i) => i.status === "authorised" && i.due_date && new Date(i.due_date) < new Date())
    .reduce((s, i) => s + Number(i.amount_due), 0);
  const paidThisMonth = (() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return list
      .filter((i) => i.status === "paid" && i.paid_at && new Date(i.paid_at) >= monthStart)
      .reduce((s, i) => s + Number(i.total), 0);
  })();

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Generated in Xero. Status mirrored here via refresh.
          </p>
        </div>
      </div>

      {/* Metrics */}
      <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-[10px] font-medium text-muted-foreground uppercase">Outstanding</p>
          <p className="text-lg font-bold font-mono mt-1">${fmt(outstanding)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-[10px] font-medium text-muted-foreground uppercase">Overdue</p>
          <p className={`text-lg font-bold font-mono mt-1 ${overdue > 0 ? "text-red-400" : ""}`}>${fmt(overdue)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-[10px] font-medium text-muted-foreground uppercase">Paid this month</p>
          <p className="text-lg font-bold font-mono mt-1 text-emerald-400">${fmt(paidThisMonth)}</p>
        </div>
      </div>

      {/* List */}
      <div className="mt-6 rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr className="text-left">
              <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Invoice</th>
              <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Type</th>
              <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Customer</th>
              <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Status</th>
              <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-right">Total</th>
              <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-right">Due</th>
              <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Due date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  No invoices yet. Generate one from an accepted quote.
                </td>
              </tr>
            )}
            {list.map((inv) => {
              const colour = STATUS_COLOURS[inv.status] ?? "#6b7280";
              const isOverdue = inv.status === "authorised" && inv.due_date && new Date(inv.due_date) < new Date();
              return (
                <tr key={inv.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <Link href={`/invoices/${inv.id}`} className="font-mono text-sm text-foreground hover:text-primary transition-colors">
                      {inv.xero_invoice_number ?? "—"}
                    </Link>
                    {inv.quote?.ref && (
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{inv.quote.ref}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{TYPE_LABEL[inv.invoice_type] ?? inv.invoice_type}</td>
                  <td className="px-4 py-2.5 text-sm">{inv.customer?.name ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize"
                      style={{ backgroundColor: `${colour}20`, color: colour }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colour }} />
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm">${fmt(Number(inv.total))}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm">
                    {Number(inv.amount_due) > 0 ? (
                      <span className={isOverdue ? "text-red-400" : "text-amber-400"}>${fmt(Number(inv.amount_due))}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {inv.due_date ? (
                      <span className={isOverdue ? "text-red-400 font-medium" : "text-muted-foreground"}>
                        {new Date(inv.due_date).toLocaleDateString("en-AU")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
