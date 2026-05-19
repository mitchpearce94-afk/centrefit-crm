import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CancelButton } from "./cancel-button";
import { EditServicesButton } from "./edit-services-button";
import { EditStartDateButton } from "./edit-start-date-button";
import { AuthoriseXeroButton } from "./authorise-xero-button";
import { accountCodeLabel } from "@/lib/xero/account-codes";
import { getAuthedClient } from "@/lib/xero/client";
import { getRepeatingInvoice, type RepeatingInvoiceState } from "@/lib/xero/repeating-invoices";

const STATUS_LABEL: Record<string, string> = {
  pending_mandate: "Awaiting Mandate",
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
  failed: "Failed",
};
const STATUS_COLOURS: Record<string, string> = {
  pending_mandate: "#fb923c",
  active: "#22c55e",
  paused: "#94a3b8",
  cancelled: "#64748b",
  failed: "#ef4444",
};

function fmt(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function RecurringPlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: plan }, { data: catalogue }] = await Promise.all([
    supabase
      .from("recurring_plans")
      .select(`
        id, status, next_invoice_date, first_invoice_date, alias_email, signup_link_url, signup_emailed_at,
        gc_customer_id, gc_mandate_id, xero_repeating_invoice_id, xero_contact_id,
        created_at, notes,
        customers(id, name),
        customer_sites(id, name, address, suburb, state, postcode),
        recurring_plan_items(id, service_id, service_name, description, price_inc_gst, frequency, account_code, quantity)
      `)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("recurring_services")
      .select("id, code, name, description, price_inc_gst, frequency")
      .eq("active", true)
      .order("sort_order"),
  ]);

  if (!plan) notFound();

  // Pull live Xero state for the template(s). Fetched sequentially to avoid
  // tripping Xero's concurrent-request limiter, with a small per-template
  // timeout — if Xero is unreachable we just hide the authorise UI rather
  // than break the whole page.
  const xeroIds = [
    { id: plan.xero_repeating_invoice_id as string | null, label: "monthly" },
    { id: (plan as { xero_repeating_invoice_secondary_id?: string | null }).xero_repeating_invoice_secondary_id ?? null, label: "yearly" },
  ].filter((x): x is { id: string; label: string } => !!x.id);
  const xeroStates: Array<{ id: string; label: string; state: RepeatingInvoiceState | null; error: string | null }> = [];
  if (xeroIds.length > 0 && plan.status === "active") {
    try {
      const { client: xero, conn } = await getAuthedClient(supabase);
      for (const x of xeroIds) {
        try {
          xeroStates.push({ id: x.id, label: x.label, state: await getRepeatingInvoice(xero, conn.tenant_id, x.id), error: null });
        } catch (e) {
          xeroStates.push({ id: x.id, label: x.label, state: null, error: e instanceof Error ? e.message : String(e) });
        }
      }
    } catch (e) {
      // Xero auth failed entirely — skip the live check, page still renders.
      console.error("Xero auth failed on plan detail page:", e);
    }
  }

  const items = plan.recurring_plan_items ?? [];
  const monthly = items.filter((i) => i.frequency === "monthly")
    .reduce((s, i) => s + Number(i.price_inc_gst) * (i.quantity ?? 1), 0);
  const yearly = items.filter((i) => i.frequency === "yearly")
    .reduce((s, i) => s + Number(i.price_inc_gst) * (i.quantity ?? 1), 0);
  const colour = STATUS_COLOURS[plan.status] ?? "#6b7280";
  const customer = Array.isArray(plan.customers) ? plan.customers[0] : plan.customers;
  const site = Array.isArray(plan.customer_sites) ? plan.customer_sites[0] : plan.customer_sites;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/invoices/recurring" className="text-xs text-muted-foreground hover:text-foreground">
            ← Recurring plans
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">{customer?.name ?? "—"}</h1>
          {site?.name && <p className="text-sm text-muted-foreground mt-0.5">{site.name}</p>}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
            style={{ backgroundColor: `${colour}20`, color: colour }}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colour }} />
            {STATUS_LABEL[plan.status] ?? plan.status}
          </span>
          {plan.status !== "cancelled" && (
            <EditServicesButton
              planId={plan.id}
              catalogue={(catalogue ?? []) as never}
              currentItems={items.map((i) => ({
                serviceId: (i as { service_id: string | null }).service_id ?? "",
                quantity: i.quantity ?? 1,
              })).filter((i) => !!i.serviceId)}
            />
          )}
          <CancelButton
            planId={plan.id}
            status={plan.status}
            customerName={customer?.name ?? "this customer"}
            siteLabel={site?.name ?? null}
          />
        </div>
      </div>

      {/* Status detail */}
      <div className="surface-card p-5 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Status</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Mandate state</dt>
          <dd className="font-medium">{STATUS_LABEL[plan.status] ?? plan.status}</dd>
          <dt className="text-muted-foreground">Next invoice date</dt>
          <dd className="font-mono">{plan.next_invoice_date ? new Date(plan.next_invoice_date).toLocaleDateString("en-AU") : "—"}</dd>
          <dt className="text-muted-foreground">Billing starts</dt>
          <dd className="font-mono flex items-center gap-2">
            {plan.first_invoice_date
              ? new Date(plan.first_invoice_date).toLocaleDateString("en-AU")
              : <span className="text-muted-foreground">When mandate verifies</span>}
            {plan.status === "pending_mandate" && (
              <EditStartDateButton planId={plan.id} currentDate={plan.first_invoice_date ?? null} />
            )}
          </dd>
          <dt className="text-muted-foreground">Mandate signup emailed</dt>
          <dd className="text-xs text-muted-foreground">{plan.signup_emailed_at ? new Date(plan.signup_emailed_at).toLocaleString("en-AU") : "—"}</dd>
          <dt className="text-muted-foreground">Alias email used</dt>
          <dd className="font-mono text-xs">{plan.alias_email ?? "—"}</dd>
        </dl>
        {plan.status === "pending_mandate" && plan.signup_link_url && (
          <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs text-amber-300 mb-2">
              Customer hasn't signed yet. They can use this link from the mandate email — or copy and resend if needed:
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={plan.signup_link_url}
                className="flex-1 rounded-md border border-border bg-input px-2 py-1 text-xs font-mono"
              />
              <a
                href={plan.signup_link_url}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-border px-3 py-1 text-xs hover:bg-accent transition-colors"
              >
                Open
              </a>
            </div>
          </div>
        )}
        {plan.notes && (
          <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">{plan.notes}</p>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="surface-card p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3">Services</h2>
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-[10px] uppercase tracking-wider">
            <tr className="text-left border-b border-border">
              <th className="pb-2">Service</th>
              <th className="pb-2 text-right">Qty</th>
              <th className="pb-2 text-right">Price (incl. GST)</th>
              <th className="pb-2 text-right">Frequency</th>
              <th className="pb-2 text-right">Xero Account</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((it) => (
              <tr key={it.id}>
                <td className="py-2">
                  <div className="font-medium">{it.service_name}</div>
                  {it.description && <div className="text-xs text-muted-foreground">{it.description}</div>}
                </td>
                <td className="py-2 text-right font-mono">{it.quantity}</td>
                <td className="py-2 text-right font-mono">${fmt(Number(it.price_inc_gst))}</td>
                <td className="py-2 text-right text-xs text-muted-foreground capitalize">{it.frequency}</td>
                <td className="py-2 text-right font-mono text-xs">{accountCodeLabel((it as { account_code?: string }).account_code)}</td>
              </tr>
            ))}
            <tr className="border-t border-border">
              <td colSpan={2} className="pt-2 text-xs text-muted-foreground">Monthly recurring</td>
              <td colSpan={3} className="pt-2 text-right font-mono font-semibold">${fmt(monthly)}</td>
            </tr>
            {yearly > 0 && (
              <tr>
                <td colSpan={2} className="text-xs text-muted-foreground">Yearly recurring</td>
                <td colSpan={3} className="text-right font-mono font-semibold">${fmt(yearly)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Linkage */}
      <div className="surface-card p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3">Integration linkage</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs font-mono">
          <dt className="text-muted-foreground">GC Customer ID</dt>
          <dd>{plan.gc_customer_id ?? "—"}</dd>
          <dt className="text-muted-foreground">GC Mandate ID</dt>
          <dd>{plan.gc_mandate_id ?? "—"}</dd>
          <dt className="text-muted-foreground">Xero Contact ID</dt>
          <dd className="truncate">{plan.xero_contact_id ?? "—"}</dd>
        </dl>

        {/* Live Xero template state — only rendered for active plans. */}
        {xeroStates.length > 0 && (
          <div className="mt-4 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Xero RepeatingInvoice templates
            </h3>
            {xeroStates.map((x) => (
              <XeroTemplateRow
                key={x.id}
                planId={plan.id}
                customerName={customer?.name ?? "this customer"}
                template={x}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function XeroTemplateRow({
  planId,
  customerName,
  template,
}: {
  planId: string;
  customerName: string;
  template: { id: string; label: string; state: RepeatingInvoiceState | null; error: string | null };
}) {
  if (template.error) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-300">
        <span className="font-mono">{template.id.slice(0, 8)}…</span> ({template.label}) — Xero
        lookup failed: {template.error.slice(0, 80)}{template.error.length > 80 ? "…" : ""}
      </div>
    );
  }
  const s = template.state!;
  const isAuthorised = s.status === "AUTHORISED";
  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono text-muted-foreground">{template.id.slice(0, 8)}…</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{template.label}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              isAuthorised
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-amber-500/15 text-amber-400"
            }`}
          >
            {s.status}
          </span>
          {s.nextScheduledDate && (
            <span className="text-[11px] text-muted-foreground">
              next:{" "}
              <span className="font-mono">
                {new Date(s.nextScheduledDate).toLocaleDateString("en-AU")}
              </span>
            </span>
          )}
          {isAuthorised && s.approvedForSending && (
            <span className="text-[11px] text-emerald-400">✓ auto-emails</span>
          )}
        </div>
        {!isAuthorised && s.status === "DRAFT" && (
          <AuthoriseXeroButton
            planId={planId}
            customerName={customerName}
            templateLabel={template.label}
            nextScheduledDate={s.nextScheduledDate}
          />
        )}
      </div>
    </div>
  );
}
