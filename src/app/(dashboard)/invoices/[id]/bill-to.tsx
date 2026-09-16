"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { XeroContactPicker, type PickedXeroContact } from "@/components/xero-contact-picker";

/**
 * "Billed to" line on the invoice page (docs/billing-contact-CONTEXT.md D1–D3).
 * Shows the Xero contact the invoice is billed to, lets staff preview the
 * real Xero PDF, and re-bill a draft / unpaid authorised invoice to another
 * contact — optionally making the site bill there from now on.
 */
export function BillTo({
  invoiceId,
  billToName,
  xeroContactId,
  status,
  amountPaid,
  siteName,
  hasXero,
}: {
  invoiceId: string;
  billToName: string | null;
  xeroContactId: string | null;
  status: string;
  amountPaid: number;
  siteName: string | null;
  hasXero: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [picking, setPicking] = useState(false);
  const [linkSite, setLinkSite] = useState(true);
  const canRebill = hasXero && (status === "draft" || (status === "authorised" && amountPaid === 0));

  async function rebill(c: PickedXeroContact) {
    const res = await fetch(`/api/invoices/${invoiceId}/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ xeroContactId: c.id, linkSite: linkSite && !!siteName }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(j.error || "Couldn't change the billed-to contact", "error");
      return;
    }
    toast(`Now billed to ${j.billToName ?? c.name}${j.siteLinked ? ` — ${siteName} will bill there from now on` : ""}`);
    setPicking(false);
    router.refresh();
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="text-muted-foreground">Billed to</span>
      <span className="font-medium text-foreground">
        {billToName ?? (hasXero ? <span className="text-muted-foreground italic">not synced yet — Refresh</span> : "—")}
      </span>
      {hasXero && (
        <button
          type="button"
          onClick={() => window.open(`/api/invoices/${invoiceId}/pdf`, "_blank", "noopener")}
          className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          title="Open the invoice PDF exactly as Xero renders it now"
        >
          Preview PDF
        </button>
      )}
      {canRebill && (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          title="Bill this invoice to a different Xero contact (same invoice number)"
        >
          Change
        </button>
      )}
      {picking && (
        <XeroContactPicker
          title="Bill this invoice to…"
          intro={`Re-points the Xero invoice (same number) and refreshes its PDF. ${siteName ? `The site name stays in the reference.` : ""} Nothing is emailed.`}
          currentId={xeroContactId}
          onClose={() => setPicking(false)}
          onPick={rebill}
          confirmLabel="Re-bill invoice"
          extra={
            siteName ? (
              <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={linkSite} onChange={(e) => setLinkSite(e.target.checked)} className="mt-0.5 accent-primary" />
                <span>Also bill <span className="font-medium text-foreground">{siteName}</span> to this contact for every future invoice.</span>
              </label>
            ) : null
          }
        />
      )}
    </div>
  );
}
