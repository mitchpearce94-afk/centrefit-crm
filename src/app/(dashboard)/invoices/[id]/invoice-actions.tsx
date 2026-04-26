"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

interface Props {
  invoiceId: string;
  payLink: string | null;
  status: string;
  xeroInvoiceId: string | null;
}

export function InvoiceActions({ invoiceId, payLink, status, xeroInvoiceId }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [authorising, setAuthorising] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/refresh`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Refresh failed");
      toast("Invoice refreshed from Xero");
      router.refresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Refresh failed", "error");
    }
    setRefreshing(false);
  }

  async function handleAuthorise() {
    if (!confirm("Authorise this invoice? It will post to Xero's books (A/R, revenue, GST) and a pay-now link will be generated.")) {
      return;
    }
    setAuthorising(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/authorise`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authorise failed");
      toast("Invoice authorised in Xero");
      router.refresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Authorise failed", "error");
    }
    setAuthorising(false);
  }

  async function copyPayLink() {
    if (!payLink) {
      toast("No pay-now link on this invoice", "error");
      return;
    }
    await navigator.clipboard.writeText(payLink);
    toast("Pay-now link copied");
  }

  const xeroEditUrl = xeroInvoiceId
    ? `https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=${xeroInvoiceId}`
    : null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {payLink && (
        <button
          onClick={copyPayLink}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          Copy pay link
        </button>
      )}
      {xeroEditUrl && (
        <a
          href={xeroEditUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          Edit in Xero
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      )}
      {status === "draft" && (
        <button
          onClick={handleAuthorise}
          disabled={authorising}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {authorising ? "Authorising…" : "Authorise"}
        </button>
      )}
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {refreshing ? "Refreshing…" : "Refresh from Xero"}
      </button>
    </div>
  );
}
