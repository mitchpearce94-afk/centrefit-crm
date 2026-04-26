import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { DEVICE_TYPES } from "@/lib/quote-engine";
import { QuoteActions } from "./quote-actions";
import { QuoteInvoices } from "./quote-invoices";
import { SupplierPricing } from "./supplier-pricing";

function fmt(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_COLOURS: Record<string, string> = {
  draft: "#6b7280",
  sent: "#3b82f6",
  accepted: "#22c55e",
  declined: "#ef4444",
};

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [quoteResult, lineItemsResult, extrasResult, jobsResult, invoicesResult, productsResult, scopeRolesResult] = await Promise.all([
    supabase.from("quotes").select("*, customer:customers(id, name, customer_contacts(*)), template:quote_rule_templates(id, name, slug)").eq("id", id).single(),
    supabase
      .from("quote_line_items")
      .select("*, quote_products(supplier_id, cost_updated_at, suppliers(id, name, email))")
      .eq("quote_id", id)
      .order("sort_order"),
    supabase.from("quote_extras").select("*").eq("quote_id", id).order("sort_order"),
    supabase.from("jobs").select("id, number, customer:customers(name)").order("number", { ascending: false }).limit(200),
    supabase.from("invoices").select("*").eq("quote_id", id).order("created_at", { ascending: true }),
    supabase.from("quote_products").select("id, scope_role, name, sku"),
    supabase.from("quote_scope_roles").select("slug, description"),
  ]);
  const roleDescriptions: Record<string, string> = {};
  for (const r of scopeRolesResult.data ?? []) {
    if (r.description && r.description.trim().length > 0) {
      roleDescriptions[r.slug] = r.description.trim();
    }
  }
  const jobs = (jobsResult.data ?? []).map((j: any) => ({
    id: j.id, number: j.number,
    customer_name: Array.isArray(j.customer) ? j.customer[0]?.name : j.customer?.name || null,
  }));

  if (quoteResult.error || !quoteResult.data) notFound();

  const quote = quoteResult.data as any;
  const lineItems = (lineItemsResult.data ?? []) as any[];
  const extras = (extrasResult.data ?? []) as any[];
  const invoices = (invoicesResult.data ?? []) as any[];
  const pricing = quote.pricing_snapshot;
  const statusColour = STATUS_COLOURS[quote.status] ?? "#6b7280";
  const isProgress = quote.quote_type === "progress";

  // Group BOM by category
  const bomByCategory = new Map<string, any[]>();
  for (const item of lineItems) {
    const list = bomByCategory.get(item.category) ?? [];
    list.push(item);
    bomByCategory.set(item.category, list);
  }

  // Device count summary
  const deviceCounts = (quote.device_counts || {}) as Record<string, number>;
  const activeDevices = Object.entries(deviceCounts).filter(([, v]) => v > 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/quoting" className="text-sm text-muted-foreground hover:text-foreground transition-colors">&larr; Quotes</Link>
            <h1 className="text-2xl font-bold tracking-tight font-mono">{quote.ref}</h1>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize"
              style={{ backgroundColor: `${statusColour}20`, color: statusColour }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusColour }} />
              {quote.status}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isProgress ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
              {isProgress ? "Progress Payments" : "Full Quote"}
            </span>
            {quote.template?.name && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
                Template: {quote.template.name}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {quote.customer?.name || quote.client_name}
            {quote.site_name && ` — ${quote.site_name}`}
            {quote.site_address && <span className="ml-2 text-xs">{quote.site_address}</span>}
          </p>
        </div>
        <QuoteActions
          quoteId={quote.id}
          status={quote.status}
          quoteRef={quote.ref}
          clientName={quote.customer?.name || quote.client_name}
          siteName={quote.site_name}
          siteAddress={quote.site_address}
          quoteType={quote.quote_type || "full"}
          pricing={pricing}
          deviceCounts={deviceCounts}
          lineItems={lineItems}
          createdAt={quote.created_at}
          siteInfo={{
            site_sqm: quote.site_sqm ?? 0,
            door_count: quote.door_count ?? 0,
            external_camera_count: quote.external_camera_count ?? 0,
            concrete_mount_black: quote.concrete_mount_black ?? 0,
            concrete_mount_white: quote.concrete_mount_white ?? 0,
            cardio_count: quote.cardio_count ?? 0,
            tv_count: quote.tv_count ?? 0,
            ceiling_tv_count: quote.ceiling_tv_count ?? 0,
            wall_tv_mount_count: quote.wall_tv_mount_count ?? 0,
            ceiling_tv_mount_count: quote.ceiling_tv_mount_count ?? 0,
            separate_studio_zone: quote.separate_studio_zone ?? false,
          }}
          scopeOverrides={quote.scope_overrides ?? null}
          productScopeRoles={(productsResult.data ?? []) as any}
          roleDescriptions={roleDescriptions}
          contactEmail={quote.customer?.customer_contacts?.find((c: any) => c.is_primary)?.email ?? null}
          jobId={quote.job_id ?? null}
          jobs={jobs}
        />
      </div>

      {/* Payment tracking for progress quotes — derived from linked invoices */}
      {isProgress && quote.status === "accepted" && (() => {
        const pp1Inv = invoices.find((i) => i.invoice_type === "progress_pp1" && i.status !== "void");
        const pp2Inv = invoices.find((i) => i.invoice_type === "progress_pp2" && i.status !== "void");

        function derivedPaymentState(inv: typeof pp1Inv): { label: string; tone: "paid" | "due" | "draft" | "pending" } {
          if (!inv) return { label: "Pending", tone: "pending" };
          if (inv.status === "paid") return { label: "Paid", tone: "paid" };
          if (inv.status === "draft") return { label: "Draft", tone: "draft" };
          return { label: "Awaiting payment", tone: "due" };
        }

        const TONE_CLASSES: Record<"paid" | "due" | "draft" | "pending", { border: string; pill: string }> = {
          paid: { border: "border-emerald-500/30 bg-emerald-500/5", pill: "bg-emerald-500/10 text-emerald-400" },
          due: { border: "border-amber-500/30 bg-amber-500/5", pill: "bg-amber-500/10 text-amber-400" },
          draft: { border: "border-blue-500/30 bg-blue-500/5", pill: "bg-blue-500/10 text-blue-400" },
          pending: { border: "border-border", pill: "bg-muted text-muted-foreground" },
        };

        const pp1State = derivedPaymentState(pp1Inv);
        const pp2State = derivedPaymentState(pp2Inv);

        return (
          <div className="mt-5 grid grid-cols-2 gap-4">
            <div className={`rounded-lg border-2 p-4 ${TONE_CLASSES[pp1State.tone].border}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase">PP1 — On Acceptance</p>
                  <p className="text-xl font-bold font-mono mt-1">${pricing ? fmt(pricing.pp1.total * 1.1) : "—"}</p>
                  {pp1Inv?.xero_invoice_number && (
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{pp1Inv.xero_invoice_number}</p>
                  )}
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${TONE_CLASSES[pp1State.tone].pill}`}>
                  {pp1State.label}
                </span>
              </div>
            </div>
            <div className={`rounded-lg border-2 p-4 ${TONE_CLASSES[pp2State.tone].border}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase">PP2 — On Completion</p>
                  <p className="text-xl font-bold font-mono mt-1">${pricing ? fmt(pricing.pp2.total * 1.1) : "—"}</p>
                  {pp2Inv?.xero_invoice_number && (
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{pp2Inv.xero_invoice_number}</p>
                  )}
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${TONE_CLASSES[pp2State.tone].pill}`}>
                  {pp2State.label}
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Pricing summary cards */}
      {pricing && (
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border border-border bg-card p-4 text-center">
            <p className="text-[10px] font-medium text-muted-foreground uppercase">Total (ex GST)</p>
            <p className="text-lg font-bold font-mono mt-1">${fmt(pricing.totalExGST)}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 text-center">
            <p className="text-[10px] font-medium text-muted-foreground uppercase">GST</p>
            <p className="text-lg font-bold font-mono mt-1">${fmt(pricing.gst)}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 text-center">
            <p className="text-[10px] font-medium text-muted-foreground uppercase">Total (inc GST)</p>
            <p className="text-lg font-bold font-mono mt-1">${fmt(pricing.totalIncGST)}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 text-center">
            <p className="text-[10px] font-medium text-muted-foreground uppercase">Profit</p>
            <p className="text-lg font-bold font-mono text-emerald-400 mt-1">${fmt(pricing.profit)}</p>
          </div>
        </div>
      )}

      {/* Devices summary */}
      {activeDevices.length > 0 && (
        <div className="mt-5 rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Devices</p>
          <div className="flex flex-wrap gap-2">
            {activeDevices.map(([code, count]) => {
              const dt = DEVICE_TYPES.find((d) => d.code === code);
              return (
                <span key={code} className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                  {count}x {dt?.legend || code}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* BOM — collapsible per category, default collapsed */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Bill of Materials</h2>
        {Array.from(bomByCategory).map(([category, items]) => {
          const catSell = items.reduce((s: number, i: any) => s + i.sell_price * i.quantity, 0);
          return (
            <details key={category} className="mb-4 group rounded-lg border border-border overflow-hidden">
              <summary className="flex items-center justify-between bg-muted/50 px-4 py-2.5 cursor-pointer list-none select-none hover:bg-muted/70 transition-colors">
                <div className="flex items-center gap-2">
                  <svg
                    className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{category}</h3>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{items.length}</span>
                </div>
                <span className="text-xs font-mono text-muted-foreground">${fmt(catSell)}</span>
              </summary>
              <div className="divide-y divide-border border-t border-border">
                {items.map((item: any) => (
                  <div key={item.id} className="px-4 py-3 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{item.product_name}</p>
                        {item.auto_added && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Auto</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {item.sku && <span className="text-[11px] text-muted-foreground font-mono">{item.sku}</span>}
                        {item.supplier && <span className="text-[11px] text-muted-foreground">{item.supplier}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0 text-right">
                      <span className="text-sm font-mono w-10 text-center">{item.quantity}</span>
                      <span className="hidden sm:block text-xs font-mono text-muted-foreground w-20">${fmt(item.sell_price)}</span>
                      <span className="text-sm font-mono font-medium w-24">${fmt(item.sell_price * item.quantity)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </div>

      {/* Labour */}
      {quote.labour_data && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Labour</h2>
          {(quote.labour_data.sections || []).map((section: any) => (
            section.totalSell > 0 && (
              <details key={section.name} className="mb-3 group rounded-lg border border-border overflow-hidden">
                <summary className="flex items-center justify-between bg-muted/50 px-4 py-2.5 cursor-pointer list-none select-none hover:bg-muted/70 transition-colors">
                  <div className="flex items-center gap-2">
                    <svg
                      className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section.name}</h3>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
                    <span>{section.totalHours}h</span>
                    <span>${fmt(section.totalSell)}</span>
                  </div>
                </summary>
                <div className="divide-y divide-border border-t border-border">
                  {(section.items || []).filter((i: any) => i.hours > 0).map((item: any, ii: number) => (
                    <div key={ii} className="flex items-center justify-between px-4 py-2">
                      <div>
                        <p className="text-sm">{item.name}</p>
                        <p className="text-[10px] text-muted-foreground">{item.formula}</p>
                      </div>
                      <div className="flex items-center gap-4 text-sm font-mono">
                        <span className="text-muted-foreground">{item.hours}{item.isDollarInput ? '' : item.unitLabel ? ` ${item.unitLabel}` : 'h'}</span>
                        <span className="w-20 text-right">${fmt(item.isDollarInput ? item.hours : item.unitRate ? item.hours * item.unitRate : item.hours * (quote.labour_data.sellRate || 150))}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )
          ))}
        </div>
      )}

      {/* Extras */}
      {extras.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Extras</h2>
          <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
            {extras.map((extra: any) => (
              <div key={extra.id} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm">{extra.description}</span>
                <div className="flex gap-6 text-sm font-mono">
                  <span className="text-muted-foreground w-24 text-right">Cost ${fmt(extra.cost)}</span>
                  <span className="w-24 text-right">Sell ${fmt(extra.sell)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Internal breakdown */}
      {pricing && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Pricing Breakdown</h2>
          {isProgress ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">PP1 — Cost Recovery</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Parts</span><span className="font-mono">${fmt(pricing.pp1.partsCost)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Labour</span><span className="font-mono">${fmt(pricing.pp1.labourCost)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Callout</span><span className="font-mono">${fmt(pricing.pp1.callout)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Incidentals</span><span className="font-mono">${fmt(pricing.pp1.incidentals)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Admin</span><span className="font-mono">${fmt(pricing.pp1.admin)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Extras</span><span className="font-mono">${fmt(pricing.pp1.extrasCost)}</span></div>
                  <div className="flex justify-between border-t border-border pt-2 font-medium"><span>PP1 Total (ex GST)</span><span className="font-mono">${fmt(pricing.pp1.total)}</span></div>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">PP2 — Margin</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Parts</span><span className="font-mono">${fmt(pricing.pp2.partsProfit)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Labour</span><span className="font-mono">${fmt(pricing.pp2.labourProfit)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Fixed</span><span className="font-mono">${fmt(pricing.pp2.fixedProfit)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Extras</span><span className="font-mono">${fmt(pricing.pp2.extrasProfit)}</span></div>
                  <div className="flex justify-between border-t border-border pt-2 font-medium"><span>PP2 Total (ex GST)</span><span className="font-mono">${fmt(pricing.pp2.total)}</span></div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div><p className="text-[10px] text-muted-foreground uppercase">Materials</p><p className="font-mono mt-0.5">Cost ${fmt(pricing.materials.cost)}</p><p className="font-mono text-muted-foreground">Sell ${fmt(pricing.materials.sell)}</p></div>
                <div><p className="text-[10px] text-muted-foreground uppercase">Labour</p><p className="font-mono mt-0.5">Cost ${fmt(pricing.labour.totalCost)}</p><p className="font-mono text-muted-foreground">Sell ${fmt(pricing.labour.totalSell)}</p></div>
                <div><p className="text-[10px] text-muted-foreground uppercase">Fixed</p><p className="font-mono mt-0.5">Cost ${fmt(pricing.fixedCosts.totalCost)}</p><p className="font-mono text-muted-foreground">Sell ${fmt(pricing.fixedCosts.totalSell)}</p></div>
                <div><p className="text-[10px] text-muted-foreground uppercase">Extras</p><p className="font-mono mt-0.5">Cost ${fmt(pricing.extras.cost)}</p><p className="font-mono text-muted-foreground">Sell ${fmt(pricing.extras.sell)}</p></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Supplier pricing */}
      <SupplierPricing
        quoteId={quote.id}
        lineItems={lineItems.map((li: any) => ({
          id: li.id,
          product_name: li.product_name,
          sku: li.sku,
          quantity: li.quantity,
          cost_price: Number(li.cost_price ?? 0),
          markup: Number(li.markup ?? 0),
          sell_price: Number(li.sell_price ?? 0),
          rfq_sent_at: li.rfq_sent_at ?? null,
          cost_confirmed_at: li.cost_confirmed_at ?? null,
          supplier_id: li.quote_products?.supplier_id ?? null,
          supplier_name: li.quote_products?.suppliers?.name ?? null,
          supplier_email: li.quote_products?.suppliers?.email ?? null,
          product_cost_updated_at: li.quote_products?.cost_updated_at ?? null,
        }))}
      />

      {/* Invoices */}
      <QuoteInvoices
        quoteId={quote.id}
        quoteStatus={quote.status}
        quoteType={(quote.quote_type as "full" | "progress") || "full"}
        pricing={pricing}
        invoices={invoices}
      />

      <p className="mt-6 text-xs text-muted-foreground">Created {new Date(quote.created_at).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
    </div>
  );
}
