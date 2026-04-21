"use client";

import { useState } from "react";
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
  xero_last_synced_at: string | null;
  xero_last_error: string | null;
  due_date: string | null;
  paid_at: string | null;
  created_at: string;
}

interface Props {
  quoteId: string;
  quoteStatus: string;
  quoteType: "full" | "progress";
  pricing: {
    totalExGST?: number;
    totalIncGST?: number;
    pp1?: { total: number };
    pp2?: { total: number };
  } | null;
  invoices: Invoice[];
}

const STATUS_COLOURS: Record<Invoice["status"], string> = {
  draft: "#6b7280",
  authorised: "#3b82f6",
  paid: "#22c55e",
  void: "#ef4444",
};

const TYPE_LABEL: Record<Invoice["invoice_type"], string> = {
  full: "Full Invoice",
  progress_pp1: "PP1 — On Acceptance",
  progress_pp2: "PP2 — On Completion",
  adhoc: "Ad-hoc",
};

function fmt(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function QuoteInvoices({ quoteId, quoteStatus, quoteType, pricing, invoices }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const isAccepted = quoteStatus === "accepted";
  const pp1Existing = invoices.find((i) => i.invoice_type === "progress_pp1" && i.status !== "void");
  const pp2Existing = invoices.find((i) => i.invoice_type === "progress_pp2" && i.status !== "void");
  const fullExisting = invoices.find((i) => i.invoice_type === "full" && i.status !== "void");

  async function handleGenerate(type: "full" | "progress_pp1" | "progress_pp2") {
    setBusy(type);
    try {
      const res = await fetch("/api/invoices/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId, type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create invoice");
      toast(`${TYPE_LABEL[type]} created: ${data.invoice?.xero_invoice_number ?? ""}`);
      router.refresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to create invoice", "error");
    }
    setBusy(null);
  }

  async function handleRefresh(invoiceId: string) {
    setBusy(`refresh-${invoiceId}`);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/refresh`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Refresh failed");
      toast("Invoice status refreshed");
      router.refresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Refresh failed", "error");
    }
    setBusy(null);
  }

  async function copyPayLink(url: string | null) {
    if (!url) {
      toast("No pay-now link on this invoice yet", "error");
      return;
    }
    await navigator.clipboard.writeText(url);
    toast("Pay-now link copied");
  }

  function renderInvoiceCard(inv: Invoice) {
    const colour = STATUS_COLOURS[inv.status];
    return (
      <div key={inv.id} className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
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
              {inv.due_date && inv.status !== "paid" && (
                <span>Due {new Date(inv.due_date).toLocaleDateString("en-AU")}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {inv.xero_online_url && (
              <button
                onClick={() => copyPayLink(inv.xero_online_url)}
                className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title={inv.xero_online_url}
              >
                Copy pay link
              </button>
            )}
            <button
              onClick={() => handleRefresh(inv.id)}
              disabled={busy === `refresh-${inv.id}`}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
            >
              {busy === `refresh-${inv.id}` ? "…" : "Refresh"}
            </button>
          </div>
        </div>
        {inv.xero_last_error && (
          <p className="mt-2 text-[11px] text-red-400">Last sync error: {inv.xero_last_error}</p>
        )}
      </div>
    );
  }

  // Build action slots depending on quote type
  const slots: React.ReactNode[] = [];

  if (quoteType === "progress") {
    if (pp1Existing) {
      slots.push(renderInvoiceCard(pp1Existing));
    } else if (isAccepted) {
      const amount = Number(pricing?.pp1?.total ?? 0);
      slots.push(
        <div key="pp1-btn" className="rounded-lg border border-dashed border-border bg-muted/20 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">PP1 — On Acceptance</p>
            <p className="text-xs text-muted-foreground mt-0.5">${fmt(amount)} ex GST / ${fmt(amount * 1.1)} inc GST</p>
          </div>
          <button
            onClick={() => handleGenerate("progress_pp1")}
            disabled={busy === "progress_pp1" || amount <= 0}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {busy === "progress_pp1" ? "Generating…" : "Generate PP1 Invoice"}
          </button>
        </div>,
      );
    }

    if (pp2Existing) {
      slots.push(renderInvoiceCard(pp2Existing));
    } else if (isAccepted) {
      const amount = Number(pricing?.pp2?.total ?? 0);
      slots.push(
        <div key="pp2-btn" className="rounded-lg border border-dashed border-border bg-muted/20 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">PP2 — On Completion</p>
            <p className="text-xs text-muted-foreground mt-0.5">${fmt(amount)} ex GST / ${fmt(amount * 1.1)} inc GST</p>
          </div>
          <button
            onClick={() => handleGenerate("progress_pp2")}
            disabled={busy === "progress_pp2" || amount <= 0}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
          >
            {busy === "progress_pp2" ? "Generating…" : "Generate PP2 Invoice"}
          </button>
        </div>,
      );
    }
  } else {
    // Full quote
    if (fullExisting) {
      slots.push(renderInvoiceCard(fullExisting));
    } else if (isAccepted) {
      const amount = Number(pricing?.totalExGST ?? 0);
      slots.push(
        <div key="full-btn" className="rounded-lg border border-dashed border-border bg-muted/20 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Full Invoice</p>
            <p className="text-xs text-muted-foreground mt-0.5">${fmt(amount)} ex GST / ${fmt(amount * 1.1)} inc GST</p>
          </div>
          <button
            onClick={() => handleGenerate("full")}
            disabled={busy === "full" || amount <= 0}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {busy === "full" ? "Generating…" : "Generate Invoice"}
          </button>
        </div>,
      );
    }
  }

  if (slots.length === 0) {
    if (!isAccepted) {
      slots.push(
        <p key="empty" className="text-xs text-muted-foreground italic">
          Invoices can be generated once the quote is accepted.
        </p>,
      );
    }
  }

  // Any other invoices (e.g. ad-hoc linked to same quote — edge case, show them too)
  const extra = invoices.filter(
    (i) =>
      i.invoice_type !== "full" &&
      i.invoice_type !== "progress_pp1" &&
      i.invoice_type !== "progress_pp2",
  );

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Invoices
      </h2>
      <div className="space-y-2">
        {slots}
        {extra.map((inv) => renderInvoiceCard(inv))}
      </div>
    </div>
  );
}
