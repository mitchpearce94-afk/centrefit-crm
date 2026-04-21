"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

interface Props {
  invoiceId: string;
  payLink: string | null;
}

export function InvoiceActions({ invoiceId, payLink }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);

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

  async function copyPayLink() {
    if (!payLink) {
      toast("No pay-now link on this invoice", "error");
      return;
    }
    await navigator.clipboard.writeText(payLink);
    toast("Pay-now link copied");
  }

  return (
    <div className="flex items-center gap-2">
      {payLink && (
        <button
          onClick={copyPayLink}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          Copy pay link
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
