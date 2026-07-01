import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ListSearch } from "@/components/ui/list-search";

function fmt(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_COLOURS: Record<string, string> = {
  draft: "#6b7280",
  authorised: "#3b82f6",
  paid: "#22c55e",
  void: "#ef4444",
  overdue: "#ef4444",
};

const TYPE_LABEL: Record<string, string> = {
  full: "Full",
  progress_pp1: "PP1",
  progress_pp2: "PP2",
  adhoc: "Ad-hoc",
  recurring: "Recurring",
};

type Tab = "active" | "unsent" | "overdue" | "drafts" | "paid" | "voided";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const supabase = await createClient();
  const params = await searchParams;
  const tab = (params.tab ?? "active") as Tab;
  const q = (params.q ?? "").trim().toLowerCase();

  const { data: invoices } = await supabase
    .from("invoices")
    .select(
      "id, xero_invoice_number, invoice_type, status, total, amount_due, due_date, paid_at, created_at, sent_at, sent_to_email, last_reminder_sent_at, reminder_count, auto_remind_enabled, customer:customers(id, name), quote:quotes(id, ref, site:customer_sites(id, name)), job:jobs(id, number, site:customer_sites(id, name))",
    )
    .order("created_at", { ascending: false })
    .limit(500);

  const now = new Date();
  const list = (invoices ?? []) as any[];

  const enriched = list.map((inv) => {
    const isOverdue =
      inv.status === "authorised" &&
      inv.due_date &&
      new Date(inv.due_date) < now &&
      Number(inv.amount_due) > 0;
    return { ...inv, _isOverdue: isOverdue };
  });

  const activeList = enriched.filter((i) => i.status === "authorised" && Number(i.amount_due) > 0);
  // Authorised in Xero but never emailed to the customer — they literally never
  // received it. Matches the dashboard "Authorised, not emailed" tile exactly.
  const unsentList = enriched.filter((i) => i.status === "authorised" && !i.sent_at);
  const overdueList = enriched.filter((i) => i._isOverdue);
  const draftsList = enriched.filter((i) => i.status === "draft");
  const paidList = enriched.filter((i) => i.status === "paid");
  const voidedList = enriched.filter((i) => i.status === "void");

  // Search cuts across every tab — you shouldn't have to know whether the
  // invoice you're hunting is active, paid or voided to find it.
  const searchList = q
    ? enriched.filter((inv) =>
        [
          inv.xero_invoice_number,
          inv.quote?.ref,
          inv.quote?.site?.name,
          inv.job?.site?.name,
          inv.job?.number,
          inv.customer?.name,
          inv.sent_to_email,
        ].some((v) => v && String(v).toLowerCase().includes(q)),
      )
    : null;

  const filtered =
    searchList ??
    (tab === "unsent" ? unsentList
    : tab === "overdue" ? overdueList
    : tab === "drafts" ? draftsList
    : tab === "paid" ? paidList
    : tab === "voided" ? voidedList
    : activeList);

  // Metrics
  const outstanding = activeList.reduce((s, i) => s + Number(i.amount_due), 0);
  const overdueAmt = overdueList.reduce((s, i) => s + Number(i.amount_due), 0);
  const paidThisMonth = (() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return paidList
      .filter((i) => i.paid_at && new Date(i.paid_at) >= monthStart)
      .reduce((s, i) => s + Number(i.total), 0);
  })();

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Invoices</h1>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{enriched.length}</span> total · status mirrored from Xero via webhook
          </p>
        </div>
      </div>

      {/* Metrics */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="surface-card card-hover p-5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Outstanding</p>
          <p className="num-display num-gradient mt-2 text-2xl font-semibold">${fmt(outstanding)}</p>
        </div>
        <div className={`surface-card card-hover p-5 ${overdueAmt > 0 ? "border-destructive/30 bg-destructive/5" : ""}`}>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Overdue</p>
          <p className={`num-display mt-2 text-2xl font-semibold ${overdueAmt > 0 ? "text-destructive" : "num-gradient"}`}>${fmt(overdueAmt)}</p>
        </div>
        <div className="surface-card card-hover p-5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Paid this month</p>
          <p className="num-display mt-2 text-2xl font-semibold text-emerald-400">${fmt(paidThisMonth)}</p>
        </div>
      </div>

      {/* Tab strip — matches the quoting page so the two feel like siblings */}
      <div className="mt-5 flex flex-nowrap items-center gap-1 border-b border-border overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
        {[
          { key: "active", label: "Active", count: activeList.length },
          { key: "unsent", label: "Needs sending", count: unsentList.length, accent: unsentList.length > 0 },
          { key: "overdue", label: "Overdue", count: overdueList.length, accent: overdueList.length > 0 },
          { key: "drafts", label: "Drafts", count: draftsList.length },
          { key: "paid", label: "Paid", count: paidList.length },
          { key: "voided", label: "Voided", count: voidedList.length },
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
                return qs ? `/invoices?${qs}` : "/invoices";
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
        <ListSearch placeholder="Search invoice #, quote ref, site or customer…" defaultValue={params.q ?? ""} />
        {q && (
          <p className="text-xs text-muted-foreground">
            {filtered.length} match{filtered.length === 1 ? "" : "es"} across all tabs
          </p>
        )}
      </div>

      {/* List */}
      <div className="surface-card mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Invoice</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider hidden sm:table-cell">Type</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Site</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider hidden md:table-cell">Customer</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Status</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Sent</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider text-right">Total</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider text-right">Due</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider hidden md:table-cell">Due date</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider hidden lg:table-cell">Reminded</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground text-sm">
                  {q
                    ? "No invoices match your search."
                    : tab === "active"
                    ? "Nothing outstanding — sent invoices awaiting payment appear here."
                    : tab === "unsent"
                    ? "All authorised invoices have been emailed — nothing waiting to send."
                    : tab === "overdue"
                    ? "No overdue invoices."
                    : `No ${tab} invoices.`}
                </td>
              </tr>
            )}
            {filtered.map((inv) => {
              const colour = STATUS_COLOURS[inv.status] ?? "#6b7280";
              const isOverdue = inv._isOverdue;
              const siteName = inv.quote?.site?.name ?? inv.job?.site?.name ?? null;
              const lastReminded = inv.last_reminder_sent_at
                ? Math.floor((Date.now() - new Date(inv.last_reminder_sent_at).getTime()) / 86_400_000)
                : null;
              return (
                <tr key={inv.id} className="transition-colors hover:bg-accent/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/invoices/${inv.id}`} className="font-mono text-sm text-foreground hover:text-primary transition-colors">
                      {inv.xero_invoice_number ?? "—"}
                    </Link>
                    {inv.quote?.ref && (
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{inv.quote.ref}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">{TYPE_LABEL[inv.invoice_type] ?? inv.invoice_type}</td>
                  <td className="px-4 py-2.5 text-sm font-medium">
                    {siteName ? (
                      <span className="text-foreground">{siteName}</span>
                    ) : (
                      <span className="text-foreground">{inv.customer?.name ?? "—"}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground hidden md:table-cell">
                    {siteName ? (inv.customer?.name ?? "—") : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize"
                        style={{ backgroundColor: `${colour}20`, color: colour }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colour }} />
                        {inv.status}
                      </span>
                      {isOverdue && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive uppercase tracking-wide">
                          Overdue
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {inv.sent_at ? (
                      <span
                        className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400"
                        title={`Emailed ${new Date(inv.sent_at).toLocaleString("en-AU")}${inv.sent_to_email ? ` to ${inv.sent_to_email}` : ""}`}
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        {new Date(inv.sent_at).toLocaleDateString("en-AU")}
                      </span>
                    ) : inv.status === "authorised" ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive uppercase tracking-wide"
                        title="Authorised in Xero but never emailed — the customer hasn't received this"
                      >
                        Not sent
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm">${fmt(Number(inv.total))}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm">
                    {Number(inv.amount_due) > 0 ? (
                      <span className={isOverdue ? "text-red-400" : "text-amber-400"}>${fmt(Number(inv.amount_due))}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs hidden md:table-cell">
                    {inv.due_date ? (
                      <span className={isOverdue ? "text-red-400 font-medium" : "text-muted-foreground"}>
                        {new Date(inv.due_date).toLocaleDateString("en-AU")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs hidden lg:table-cell text-muted-foreground">
                    {lastReminded === null ? (
                      "—"
                    ) : lastReminded === 0 ? (
                      <span>today · {inv.reminder_count}×</span>
                    ) : (
                      <span>{lastReminded}d ago · {inv.reminder_count}×</span>
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
