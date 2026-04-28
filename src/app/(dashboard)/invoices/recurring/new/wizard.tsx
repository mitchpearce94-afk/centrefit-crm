"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ui/toast";

interface Customer {
  id: string;
  name: string;
  customer_contacts: { name: string | null; email: string | null; is_primary: boolean }[];
  customer_sites: { id: string; name: string; suburb: string | null; state: string | null }[];
}

interface Service {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_inc_gst: number | string;
  frequency: "monthly" | "yearly";
}

interface SiteDraft {
  /** customer_sites.id, or null for "no site / use customer-level" */
  siteId: string | null;
  /** Map of serviceId -> quantity (1-default). Items not in map are unselected. */
  items: Map<string, number>;
}

export function NewRecurringPlanWizard({
  customers,
  services,
}: {
  customers: Customer[];
  services: Service[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const [customerId, setCustomerId] = useState<string | null>(null);
  // Sites = ordered list of "drafts" — one per facility we're onboarding.
  const [sites, setSites] = useState<SiteDraft[]>([]);

  const customer = useMemo(
    () => customers.find((c) => c.id === customerId) ?? null,
    [customers, customerId],
  );
  const primary = customer?.customer_contacts.find((c) => c.is_primary)
    ?? customer?.customer_contacts[0];

  const totals = useMemo(() => {
    let monthly = 0, yearly = 0;
    for (const site of sites) {
      for (const [svcId, qty] of site.items.entries()) {
        const svc = services.find((s) => s.id === svcId);
        if (!svc) continue;
        const line = Number(svc.price_inc_gst) * qty;
        if (svc.frequency === "monthly") monthly += line;
        else yearly += line;
      }
    }
    return { monthly, yearly };
  }, [sites, services]);

  function pickCustomer(id: string) {
    setCustomerId(id);
    // Default to one empty site draft so user has somewhere to put items.
    const cust = customers.find((c) => c.id === id);
    if (cust && cust.customer_sites.length > 0) {
      setSites([{ siteId: cust.customer_sites[0].id, items: new Map() }]);
    } else {
      setSites([{ siteId: null, items: new Map() }]);
    }
  }

  function addSite() {
    if (!customer) return;
    const usedSiteIds = new Set(sites.map((s) => s.siteId).filter(Boolean));
    const nextSite = customer.customer_sites.find((s) => !usedSiteIds.has(s.id));
    setSites((prev) => [...prev, { siteId: nextSite?.id ?? null, items: new Map() }]);
  }

  function removeSite(idx: number) {
    setSites((prev) => prev.filter((_, i) => i !== idx));
  }

  function setSiteId(idx: number, siteId: string | null) {
    setSites((prev) => prev.map((s, i) => (i === idx ? { ...s, siteId } : s)));
  }

  function toggleItem(idx: number, serviceId: string) {
    setSites((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        const newMap = new Map(s.items);
        if (newMap.has(serviceId)) newMap.delete(serviceId);
        else newMap.set(serviceId, 1);
        return { ...s, items: newMap };
      }),
    );
  }

  function setQuantity(idx: number, serviceId: string, qty: number) {
    if (qty < 1) qty = 1;
    setSites((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        const newMap = new Map(s.items);
        if (newMap.has(serviceId)) newMap.set(serviceId, qty);
        return { ...s, items: newMap };
      }),
    );
  }

  async function submit() {
    if (!customer) return;
    if (sites.length === 0) {
      toast("Add at least one site before submitting", "error");
      return;
    }
    if (sites.some((s) => s.items.size === 0)) {
      toast("Each site needs at least one service", "error");
      return;
    }
    if (!primary?.email) {
      toast("Customer has no primary contact email — set one before creating a plan", "error");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/recurring-plans/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          sites: sites.map((s) => ({
            siteId: s.siteId,
            items: Array.from(s.items.entries()).map(([serviceId, quantity]) => ({
              serviceId, quantity,
            })),
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Failed to create plan", "error");
        setSubmitting(false);
        return;
      }
      toast(`Created ${json.planIds.length} plan${json.planIds.length === 1 ? "" : "s"} — mandate email sent to ${primary.email}`);
      router.push("/invoices/recurring");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Network error", "error");
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New recurring plan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Set up direct-debit billing for one or more sites. Each site gets its own GoCardless mandate; one consolidated email goes to the customer's primary contact with all signup links inline.
          </p>
        </div>
        <Link
          href="/invoices/recurring"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </Link>
      </div>

      {/* Step 1: Customer */}
      <section className="surface-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">1</span>
          <h2 className="text-base font-semibold">Customer</h2>
        </div>
        <select
          value={customerId ?? ""}
          onChange={(e) => pickCustomer(e.target.value)}
          className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Select a customer...</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {customer && (
          <p className="text-xs text-muted-foreground">
            Primary contact: <span className="text-foreground">{primary?.name ?? "—"}</span>
            {primary?.email && <> · <span className="font-mono">{primary.email}</span></>}
            {!primary?.email && <span className="text-destructive"> · No email on file (required for mandate signup)</span>}
          </p>
        )}
      </section>

      {/* Step 2: Sites + items */}
      {customer && (
        <section className="surface-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">2</span>
            <h2 className="text-base font-semibold">Sites &amp; services</h2>
          </div>

          {sites.map((site, idx) => (
            <SiteEditor
              key={idx}
              index={idx}
              site={site}
              customer={customer}
              services={services}
              onSiteIdChange={(id) => setSiteId(idx, id)}
              onToggleItem={(svcId) => toggleItem(idx, svcId)}
              onQuantityChange={(svcId, qty) => setQuantity(idx, svcId, qty)}
              onRemove={sites.length > 1 ? () => removeSite(idx) : undefined}
            />
          ))}

          <button
            onClick={addSite}
            className="text-sm text-primary hover:underline"
          >
            + Add another site
          </button>
        </section>
      )}

      {/* Step 3: Review + submit */}
      {customer && sites.length > 0 && (
        <section className="surface-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">3</span>
            <h2 className="text-base font-semibold">Review &amp; send</h2>
          </div>
          <div className="rounded-md border border-border bg-muted/20 p-4 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sites</span>
              <span className="font-medium">{sites.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Monthly recurring (incl. GST)</span>
              <span className="font-mono">${totals.monthly.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Yearly recurring (incl. GST)</span>
              <span className="font-mono">${totals.yearly.toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1.5 mt-1.5">
              <span className="text-muted-foreground">Effective MRR</span>
              <span className="font-mono font-semibold">
                ${(totals.monthly + totals.yearly / 12).toFixed(2)}
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Submitting will create {sites.length} GoCardless customer{sites.length === 1 ? "" : "s"} (with `+sitename` email aliases), generate {sites.length} mandate signup link{sites.length === 1 ? "" : "s"}, and email everything in one consolidated message to <span className="font-mono">{primary?.email}</span>.
            Each site's Xero RepeatingInvoice fires automatically once that site's mandate is active.
          </p>
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Creating..." : "Create plan & send mandate links"}
          </button>
        </section>
      )}
    </div>
  );
}

function SiteEditor({
  index,
  site,
  customer,
  services,
  onSiteIdChange,
  onToggleItem,
  onQuantityChange,
  onRemove,
}: {
  index: number;
  site: SiteDraft;
  customer: Customer;
  services: Service[];
  onSiteIdChange: (id: string | null) => void;
  onToggleItem: (svcId: string) => void;
  onQuantityChange: (svcId: string, qty: number) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Site {index + 1}</span>
          <select
            value={site.siteId ?? ""}
            onChange={(e) => onSiteIdChange(e.target.value || null)}
            className="rounded-md border border-border bg-input px-2 py-1 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">No specific site</option>
            {customer.customer_sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.suburb ? ` — ${s.suburb}` : ""}</option>
            ))}
          </select>
        </div>
        {onRemove && (
          <button
            onClick={onRemove}
            className="text-xs text-muted-foreground hover:text-destructive transition-colors"
          >
            Remove
          </button>
        )}
      </div>
      <div className="p-3 space-y-1">
        {services.map((svc) => {
          const selected = site.items.has(svc.id);
          const qty = site.items.get(svc.id) ?? 1;
          return (
            <label
              key={svc.id}
              className={`flex items-center gap-3 px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent ${selected ? "" : ""}`}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleItem(svc.id)}
                className="h-4 w-4 rounded accent-primary"
              />
              <span className="flex-1 text-sm">{svc.name}</span>
              {selected && (
                <input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) => onQuantityChange(svc.id, parseInt(e.target.value) || 1)}
                  className="w-14 rounded-md border border-border bg-input px-2 py-0.5 text-xs text-right"
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              <span className="font-mono text-xs text-muted-foreground w-28 text-right">
                ${Number(svc.price_inc_gst).toFixed(2)}/{svc.frequency === "monthly" ? "mo" : "yr"}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
