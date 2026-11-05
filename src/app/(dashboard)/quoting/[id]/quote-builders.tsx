"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Who the quote goes to and who pays (docs/job-lifecycle-CONTEXT.md D2,
 * D10, D11). Tick the builders tendering for this site; each gets their own
 * link when the quote is sent; whoever accepts first is billed. With no
 * builders ticked, invoices go to the site owner as before.
 */
export interface SiteBuilderOption {
  id: string;
  name: string;
  email: string | null;
}

export interface TenderRow {
  siteBuilderId: string;
  status: "pending" | "sent" | "accepted" | "declined" | "lost";
  sentAt: string | null;
  viewedAt: string | null;
  respondedAt: string | null;
  responseToken: string | null;
}

const STATUS_LABEL: Record<TenderRow["status"], { label: string; colour: string }> = {
  pending: { label: "Not sent", colour: "#6b7280" },
  sent: { label: "Sent", colour: "#3b82f6" },
  accepted: { label: "Accepted", colour: "#22c55e" },
  declined: { label: "Declined", colour: "#ef4444" },
  lost: { label: "Closed", colour: "#6b7280" },
};

function dmy(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "";
}

export function QuoteBuilders({
  quoteId,
  quoteStatus,
  siteId,
  siteBuilders,
  tender,
  billTo,
  acceptedBuilderId,
  appUrl,
}: {
  quoteId: string;
  quoteStatus: string;
  siteId: string | null;
  siteBuilders: SiteBuilderOption[];
  tender: TenderRow[];
  billTo: "owner" | "builder";
  acceptedBuilderId: string | null;
  appUrl: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const closed = quoteStatus === "accepted" || quoteStatus === "declined";
  const inTender = new Map(tender.map((t) => [t.siteBuilderId, t]));

  async function toggle(b: SiteBuilderOption, on: boolean) {
    setBusy(b.id);
    try {
      const res = await fetch(`/api/quotes/${quoteId}/builders`, {
        method: on ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteBuilderId: b.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Couldn't update the tender");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't update the tender", "error");
    } finally {
      setBusy(null);
    }
  }

  async function setOwner() {
    setBusy("owner");
    try {
      const res = await fetch(`/api/quotes/${quoteId}/bill-to`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billTo: "owner" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Couldn't change who's billed");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't change who's billed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function copyLink(t: TenderRow) {
    if (!t.responseToken) return;
    await navigator.clipboard.writeText(`${appUrl}/quote-response/${t.responseToken}`);
    toast("Builder's link copied");
  }

  const accepted = siteBuilders.find((b) => b.id === acceptedBuilderId) ?? null;
  const tenderCount = tender.filter((t) => t.status !== "lost").length;

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Builders &amp; bill to
      </h2>
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <p className="text-sm font-medium">
          {accepted
            ? <>Accepted by <span className="text-success">{accepted.name}</span> — invoices bill the builder.</>
            : billTo === "builder" && tenderCount > 0
              ? `Tendered to ${tenderCount} builder${tenderCount === 1 ? "" : "s"} — whoever accepts first is invoiced.`
              : "Invoices go to the site owner."}
        </p>
        {!siteId ? (
          <p className="mt-1 text-[11px] text-muted-foreground">Link a site to the quote to tender it to builders.</p>
        ) : siteBuilders.length === 0 ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            No builders on this site. <Link href={`/sites/${siteId}`} className="text-primary hover:underline">Add them on the site&apos;s Builder tab</Link> to tender this quote.
          </p>
        ) : (
          <div className="mt-3 space-y-1.5">
            {siteBuilders.map((b) => {
              const t = inTender.get(b.id) ?? null;
              const status = t ? STATUS_LABEL[t.status] : null;
              const locked = closed || t?.status === "accepted" || t?.status === "declined" || t?.status === "lost";
              return (
                <div key={b.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2">
                  <label className={`flex items-center gap-2 text-sm ${locked ? "opacity-70" : "cursor-pointer"}`}>
                    <input
                      type="checkbox"
                      checked={!!t}
                      disabled={locked || busy === b.id}
                      onChange={(e) => toggle(b, e.target.checked)}
                      className="rounded border-border"
                    />
                    <span className="font-medium">{b.name}</span>
                  </label>
                  <span className="text-[11px] text-muted-foreground">{b.email ?? <span className="text-amber-400">no email on file</span>}</span>
                  {status && (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${status.colour}20`, color: status.colour }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.colour }} />
                      {status.label}
                      {t?.status === "sent" && t.sentAt ? ` ${dmy(t.sentAt)}` : ""}
                      {t?.status === "sent" && t.viewedAt ? ` · viewed ${dmy(t.viewedAt)}` : ""}
                      {(t?.status === "accepted" || t?.status === "declined") && t.respondedAt ? ` ${dmy(t.respondedAt)}` : ""}
                    </span>
                  )}
                  {t?.responseToken && t.status === "sent" && (
                    <button onClick={() => copyLink(t)} className="ml-auto rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent">
                      Copy link
                    </button>
                  )}
                </div>
              );
            })}
            {tenderCount > 0 && !closed && (
              <p className="text-[11px] text-muted-foreground pt-1">
                Use <span className="font-medium text-foreground">Send to Customer…</span> → <span className="font-medium text-foreground">Builders tendering</span> to email each builder their own copy and link.
              </p>
            )}
            {billTo === "builder" && tenderCount === 0 && !closed && (
              <button onClick={setOwner} disabled={busy === "owner"} className="text-[11px] text-muted-foreground hover:text-foreground">
                Bill the owner instead
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
