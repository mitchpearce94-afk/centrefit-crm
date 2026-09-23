"use client";

import { Fragment, useState } from "react";
import { ActionButton, money } from "./finance-actions";

interface Plan {
  payments: { invoice_number: string; contact: string; amount_cents: number }[];
  already_paid: { invoice_number: string; contact: string; amount_cents: number }[];
  unresolved: { status: string; note: string; amount_cents: number; contact: string | null }[];
  fee: { account_code: string; tax_type: string; amount_cents: number; contact: string };
  bank_account_code: string;
  reference: string;
}
interface Payout {
  id: string; provider: string; provider_payout_id: string; arrival_date: string;
  net_cents: number; fee_cents: number; gross_cents: number; status: string;
  items_total: number; items_matched: number; plan: Plan | null; exception: string | null;
  posted_at: string | null; reconciled_at: string | null;
}

const STATUS_CLS: Record<string, string> = {
  new: "bg-zinc-500/15 text-zinc-300",
  planned: "bg-sky-500/15 text-sky-400",
  posted: "bg-violet-500/15 text-violet-400",
  reconciled: "bg-emerald-500/15 text-emerald-400",
  exception: "bg-amber-500/15 text-amber-400",
  skipped: "bg-zinc-500/15 text-zinc-400",
};
const STATUS_LABEL: Record<string, string> = {
  new: "New", planned: "Ready to post", posted: "Posted — OK it in Xero", reconciled: "Reconciled", exception: "Needs you", skipped: "Skipped",
};

export function PayoutsTable({ payouts, mode }: { payouts: Payout[]; mode: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!payouts.length) {
    return <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No payouts yet. Press <span className="font-medium">Run now</span> to pull GoCardless payouts and match them.</div>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-accent/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Arrived</th>
            <th className="px-3 py-2 text-right">Net</th>
            <th className="px-3 py-2 text-right hidden sm:table-cell">Fee</th>
            <th className="px-3 py-2 text-center">Matched</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {payouts.map((p) => {
            const isOpen = open === p.id;
            const plan = p.plan;
            return (
              <Fragment key={p.id}>
                <tr className="border-t border-border hover:bg-accent/20 cursor-pointer" onClick={() => setOpen(isOpen ? null : p.id)}>
                  <td className="px-3 py-2 whitespace-nowrap">{p.arrival_date}<span className="ml-2 hidden text-xs text-muted-foreground md:inline">{p.provider_payout_id}</span></td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{money(p.net_cents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground hidden sm:table-cell">{money(p.fee_cents)}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{p.items_matched}/{p.items_total}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLS[p.status] ?? ""}`}>{STATUS_LABEL[p.status] ?? p.status}</span></td>
                  <td className="px-3 py-2 text-right text-xs text-muted-foreground">{isOpen ? "▲" : "▼"}</td>
                </tr>
                {isOpen ? (
                  <tr className="border-t border-border bg-accent/10">
                    <td colSpan={6} className="px-3 py-3">
                      {p.exception ? <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{p.exception}</div> : null}
                      {plan ? (
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{mode === "live" ? "Posts" : "Would post"} to {plan.bank_account_code} — {plan.reference}</div>
                            <ul className="space-y-1 text-xs">
                              {plan.payments.map((pm, i) => (
                                <li key={i} className="flex justify-between gap-2"><span className="truncate">{pm.contact} · {pm.invoice_number}</span><span className="tabular-nums">{money(pm.amount_cents)}</span></li>
                              ))}
                              {plan.fee.amount_cents > 0 ? <li className="flex justify-between gap-2 border-t border-border pt-1"><span>Fees → {plan.fee.account_code} ({plan.fee.tax_type}), contact {plan.fee.contact}</span><span className="tabular-nums">−{money(plan.fee.amount_cents)}</span></li> : null}
                              <li className="flex justify-between gap-2 font-medium"><span>Net to the feed line</span><span className="tabular-nums">{money(p.net_cents)}</span></li>
                            </ul>
                          </div>
                          <div className="space-y-2">
                            {plan.already_paid.length ? (
                              <div>
                                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Already paid in Xero (done by hand)</div>
                                <ul className="space-y-1 text-xs">{plan.already_paid.map((a, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{a.contact} · {a.invoice_number}</span><span className="tabular-nums">{money(a.amount_cents)}</span></li>)}</ul>
                              </div>
                            ) : null}
                            {plan.unresolved.length ? (
                              <div>
                                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-400">Unresolved — in Review</div>
                                <ul className="space-y-1 text-xs">{plan.unresolved.map((u, i) => <li key={i}><span className="font-medium">{u.contact ?? "Unknown"}</span> {money(u.amount_cents)} — <span className="text-muted-foreground">{u.status}: {u.note}</span></li>)}</ul>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : <div className="text-xs text-muted-foreground">Not matched yet.</div>}
                      <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                        <ActionButton url="/api/finance/payouts" body={{ id: p.id, action: "rematch" }} label="Re-match" okMessage="Re-matched" />
                        {p.status === "planned" && mode === "live" ? <ActionButton url="/api/finance/payouts" body={{ id: p.id, action: "post" }} label="Post to Xero now" variant="primary" confirm={`Post ${plan?.payments.length ?? 0} payments and the fee for this payout to Xero?`} okMessage="Posted" /> : null}
                        {p.status !== "reconciled" ? <ActionButton url="/api/finance/payouts" body={{ id: p.id, action: "mark_reconciled" }} label="I reconciled this by hand" confirm="Mark this payout reconciled? The agent will leave it alone." okMessage="Marked reconciled" /> : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
