import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { InvoiceActions } from "./invoice-actions";
import { LineItemsEditor } from "./line-items-editor";
import { DocumentActivityTimeline } from "@/components/document-activity-timeline";
import { accountCodeLabel } from "@/lib/xero/account-codes";

function fmt(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_COLOURS: Record<string, string> = {
  draft: "#6b7280",
  authorised: "#3b82f6",
  paid: "#22c55e",
  void: "#ef4444",
};

const TYPE_LABEL: Record<string, string> = {
  full: "Full Invoice",
  progress_pp1: "Progress Payment 1",
  progress_pp2: "Progress Payment 2",
  adhoc: "Ad-hoc Invoice",
};

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select(
      "*, customer:customers(id, name), quote:quotes(id, ref, status, site:customer_sites(id, name, address, suburb)), job:jobs(id, number, site:customer_sites(id, name, address, suburb))"
    )
    .eq("id", id)
    .single();
  if (error || !invoice) notFound();

  const inv = invoice as any;
  const colour = STATUS_COLOURS[inv.status] ?? "#6b7280";
  const isOverdue = inv.status === "authorised" && inv.due_date && new Date(inv.due_date) < new Date();
  const lineItems = (inv.line_items ?? []) as Array<{
    description: string;
    quantity?: number;
    unitAmount: number;
    accountCode?: string;
    taxType?: string;
  }>;
  const isDraft = inv.status === "draft" && !!inv.xero_invoice_id;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <Link href="/invoices" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              &larr; Invoices
            </Link>
            <h1 className="text-2xl font-bold tracking-tight font-mono">
              {inv.xero_invoice_number ?? "—"}
            </h1>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize"
              style={{ backgroundColor: `${colour}20`, color: colour }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colour }} />
              {inv.status}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {TYPE_LABEL[inv.invoice_type] ?? inv.invoice_type}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {inv.customer?.name ?? "—"}
            {inv.quote?.ref && (
              <> · <Link href={`/quoting/${inv.quote.id}`} className="hover:text-foreground transition-colors">Quote {inv.quote.ref}</Link></>
            )}
            {inv.job?.number && (
              <> · <Link href={`/jobs/${inv.job.id}`} className="hover:text-foreground transition-colors">Job {inv.job.number}</Link></>
            )}
          </p>
          {(() => {
            const site = inv.quote?.site ?? inv.job?.site;
            if (!site) return null;
            const addressLine = [site.address, site.suburb].filter(Boolean).join(", ");
            return (
              <p className="mt-0.5 text-sm text-foreground/90">
                <span className="font-medium">{site.name}</span>
                {addressLine && (
                  <span className="text-xs text-muted-foreground ml-2">{addressLine}</span>
                )}
              </p>
            );
          })()}
        </div>
        <InvoiceActions
          invoiceId={inv.id}
          payLink={inv.xero_online_url}
          status={inv.status}
          xeroInvoiceId={inv.xero_invoice_id}
        />
      </div>

      {/* Totals */}
      <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <p className="text-[10px] font-medium text-muted-foreground uppercase">Subtotal (ex GST)</p>
          <p className="text-lg font-bold font-mono mt-1">${fmt(Number(inv.subtotal))}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <p className="text-[10px] font-medium text-muted-foreground uppercase">GST</p>
          <p className="text-lg font-bold font-mono mt-1">${fmt(Number(inv.gst))}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <p className="text-[10px] font-medium text-muted-foreground uppercase">Total (inc GST)</p>
          <p className="text-lg font-bold font-mono mt-1">${fmt(Number(inv.total))}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <p className="text-[10px] font-medium text-muted-foreground uppercase">Due</p>
          <p className={`text-lg font-bold font-mono mt-1 ${isOverdue ? "text-red-400" : Number(inv.amount_due) > 0 ? "text-amber-400" : "text-emerald-400"}`}>
            ${fmt(Number(inv.amount_due))}
          </p>
        </div>
      </div>

      {/* Dates */}
      <div className="mt-4 flex flex-wrap gap-6 text-sm text-muted-foreground">
        {inv.issued_at && (
          <span>Issued: <span className="text-foreground">{new Date(inv.issued_at).toLocaleDateString("en-AU")}</span></span>
        )}
        {inv.due_date && (
          <span>Due: <span className={isOverdue ? "text-red-400 font-medium" : "text-foreground"}>{new Date(inv.due_date).toLocaleDateString("en-AU")}</span></span>
        )}
        {inv.paid_at && (
          <span>Paid: <span className="text-emerald-400">{new Date(inv.paid_at).toLocaleDateString("en-AU")}</span></span>
        )}
        {inv.xero_last_synced_at && (
          <span className="text-xs">Last synced: {new Date(inv.xero_last_synced_at).toLocaleString("en-AU")}</span>
        )}
      </div>

      {inv.xero_last_error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
          <p className="text-xs text-red-400"><strong>Last Xero sync error:</strong> {inv.xero_last_error}</p>
        </div>
      )}

      {/* Pay link banner */}
      {inv.xero_online_url && inv.status !== "paid" && inv.status !== "void" && (
        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Customer pay link</p>
              <p className="text-xs text-muted-foreground mt-1 break-all font-mono">{inv.xero_online_url}</p>
            </div>
            <a
              href={inv.xero_online_url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
            >
              Open in Xero
            </a>
          </div>
        </div>
      )}

      {/* Header description */}
      {inv.description && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Reference</h2>
          <p className="text-sm text-foreground">{inv.description}</p>
        </div>
      )}

      {/* Line items */}
      <div className="mt-6">
        {isDraft ? (
          <LineItemsEditor invoiceId={inv.id} initialLines={lineItems} />
        ) : (
          <>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Line Items</h2>
            <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
              {lineItems.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground italic">No line items.</p>
              )}
              {lineItems.map((li, idx) => (
                <div key={idx} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground whitespace-pre-wrap">{li.description}</p>
                      {li.accountCode && (
                        <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                          {accountCodeLabel(li.accountCode)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4 shrink-0 text-right">
                      <span className="text-xs font-mono text-muted-foreground w-10 text-center">{li.quantity ?? 1}</span>
                      <span className="text-sm font-mono font-medium w-24">${fmt(Number(li.unitAmount) * (li.quantity ?? 1))}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="mt-6">
        <DocumentActivityTimeline documentType="invoice" documentId={inv.id} />
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Created {new Date(inv.created_at).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      </p>
    </div>
  );
}
