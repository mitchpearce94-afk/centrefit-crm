"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

export interface LineItem {
  id: string;
  product_name: string;
  sku: string | null;
  quantity: number;
  cost_price: number;
  markup: number;
  sell_price: number;
  rfq_sent_at: string | null;
  cost_confirmed_at: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_email: string | null;
  product_cost_updated_at: string | null;
}

const FRESH_DAYS = 30;
const FRESH_MS = FRESH_DAYS * 86400 * 1000;

function isFresh(line: LineItem): boolean {
  if (!line.product_cost_updated_at) return false;
  return Date.now() - new Date(line.product_cost_updated_at).getTime() < FRESH_MS;
}

interface Group {
  supplierId: string | null;
  supplierName: string;
  supplierEmail: string | null;
  lines: LineItem[];
}

function fmt(n: number) {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-AU");
}

function StatusBadge({ line }: { line: LineItem }) {
  if (line.cost_confirmed_at) {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        ✓ Confirmed {formatRelative(line.cost_confirmed_at)}
      </span>
    );
  }
  if (isFresh(line)) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
        title={`Catalog price was confirmed ${formatRelative(line.product_cost_updated_at!)} — no RFQ needed`}
      >
        Fresh · {formatRelative(line.product_cost_updated_at!)}
      </span>
    );
  }
  if (line.rfq_sent_at) {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
        RFQ sent {formatRelative(line.rfq_sent_at)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
      Estimated
    </span>
  );
}

export function SupplierPricing({
  quoteId,
  lineItems,
}: {
  quoteId: string;
  lineItems: LineItem[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [sendingRFQ, setSendingRFQ] = useState<string | null>(null);
  const [savingLine, setSavingLine] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { cost?: string; markup?: string }>>({});

  // Group lines by supplier. Lines with no supplier go into an "Unassigned" group.
  const groups = new Map<string, Group>();
  for (const line of lineItems) {
    const key = line.supplier_id ?? "__unassigned__";
    const group =
      groups.get(key) ??
      ({
        supplierId: line.supplier_id,
        supplierName: line.supplier_name ?? "— Unassigned —",
        supplierEmail: line.supplier_email ?? null,
        lines: [],
      } as Group);
    group.lines.push(line);
    groups.set(key, group);
  }

  const orderedGroups = Array.from(groups.values()).sort((a, b) => {
    if (a.supplierId === null) return 1;
    if (b.supplierId === null) return -1;
    return a.supplierName.localeCompare(b.supplierName);
  });

  async function sendRFQ(supplierId: string) {
    setSendingRFQ(supplierId);
    try {
      const res = await fetch(`/api/quotes/${quoteId}/request-supplier-pricing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierIds: [supplierId] }),
      });
      const json = await res.json();
      if (!res.ok && (json.sent?.length ?? 0) === 0) {
        toast(json.error ?? "RFQ send failed", "error");
        return;
      }
      if (json.failures?.length > 0) {
        toast(`RFQ failed: ${json.failures[0].message}`, "error");
      } else if (json.sent?.length > 0) {
        const skippedFreshCount = json.skippedFresh?.length ?? 0;
        const freshSuffix = skippedFreshCount > 0 ? `, skipped ${skippedFreshCount} fresh line${skippedFreshCount === 1 ? "" : "s"}` : "";
        toast(`RFQ sent to ${json.sent[0].supplierName} (${json.sent[0].lineCount} line${json.sent[0].lineCount === 1 ? "" : "s"}${freshSuffix})`);
      } else if (json.skippedFresh?.length > 0) {
        toast("All lines have fresh prices — nothing to send");
      }
      router.refresh();
    } finally {
      setSendingRFQ(null);
    }
  }

  async function saveLine(line: LineItem) {
    const edit = edits[line.id];
    if (!edit) return;
    const parsedCost = edit.cost !== undefined ? Number(edit.cost) : null;
    const parsedMarkup = edit.markup !== undefined ? Number(edit.markup) : null;

    if (parsedCost === null || Number.isNaN(parsedCost) || parsedCost < 0) {
      toast("Invalid cost price", "error");
      return;
    }
    const body: Record<string, number | boolean> = {
      cost_price: parsedCost,
      recalculate_sell: true,
    };
    if (parsedMarkup !== null && !Number.isNaN(parsedMarkup) && parsedMarkup >= 0) {
      body.markup = parsedMarkup;
    }

    setSavingLine(line.id);
    try {
      const res = await fetch(`/api/quote-line-items/${line.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        toast(json.error ?? "Save failed", "error");
        return;
      }
      setEdits((prev) => {
        const next = { ...prev };
        delete next[line.id];
        return next;
      });
      toast("Price confirmed");
      router.refresh();
    } finally {
      setSavingLine(null);
    }
  }

  const totals = {
    total: lineItems.length,
    confirmed: lineItems.filter((l) => l.cost_confirmed_at).length,
    fresh: lineItems.filter((l) => !l.cost_confirmed_at && isFresh(l)).length,
    pending: lineItems.filter((l) => !l.cost_confirmed_at && !isFresh(l) && l.rfq_sent_at).length,
    estimated: lineItems.filter((l) => !l.cost_confirmed_at && !isFresh(l) && !l.rfq_sent_at).length,
  };

  if (lineItems.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 mt-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-sm font-semibold">Supplier pricing</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Confirm current prices from suppliers before sending the quote. Type prices as
            suppliers reply — sell prices auto-recalc from your markup.
          </p>
        </div>
        <div className="shrink-0 flex gap-2 text-[10px] uppercase tracking-wide">
          <span className="text-muted-foreground">{totals.estimated} est</span>
          <span className="text-amber-400">{totals.pending} pending</span>
          <span className="text-emerald-400">{totals.fresh + totals.confirmed} fresh</span>
        </div>
      </div>

      <div className="space-y-4">
        {orderedGroups.map((group) => {
          const groupKey = group.supplierId ?? "__unassigned__";
          const groupSending = sendingRFQ === group.supplierId;
          const noEmail = !group.supplierEmail;
          const nonFreshLines = group.lines.filter((l) => !isFresh(l));
          const allFresh = group.lines.length > 0 && nonFreshLines.length === 0;
          const canSendRFQ = group.supplierId !== null && !noEmail && !allFresh;

          let rfqTooltip = "Send pricing request";
          if (noEmail) rfqTooltip = "Supplier has no email set";
          else if (allFresh) rfqTooltip = "All prices confirmed within the last 30 days — no RFQ needed";

          return (
            <div key={groupKey} className="rounded-md border border-border">
              <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-3 py-2">
                <div>
                  <div className="text-sm font-medium">{group.supplierName}</div>
                  {group.supplierEmail && (
                    <div className="text-[10px] text-muted-foreground">{group.supplierEmail}</div>
                  )}
                  {group.supplierId && noEmail && (
                    <div className="text-[10px] text-amber-400">No email on file — add one to send RFQs</div>
                  )}
                  {group.supplierId && allFresh && (
                    <div className="text-[10px] text-emerald-400">All prices fresh (last 30 days)</div>
                  )}
                </div>
                {group.supplierId && (
                  <button
                    onClick={() => sendRFQ(group.supplierId!)}
                    disabled={!canSendRFQ || groupSending}
                    className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-50"
                    title={rfqTooltip}
                  >
                    {groupSending
                      ? "Sending…"
                      : allFresh
                        ? "No RFQ needed"
                        : `Send RFQ${nonFreshLines.length < group.lines.length ? ` (${nonFreshLines.length})` : ""}`}
                  </button>
                )}
              </div>

              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-1.5 font-medium">Item</th>
                    <th className="px-2 py-1.5 font-medium text-right w-12">Qty</th>
                    <th className="px-2 py-1.5 font-medium text-right w-28">Cost (ex-GST)</th>
                    <th className="px-2 py-1.5 font-medium text-right w-24">Markup</th>
                    <th className="px-2 py-1.5 font-medium text-right w-24">Sell</th>
                    <th className="px-2 py-1.5 font-medium w-32">Status</th>
                    <th className="px-2 py-1.5 font-medium text-right w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {group.lines.map((line) => {
                    const edit = edits[line.id] ?? {};
                    const isDirty = edit.cost !== undefined || edit.markup !== undefined;
                    const rowSaving = savingLine === line.id;
                    return (
                      <tr key={line.id} className="border-b border-border last:border-0 align-middle">
                        <td className="px-3 py-2">
                          <div className="font-medium">{line.product_name}</div>
                          {line.sku && (
                            <div className="font-mono text-[10px] text-muted-foreground">{line.sku}</div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right font-mono">{line.quantity}</td>
                        <td className="px-2 py-2 text-right">
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            defaultValue={line.cost_price}
                            onChange={(e) =>
                              setEdits((prev) => ({
                                ...prev,
                                [line.id]: { ...prev[line.id], cost: e.target.value },
                              }))
                            }
                            disabled={rowSaving}
                            className="w-full rounded-md border border-border bg-input px-2 py-1 text-xs text-right font-mono text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            defaultValue={line.markup}
                            onChange={(e) =>
                              setEdits((prev) => ({
                                ...prev,
                                [line.id]: { ...prev[line.id], markup: e.target.value },
                              }))
                            }
                            disabled={rowSaving}
                            className="w-full rounded-md border border-border bg-input px-2 py-1 text-xs text-right font-mono text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
                          />
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-muted-foreground">
                          ${fmt(line.sell_price)}
                        </td>
                        <td className="px-2 py-2">
                          <StatusBadge line={line} />
                        </td>
                        <td className="px-2 py-2 text-right">
                          {isDirty && (
                            <button
                              onClick={() => saveLine(line)}
                              disabled={rowSaving}
                              className="rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            >
                              {rowSaving ? "Saving…" : "Confirm"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
