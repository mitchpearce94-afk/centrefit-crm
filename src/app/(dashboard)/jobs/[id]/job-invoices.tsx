"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

interface Invoice {
  id: string;
  invoice_type: "full" | "progress_pp1" | "progress_pp2" | "adhoc";
  status: "draft" | "authorised" | "paid" | "void";
  total: number;
  amount_due: number;
  amount_paid: number;
  xero_invoice_number: string | null;
  xero_online_url: string | null;
  paid_at: string | null;
  due_date: string | null;
}

interface LinkedQuote {
  id: string;
  ref: string;
  status: string;
}

interface ChecklistItem {
  id: string;
  title: string;
  is_completed: boolean;
  sort_order: number;
  sub_items?: Array<{ text?: string; done?: boolean }> | null;
}

interface WorkEntryMaterial {
  qty?: number;
  name?: string;
  sku?: string;
  product_id?: string;
}

interface WorkEntry {
  id: string;
  work_date: string;
  content: string | null;
  labour_hours: number | null;
  call_out: boolean | null;
  materials?: WorkEntryMaterial[] | null;
  staff?: { display_name?: string | null } | null;
}

interface LineItemDraft {
  id: string;
  description: string;
  quantity: string;
  unitAmount: string;
}

interface BillingSettings {
  labour_sell_rate: number;
  callout_fee_sell: number;
}

interface ProductPrice {
  sell_price: number;
  cost_price: number;
}

interface Props {
  jobId: string;
  customerId: string | null;
  jobDescription: string | null;
  jobNumber: string | null;
  invoices: Invoice[];
  linkedQuotes: LinkedQuote[];
  checklistItems: ChecklistItem[];
  workEntries: WorkEntry[];
  productPrices: Record<string, ProductPrice>;
  billingSettings: BillingSettings;
}

const STATUS_COLOURS: Record<Invoice["status"], string> = {
  draft: "#6b7280",
  authorised: "#3b82f6",
  paid: "#22c55e",
  void: "#ef4444",
};

const TYPE_LABEL: Record<Invoice["invoice_type"], string> = {
  full: "Full",
  progress_pp1: "PP1",
  progress_pp2: "PP2",
  adhoc: "Ad-hoc",
};

function fmt(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function newRow(): LineItemDraft {
  return {
    id: `row_${Math.random().toString(36).slice(2, 10)}`,
    description: "",
    quantity: "1",
    unitAmount: "",
  };
}

/**
 * Build the invoice narrative from the job's description + completed checklist
 * items + work-log entries. This is what the customer sees at the top of the
 * Xero invoice as a $0 line item. Priced things (labour, call-out, materials)
 * live in the line items instead — they're built separately in
 * buildAutoLineItems so they appear at quoted rates.
 */
function buildNarrative(
  jobDescription: string | null,
  checklistItems: ChecklistItem[],
  workEntries: WorkEntry[],
): string {
  const parts: string[] = [];

  if (jobDescription?.trim()) {
    parts.push(jobDescription.trim());
  }

  const completedChecklist = [...checklistItems]
    .filter((c) => c.is_completed)
    .sort((a, b) => a.sort_order - b.sort_order);

  if (completedChecklist.length > 0) {
    parts.push("");
    parts.push("Checklist completed:");
    for (const c of completedChecklist) {
      parts.push(`  • ${c.title}`);
      for (const sub of c.sub_items ?? []) {
        if (sub?.done && sub.text?.trim()) parts.push(`      – ${sub.text}`);
      }
    }
  }

  // Work entries sorted oldest → newest so the invoice reads chronologically
  const sortedWork = [...workEntries]
    .filter((w) => (w.content ?? "").trim())
    .sort((a, b) => (a.work_date ?? "").localeCompare(b.work_date ?? ""));

  if (sortedWork.length > 0) {
    parts.push("");
    parts.push("Work completed:");
    for (const w of sortedWork) {
      const date = w.work_date
        ? new Date(w.work_date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
        : "";
      const by = w.staff?.display_name ? ` (${w.staff.display_name})` : "";
      const content = (w.content ?? "").trim();
      if (content) parts.push(`  • ${date}${by}: ${content}`);
    }
  }

  return parts.join("\n");
}

/**
 * Auto-build priced line items from the work log:
 *   - One labour line: Σ labour_hours × labour_sell_rate
 *   - One call-out line: (# of call_out=true entries) × callout_fee_sell
 *   - One line per unique material: aggregated qty × product.sell_price
 * Plus one empty row at the end for the user to add anything extra.
 */
function buildAutoLineItems(
  workEntries: WorkEntry[],
  productPrices: Record<string, ProductPrice>,
  billing: BillingSettings,
): LineItemDraft[] {
  const rows: LineItemDraft[] = [];

  // Labour
  const totalHours = workEntries.reduce((s, w) => s + (Number(w.labour_hours) || 0), 0);
  if (totalHours > 0) {
    rows.push({
      id: `row_labour`,
      description: `Labour — ${totalHours} hour${totalHours === 1 ? "" : "s"}`,
      quantity: String(totalHours),
      unitAmount: billing.labour_sell_rate.toFixed(2),
    });
  }

  // Call-out fee (one line, qty = number of call-out entries)
  const calloutCount = workEntries.filter((w) => w.call_out === true).length;
  if (calloutCount > 0) {
    rows.push({
      id: `row_callout`,
      description: calloutCount === 1 ? "Call-out fee" : `Call-out fee (×${calloutCount})`,
      quantity: String(calloutCount),
      unitAmount: billing.callout_fee_sell.toFixed(2),
    });
  }

  // Materials — aggregate across all work entries, keyed by product_id (fall
  // back to a name+sku key when there's no product_id, so manual entries still
  // merge sensibly).
  const materialMap = new Map<string, { name: string; sku: string | null; qty: number; unit: number }>();
  for (const w of workEntries) {
    for (const m of w.materials ?? []) {
      if (!m?.name) continue;
      const key = m.product_id ?? `manual::${m.sku ?? ""}::${m.name}`;
      const qty = Number(m.qty) || 1;
      const unit = m.product_id && productPrices[m.product_id]
        ? productPrices[m.product_id].sell_price
        : 0;
      const existing = materialMap.get(key);
      if (existing) {
        existing.qty += qty;
      } else {
        materialMap.set(key, { name: m.name, sku: m.sku ?? null, qty, unit });
      }
    }
  }
  let matIdx = 0;
  for (const mat of materialMap.values()) {
    const skuSuffix = mat.sku ? ` (${mat.sku})` : "";
    rows.push({
      id: `row_mat_${matIdx++}`,
      description: `${mat.name}${skuSuffix}`,
      quantity: String(mat.qty),
      unitAmount: mat.unit.toFixed(2),
    });
  }

  // Trailing blank row for manual additions
  rows.push(newRow());
  return rows;
}

export function JobInvoices({
  jobId, customerId, jobDescription, jobNumber,
  invoices, linkedQuotes, checklistItems, workEntries,
  productPrices, billingSettings,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<LineItemDraft[]>([newRow()]);

  const hasLinkedQuote = linkedQuotes.length > 0;
  const primaryQuote = linkedQuotes[0] ?? null;

  const totals = useMemo(() => {
    let subtotal = 0;
    for (const r of rows) {
      const qty = Number(r.quantity) || 0;
      const amount = Number(r.unitAmount) || 0;
      subtotal += qty * amount;
    }
    const gst = subtotal * 0.1;
    return { subtotal, gst, total: subtotal + gst };
  }, [rows]);

  function rebuildFromJob() {
    setDescription(buildNarrative(jobDescription, checklistItems, workEntries));
    setRows(buildAutoLineItems(workEntries, productPrices, billingSettings));
  }

  function openModal() {
    rebuildFromJob();
    setShowModal(true);
  }

  function closeModal() {
    if (busy) return;
    setShowModal(false);
  }

  function updateRow(id: string, patch: Partial<LineItemDraft>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, newRow()]);
  }

  function removeRow(id: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }

  async function submit() {
    if (!customerId) {
      toast("Job has no linked customer", "error");
      return;
    }
    const lineItems = rows
      .filter((r) => r.description.trim() && Number(r.unitAmount) > 0)
      .map((r) => ({
        description: r.description.trim(),
        quantity: Number(r.quantity) || 1,
        unitAmount: Number(r.unitAmount),
      }));
    if (lineItems.length === 0) {
      toast("Add at least one line item with a description and amount", "error");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/invoices/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "adhoc",
          jobId,
          customerId,
          description: description.trim() || undefined,
          lineItems,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create invoice");
      toast(`Invoice ${data.invoice?.xero_invoice_number ?? "created"}`);
      setShowModal(false);
      router.refresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to create invoice", "error");
    }
    setBusy(false);
  }

  async function handleRefresh(invoiceId: string) {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/refresh`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Refresh failed");
      toast("Invoice refreshed");
      router.refresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Refresh failed", "error");
    }
  }

  async function copyPayLink(url: string | null) {
    if (!url) { toast("No pay-now link", "error"); return; }
    await navigator.clipboard.writeText(url);
    toast("Pay-now link copied");
  }

  function renderInvoiceCard(inv: Invoice) {
    const colour = STATUS_COLOURS[inv.status];
    return (
      <div key={inv.id} className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/invoices/${inv.id}`}
                className="text-sm font-semibold text-foreground hover:text-primary transition-colors font-mono"
              >
                {inv.xero_invoice_number ?? "—"}
              </Link>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize"
                style={{ backgroundColor: `${colour}20`, color: colour }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colour }} />
                {inv.status}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {TYPE_LABEL[inv.invoice_type]}
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
              <span className="font-mono text-foreground text-sm">${fmt(inv.total)}</span>
              <span>inc GST</span>
              {inv.status !== "paid" && inv.amount_due > 0 && (
                <span className="text-amber-400">${fmt(inv.amount_due)} due</span>
              )}
              {inv.status === "paid" && inv.paid_at && (
                <span className="text-emerald-400">Paid {new Date(inv.paid_at).toLocaleDateString("en-AU")}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {inv.xero_online_url && (
              <button
                onClick={() => copyPayLink(inv.xero_online_url)}
                className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                Copy pay link
              </button>
            )}
            <button
              onClick={() => handleRefresh(inv.id)}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Invoices
        </h2>
        {customerId && !hasLinkedQuote && (
          <button
            onClick={openModal}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Generate Invoice
          </button>
        )}
      </div>

      {/* When this job is tied to a quote, direct invoicing lives on the quote. */}
      {hasLinkedQuote && primaryQuote && (
        <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="text-xs text-foreground">
            This job is linked to{" "}
            {linkedQuotes.length === 1 ? (
              <Link href={`/quoting/${primaryQuote.id}`} className="font-mono text-primary hover:underline">
                quote {primaryQuote.ref}
              </Link>
            ) : (
              <>{linkedQuotes.length} quotes</>
            )}
            . Generate invoices from {linkedQuotes.length === 1 ? "that quote" : "the quote"} — not here.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {invoices.length === 0 && !hasLinkedQuote && (
          <p className="text-xs text-muted-foreground italic">
            {customerId
              ? "No invoices yet. Click Generate Invoice to raise one from this job's description, checklist, and work log."
              : "Link a customer to this job to generate invoices."}
          </p>
        )}
        {invoices.map(renderInvoiceCard)}
      </div>

      {/* ── ADHOC INVOICE MODAL ── */}
      {showModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative w-full max-w-[760px] max-h-[90vh] overflow-hidden rounded-xl bg-background border border-border shadow-2xl flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Generate Invoice</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Job {jobNumber ?? ""} — ad-hoc invoice pushed to Xero as AUTHORISED
                </p>
              </div>
              <button onClick={closeModal} disabled={busy} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18" /><path d="M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Narrative */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    What the customer sees
                  </label>
                  <button
                    onClick={rebuildFromJob}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    Rebuild from job
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground mb-1.5">
                  Appears at the top of the invoice at $0 — this is the proof of work.
                  Pre-filled with the job description, completed checklist, and work-log entries. Edit freely.
                </p>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={14}
                  placeholder="Describe the work completed…"
                  className="w-full resize-y rounded-md border border-border bg-input px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none font-mono whitespace-pre"
                />
              </div>

              {/* Priced line items */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Priced Line Items
                  </label>
                  <button
                    onClick={addRow}
                    className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    + Add line
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Auto-filled at quoted rates: labour @ ${billingSettings.labour_sell_rate.toFixed(2)}/hr, call-out @ ${billingSettings.callout_fee_sell.toFixed(2)}, materials at their sell price. Unit price is ex GST — Xero adds 10% GST.
                </p>

                <div className="space-y-1.5">
                  {rows.map((r) => (
                    <div key={r.id} className="flex items-start gap-1.5">
                      <input
                        type="text"
                        value={r.description}
                        onChange={(e) => updateRow(r.id, { description: e.target.value })}
                        placeholder="e.g. Labour — call-out + 2hrs"
                        className="flex-1 rounded-md border border-border bg-input px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={r.quantity}
                        onChange={(e) => updateRow(r.id, { quantity: e.target.value })}
                        placeholder="Qty"
                        className="w-16 rounded-md border border-border bg-input px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none text-right font-mono"
                      />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={r.unitAmount}
                        onChange={(e) => updateRow(r.id, { unitAmount: e.target.value })}
                        placeholder="Unit $ ex GST"
                        className="w-32 rounded-md border border-border bg-input px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none text-right font-mono"
                      />
                      <button
                        onClick={() => removeRow(r.id)}
                        disabled={rows.length <= 1}
                        className="rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:text-red-400 disabled:opacity-30 transition-colors"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal (ex GST)</span><span className="font-mono">${fmt(totals.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">GST (10%)</span><span className="font-mono">${fmt(totals.gst)}</span></div>
                <div className="flex justify-between font-semibold border-t border-border pt-1 mt-1"><span>Total (inc GST)</span><span className="font-mono">${fmt(totals.total)}</span></div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3 bg-muted/30">
              <button
                onClick={closeModal}
                disabled={busy}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {busy ? "Creating…" : "Create invoice in Xero"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
