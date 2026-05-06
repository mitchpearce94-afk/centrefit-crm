"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import {
  XERO_SALES_ACCOUNTS,
  XERO_OUTPUT_TAX_TYPES,
} from "@/lib/xero/account-codes";

interface EditableLine {
  description: string;
  quantity: number;
  unitAmount: number;
  accountCode: string;
  taxType: string;
}

interface InitialLine {
  description: string;
  quantity?: number;
  unitAmount: number;
  accountCode?: string;
  taxType?: string;
}

function fmt(n: number): string {
  return n.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function LineItemsEditor({
  invoiceId,
  initialLines,
}: {
  invoiceId: string;
  initialLines: InitialLine[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [lines, setLines] = useState<EditableLine[]>(() =>
    initialLines.map((li) => ({
      description: li.description ?? "",
      quantity: li.quantity ?? 1,
      unitAmount: Number(li.unitAmount ?? 0),
      accountCode: li.accountCode ?? "200",
      taxType: li.taxType ?? "OUTPUT",
    })),
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const totals = useMemo(() => {
    let subtotal = 0;
    let gst = 0;
    for (const l of lines) {
      const lineTotal = (l.quantity || 0) * (l.unitAmount || 0);
      subtotal += lineTotal;
      if (l.taxType === "OUTPUT") gst += lineTotal * 0.1;
    }
    return { subtotal, gst, total: subtotal + gst };
  }, [lines]);

  function update(i: number, patch: Partial<EditableLine>) {
    setLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    );
    setDirty(true);
  }

  function remove(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
    setDirty(true);
  }

  function add() {
    setLines((prev) => [
      ...prev,
      {
        description: "",
        quantity: 1,
        unitAmount: 0,
        accountCode: "200",
        taxType: "OUTPUT",
      },
    ]);
    setDirty(true);
  }

  function move(i: number, dir: -1 | 1) {
    setLines((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
    setDirty(true);
  }

  async function save() {
    if (lines.length === 0) {
      toast("Add at least one line item", "error");
      return;
    }
    for (const [i, l] of lines.entries()) {
      if (!l.description.trim()) {
        toast(`Line ${i + 1} needs a description`, "error");
        return;
      }
      if (!Number.isFinite(l.unitAmount)) {
        toast(`Line ${i + 1} has an invalid unit amount`, "error");
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/update-lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineItems: lines }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast("Line items saved and pushed to Xero");
      setDirty(false);
      router.refresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    }
    setSaving(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Line Items
        </h2>
        <span className="text-[10px] text-muted-foreground">
          Editable while invoice is in draft. Save pushes to Xero.
        </span>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="hidden md:grid md:grid-cols-[1fr_70px_110px_200px_140px_90px_28px] gap-2 bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <div>Description</div>
          <div className="text-right">Qty</div>
          <div className="text-right">Unit (ex GST)</div>
          <div>Account</div>
          <div>Tax</div>
          <div className="text-right">Line total</div>
          <div></div>
        </div>

        {lines.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground italic">
            No line items. Click <span className="font-medium">Add line</span> to begin.
          </p>
        )}

        {lines.map((line, i) => {
          const lineTotal = (line.quantity || 0) * (line.unitAmount || 0);
          return (
            <div
              key={i}
              className="border-t border-border first:border-t-0 px-3 py-3 grid grid-cols-1 md:grid-cols-[1fr_70px_110px_200px_140px_90px_28px] gap-2 items-start"
            >
              <textarea
                value={line.description}
                onChange={(e) => update(i, { description: e.target.value })}
                placeholder="Description"
                rows={2}
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs resize-y min-h-[3.5rem]"
              />
              <input
                type="number"
                inputMode="decimal"
                value={line.quantity}
                onChange={(e) => update(i, { quantity: Number(e.target.value) })}
                step="any"
                min="0"
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs font-mono text-right"
              />
              <input
                type="number"
                inputMode="decimal"
                value={line.unitAmount}
                onChange={(e) =>
                  update(i, { unitAmount: Number(e.target.value) })
                }
                step="0.01"
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs font-mono text-right"
              />
              <select
                value={line.accountCode}
                onChange={(e) => update(i, { accountCode: e.target.value })}
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
              >
                {XERO_SALES_ACCOUNTS.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} · {a.name}
                  </option>
                ))}
                {!XERO_SALES_ACCOUNTS.find(
                  (a) => a.code === line.accountCode,
                ) && (
                  <option value={line.accountCode}>
                    {line.accountCode} (unknown)
                  </option>
                )}
              </select>
              <select
                value={line.taxType}
                onChange={(e) => update(i, { taxType: e.target.value })}
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
              >
                {XERO_OUTPUT_TAX_TYPES.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </select>
              <div className="text-right font-mono text-xs pt-1.5 self-center md:self-start">
                ${fmt(lineTotal)}
              </div>
              <div className="flex md:flex-col items-center md:items-end gap-1">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30 leading-none px-1"
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === lines.length - 1}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30 leading-none px-1"
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="text-red-400 hover:text-red-300 leading-none px-1"
                  title="Remove line"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors"
        >
          <span className="text-base leading-none">+</span> Add line
        </button>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            Subtotal{" "}
            <span className="font-mono text-foreground ml-1">
              ${fmt(totals.subtotal)}
            </span>
          </span>
          <span>
            GST{" "}
            <span className="font-mono text-foreground ml-1">
              ${fmt(totals.gst)}
            </span>
          </span>
          <span>
            Total{" "}
            <span className="font-mono text-foreground ml-1 font-bold">
              ${fmt(totals.total)}
            </span>
          </span>
        </div>

        <button
          type="button"
          onClick={save}
          disabled={saving || lines.length === 0 || !dirty}
          className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {saving
            ? "Pushing to Xero…"
            : dirty
              ? "Save & push to Xero"
              : "Saved"}
        </button>
      </div>
    </div>
  );
}
