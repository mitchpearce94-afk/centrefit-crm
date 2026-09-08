"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Invoice list table + bulk payment reminders (Mitchell, 2026-08-02).
 *
 * Every outstanding, Xero-linked invoice gets a tick box. Selecting one or
 * more reveals "Send reminders…", which opens a confirmation listing each
 * invoice with an editable recipient before anything is sent. Sends run one
 * at a time through the existing per-invoice route, which re-checks Xero and
 * refuses anything already paid — so a stale CRM row can never chase a
 * customer who has settled. The confirmation modal IS the explicit-email
 * gate that route demands; nothing fires without a human clicking Send.
 */

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

type Contact = { email: string | null; is_primary: boolean | null };

function contactsOf(inv: any): Contact[] {
  const c = inv.customer?.customer_contacts;
  return Array.isArray(c) ? c : [];
}

/** Same fallback chain the invoice page's reminder modal uses. */
function defaultRecipient(inv: any): string {
  if (inv.sent_to_email) return inv.sent_to_email;
  const contacts = contactsOf(inv);
  return contacts.find((c) => c.is_primary && c.email)?.email ?? contacts.find((c) => c.email)?.email ?? "";
}

// Module-level so the React purity lint is happy (Date.now() in render is flagged).
function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function canRemind(inv: any): boolean {
  return inv.status === "authorised" && Number(inv.amount_due) > 0 && Boolean(inv.xero_invoice_id);
}

export function InvoicesTable({ rows, tab, q }: { rows: any[]; tab: string; q: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const remindable = useMemo(() => rows.filter(canRemind), [rows]);
  const showSelect = remindable.length > 0;
  const allSelected = remindable.length > 0 && remindable.every((r) => selected.has(r.id));
  const selectedRows = rows.filter((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(remindable.map((r) => r.id)));
  }

  const colCount = 9 + (showSelect ? 1 : 0);

  return (
    <>
      {showSelect && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <label className="inline-flex items-center gap-2 text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-primary" />
            Select all outstanding ({remindable.length})
          </label>
          {selected.size > 0 && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="font-medium text-foreground tabular-nums">{selected.size} selected</span>
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Send reminders…
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-accent transition-colors"
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}

      <div className="surface-card mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              {showSelect && <th className="w-8 px-3 py-2.5" aria-label="Select" />}
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Invoice</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider hidden sm:table-cell">Type</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Site</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Status</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Sent</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider text-right">Total</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider text-right">Due</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider hidden md:table-cell">Due date</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider hidden lg:table-cell">Reminded</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-4 py-12 text-center text-muted-foreground text-sm">
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
            {rows.map((inv) => {
              const colour = STATUS_COLOURS[inv.status] ?? "#6b7280";
              const isOverdue = inv._isOverdue;
              const siteName = inv.site?.name ?? inv.quote?.site?.name ?? inv.job?.site?.name ?? null;
              const lastReminded = inv.last_reminder_sent_at ? daysSince(inv.last_reminder_sent_at) : null;
              const remindable = canRemind(inv);
              const isSelected = selected.has(inv.id);
              return (
                <tr key={inv.id} className={`transition-colors hover:bg-accent/40 ${isSelected ? "bg-primary/5" : ""}`}>
                  {showSelect && (
                    <td className="px-3 py-2.5">
                      {remindable ? (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(inv.id)}
                          aria-label={`Select ${inv.xero_invoice_number ?? "invoice"}`}
                          className="h-4 w-4 accent-primary"
                        />
                      ) : (
                        <span className="block h-4 w-4" />
                      )}
                    </td>
                  )}
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
                    <span className="text-foreground">{siteName ?? inv.customer?.name ?? "—"}</span>
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

      {confirmOpen && (
        <BulkReminderModal
          rows={selectedRows}
          onClose={(sentAny) => {
            setConfirmOpen(false);
            if (sentAny) {
              setSelected(new Set());
              router.refresh();
            }
          }}
        />
      )}
    </>
  );
}

type SendResult = { ok: boolean; message: string };

function BulkReminderModal({ rows, onClose }: { rows: any[]; onClose: (sentAny: boolean) => void }) {
  const { toast } = useToast();
  const [recipients, setRecipients] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, defaultRecipient(r)])),
  );
  const [phase, setPhase] = useState<"confirm" | "sending" | "done">("confirm");
  const [results, setResults] = useState<Record<string, SendResult>>({});
  const [progress, setProgress] = useState(0);

  const ready = rows.filter((r) => (recipients[r.id] ?? "").trim().length > 0);
  const missing = rows.length - ready.length;
  const totalDue = ready.reduce((s, r) => s + Number(r.amount_due), 0);

  async function send() {
    if (ready.length === 0) return;
    setPhase("sending");
    const out: Record<string, SendResult> = {};
    let i = 0;
    for (const r of ready) {
      i++;
      setProgress(i);
      try {
        const res = await fetch(`/api/invoices/${r.id}/send-reminder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: recipients[r.id].trim(), trigger: "manual" }),
        });
        const data = await res.json().catch(() => ({}));
        out[r.id] = res.ok
          ? { ok: true, message: `Sent to ${recipients[r.id].trim()} (reminder #${data.reminderNumber ?? "?"})` }
          : { ok: false, message: data.error ?? `Failed (${res.status})` };
      } catch (err) {
        out[r.id] = { ok: false, message: err instanceof Error ? err.message : "Failed" };
      }
      setResults({ ...out });
      // Breathe between sends — each one round-trips Xero to verify the
      // invoice is still unpaid, and Xero's per-minute limit is tight.
      if (i < ready.length) await new Promise((res) => setTimeout(res, 400));
    }
    setPhase("done");
    const okCount = Object.values(out).filter((v) => v.ok).length;
    toast(
      `${okCount} of ${ready.length} reminder${ready.length === 1 ? "" : "s"} sent`,
      okCount === ready.length ? "success" : "error",
    );
  }

  const sentAny = Object.values(results).some((r) => r.ok);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" />
      <div className="absolute inset-0 overflow-y-auto">
        <div className="flex min-h-full items-end sm:items-center justify-center p-3 sm:p-4">
          <div className="relative w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl">
            <div className="p-5 space-y-4">
              <div>
                <h2 className="text-lg font-bold">
                  {phase === "done" ? "Reminders sent" : `Send ${ready.length} payment reminder${ready.length === 1 ? "" : "s"}`}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {phase === "confirm" && (
                    <>
                      Each reminder re-checks Xero first — anything already paid or voided is skipped automatically.
                      {missing > 0 && (
                        <span className="text-amber-400"> {missing} invoice{missing === 1 ? " has" : "s have"} no email on file and will be skipped.</span>
                      )}
                    </>
                  )}
                  {phase === "sending" && `Sending ${progress} of ${ready.length}…`}
                  {phase === "done" && `${Object.values(results).filter((r) => r.ok).length} sent · ${Object.values(results).filter((r) => !r.ok).length} not sent`}
                </p>
              </div>

              <div className="max-h-[50dvh] overflow-y-auto -mx-1 px-1 divide-y divide-border rounded-md border border-border">
                {rows.map((r) => {
                  const siteName = r.site?.name ?? r.quote?.site?.name ?? r.job?.site?.name ?? r.customer?.name ?? "—";
                  const result = results[r.id];
                  return (
                    <div key={r.id} className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2.5 text-sm">
                      <div className="min-w-0 sm:w-56 shrink-0">
                        <p className="font-mono text-foreground">{r.xero_invoice_number ?? "—"}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {siteName} · <span className="text-amber-400">${fmt(Number(r.amount_due))}</span>
                          {r.reminder_count ? ` · ${r.reminder_count}× reminded` : ""}
                        </p>
                      </div>
                      <div className="flex-1 min-w-0">
                        {phase === "confirm" ? (
                          <input
                            type="email"
                            value={recipients[r.id] ?? ""}
                            onChange={(e) => setRecipients((prev) => ({ ...prev, [r.id]: e.target.value }))}
                            placeholder="No email on file — type one to include"
                            className="block w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        ) : result ? (
                          <p className={`text-xs ${result.ok ? "text-emerald-400" : "text-destructive"}`}>{result.message}</p>
                        ) : (recipients[r.id] ?? "").trim() ? (
                          <p className="text-xs text-muted-foreground">Waiting…</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Skipped — no email</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t border-border">
                <p className="text-[11px] text-muted-foreground">
                  {phase === "confirm" && ready.length > 0 && `Total outstanding across selection: $${fmt(totalDue)}`}
                </p>
                <div className="flex flex-col-reverse sm:flex-row gap-2">
                  {phase === "confirm" && (
                    <>
                      <button
                        type="button"
                        onClick={() => onClose(false)}
                        className="w-full sm:w-auto rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={send}
                        disabled={ready.length === 0}
                        className="w-full sm:w-auto rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        Send {ready.length} reminder{ready.length === 1 ? "" : "s"}
                      </button>
                    </>
                  )}
                  {phase === "sending" && (
                    <button type="button" disabled className="w-full sm:w-auto rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground opacity-60">
                      Sending {progress}/{ready.length}…
                    </button>
                  )}
                  {phase === "done" && (
                    <button
                      type="button"
                      onClick={() => onClose(sentAny)}
                      className="w-full sm:w-auto rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Close
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
