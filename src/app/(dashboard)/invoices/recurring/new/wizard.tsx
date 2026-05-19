"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  // Manual-lookup conversion bridges through query params (workstream D):
  //   ?customer=<id>&site=<id>&plan_sku=<code>&from_enquiry=<id>
  // We pre-select customer + site, pre-tick the matching service, and on
  // submit stamp the resulting plan id back onto the enquiry.
  const initialCustomerId = searchParams.get("customer");
  const initialSiteId = searchParams.get("site");
  const initialPlanSku = searchParams.get("plan_sku");
  const fromEnquiryId = searchParams.get("from_enquiry");

  const [customerId, setCustomerId] = useState<string | null>(initialCustomerId);
  const [sites, setSites] = useState<SiteDraft[]>(() => {
    if (initialCustomerId) {
      const seedItems = new Map<string, number>();
      if (initialPlanSku) {
        const svc = services.find((s) => s.code === initialPlanSku);
        if (svc) seedItems.set(svc.id, 1);
      }
      return [{ siteId: initialSiteId ?? null, items: seedItems }];
    }
    return [];
  });
  const [firstInvoiceDate, setFirstInvoiceDate] = useState<string>("");

  // Mandate attachment mode. Default = send signup link to the customer
  // (existing flow). Alternative = attach an existing GC mandate the
  // customer has already signed.
  const [mandateMode, setMandateMode] = useState<"signup" | "existing">("signup");
  const [existingMandateId, setExistingMandateId] = useState<string>("");

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
    if (mandateMode === "signup" && !primary?.email) {
      toast("Customer has no primary contact email — set one before creating a plan", "error");
      return;
    }
    if (mandateMode === "existing" && !existingMandateId.trim()) {
      toast("Pick or paste a mandate ID before submitting", "error");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/recurring-plans/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          firstInvoiceDate: firstInvoiceDate || null,
          sites: sites.map((s) => ({
            siteId: s.siteId,
            items: Array.from(s.items.entries()).map(([serviceId, quantity]) => ({
              serviceId, quantity,
            })),
          })),
          existingMandateId: mandateMode === "existing" ? existingMandateId.trim() : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Failed to create plan", "error");
        setSubmitting(false);
        return;
      }
      // If we came in from a manual-lookup enquiry, stamp the new plan id
      // back so the enquiry detail page shows "Plan created — open" next time.
      if (fromEnquiryId && json.planIds?.[0]) {
        try {
          await fetch(`/api/nbn-enquiries/${fromEnquiryId}/link-recurring-plan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recurringPlanId: json.planIds[0] }),
          });
        } catch { /* non-blocking */ }
      }
      const planWord = `plan${json.planIds.length === 1 ? "" : "s"}`;
      toast(
        json.attachedExistingMandate
          ? `Created ${json.planIds.length} ${planWord} — attached to mandate ${existingMandateId.trim()} and activated.`
          : `Created ${json.planIds.length} ${planWord} — mandate email sent to ${primary?.email}`,
      );
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
        <CustomerPicker customers={customers} selected={customer} onPick={pickCustomer} />
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

      {/* Step 2.5: Mandate source */}
      {customer && sites.length > 0 && (
        <section className="surface-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">3</span>
            <h2 className="text-base font-semibold">Mandate</h2>
          </div>
          <MandateSourcePicker
            customerId={customer.id}
            mode={mandateMode}
            onModeChange={setMandateMode}
            mandateId={existingMandateId}
            onMandateIdChange={setExistingMandateId}
          />
        </section>
      )}

      {/* Step 4: Review + submit */}
      {customer && sites.length > 0 && (
        <section className="surface-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">4</span>
            <h2 className="text-base font-semibold">Review &amp; send</h2>
          </div>
          <div className="rounded-md border border-border bg-muted/10 p-3">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Start billing on (optional)</span>
              <input
                type="date"
                value={firstInvoiceDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setFirstInvoiceDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <span className="mt-1 block text-[11px] text-muted-foreground">
                Leave blank to bill from the day the customer&apos;s mandate is verified. Pick a future date for sites that haven&apos;t opened yet (e.g. a gym launching in 3 months).
              </span>
            </label>
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
          {mandateMode === "signup" ? (
            <p className="text-xs text-muted-foreground">
              Submitting will create {sites.length} GoCardless customer{sites.length === 1 ? "" : "s"} (with `+sitename` email aliases), generate {sites.length} mandate signup link{sites.length === 1 ? "" : "s"}, and email everything in one consolidated message to <span className="font-mono">{primary?.email}</span>.
              Each site&apos;s Xero RepeatingInvoice fires automatically once that site&apos;s mandate is active.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Submitting will attach {sites.length} plan{sites.length === 1 ? "" : "s"} to existing mandate{" "}
              <span className="font-mono">{existingMandateId || "(none picked)"}</span> and create the Xero RepeatingInvoice{sites.length === 1 ? "" : "s"} immediately. No signup email is sent — the customer has already authorised the direct debit.
            </p>
          )}
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {submitting
              ? "Creating..."
              : mandateMode === "signup"
                ? "Create plan & send mandate links"
                : "Create plan & attach mandate"}
          </button>
        </section>
      )}
    </div>
  );
}

/**
 * Searchable customer picker. Click to open, type to filter, click result to
 * select. Closes on outside click or Esc. Beats a native <select> when the
 * customer list grows past 20-ish entries — Centrefit will hit that quickly.
 */
function CustomerPicker({
  customers,
  selected,
  onPick,
}: {
  customers: Customer[];
  selected: Customer | null;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", onClickOutside);
      document.addEventListener("keydown", onKey);
      // Focus the search input once the panel opens.
      setTimeout(() => inputRef.current?.focus(), 0);
      return () => {
        document.removeEventListener("mousedown", onClickOutside);
        document.removeEventListener("keydown", onKey);
      };
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q));
  }, [customers, query]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <span className={selected ? "text-foreground" : "text-muted-foreground"}>
          {selected ? selected.name : "Select a customer..."}
        </span>
        <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-border bg-card shadow-lg overflow-hidden">
          <div className="border-b border-border p-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search customers..."
              className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">No matches</div>
            )}
            {filtered.map((c) => {
              const isSelected = selected?.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onPick(c.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    isSelected ? "bg-primary/10 text-primary" : "hover:bg-accent"
                  }`}
                >
                  {c.name}
                  {c.customer_sites.length > 0 && (
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      {c.customer_sites.length} {c.customer_sites.length === 1 ? "site" : "sites"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
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

interface MandateOption {
  mandate_id: string;
  gc_customer_id: string;
  scheme: string;
  status: string;
  reference: string | null;
  created_at: string;
  bank_name: string | null;
  account_last4: string | null;
}

/**
 * Lets staff pick between (a) emailing the customer a new mandate signup
 * link (default — current flow), or (b) attaching an existing GoCardless
 * mandate the customer has already signed (for the "we already collected
 * this person's bank details for another plan" case).
 *
 * In existing mode, fetches /api/gc/mandates for the customer to populate
 * a dropdown. Manual-paste fallback handles the case where the mandate
 * lives on a different GC customer record than the ones we have linked.
 */
function MandateSourcePicker({
  customerId,
  mode,
  onModeChange,
  mandateId,
  onMandateIdChange,
}: {
  customerId: string;
  mode: "signup" | "existing";
  onModeChange: (m: "signup" | "existing") => void;
  mandateId: string;
  onMandateIdChange: (id: string) => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [mandates, setMandates] = useState<MandateOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteInput, setPasteInput] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);

  useEffect(() => {
    if (mode !== "existing" || loaded) return;
    setLoading(true);
    fetch(`/api/gc/mandates?customer_id=${encodeURIComponent(customerId)}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, json: j })))
      .then(({ ok, json }) => {
        if (!ok) {
          toast(json.error ?? "Failed to load GC mandates", "error");
          return;
        }
        setMandates(json.mandates as MandateOption[]);
        setLoaded(true);
      })
      .catch((e) => toast(e instanceof Error ? e.message : "Network error", "error"))
      .finally(() => setLoading(false));
  }, [mode, loaded, customerId, toast]);

  // Reset mandate selection if mode flips back to signup.
  useEffect(() => {
    if (mode === "signup") {
      onMandateIdChange("");
      setShowPaste(false);
    }
  }, [mode, onMandateIdChange]);

  async function verifyPasted() {
    if (!pasteInput.trim()) return;
    setPasteBusy(true);
    try {
      const res = await fetch("/api/gc/mandates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mandateId: pasteInput.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Mandate lookup failed", "error");
        return;
      }
      // Add to the list (deduplicated) + auto-select it.
      const opt = json.mandate as MandateOption;
      setMandates((prev) =>
        prev.some((m) => m.mandate_id === opt.mandate_id) ? prev : [opt, ...prev],
      );
      onMandateIdChange(opt.mandate_id);
      setShowPaste(false);
      setPasteInput("");
      toast(`Verified mandate ${opt.mandate_id} (${opt.bank_name ?? "bank info unavailable"})`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Network error", "error");
    } finally {
      setPasteBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <ModeButton
          active={mode === "signup"}
          title="Send signup link"
          subtitle="Customer signs a new mandate via GoCardless. Email goes out automatically."
          onClick={() => onModeChange("signup")}
        />
        <ModeButton
          active={mode === "existing"}
          title="Use existing mandate"
          subtitle="Attach to a mandate the customer has already signed. Plan goes live immediately."
          onClick={() => onModeChange("existing")}
        />
      </div>

      {mode === "existing" && (
        <div className="space-y-2 rounded-md border border-border bg-muted/10 p-3">
          {loading ? (
            <p className="text-xs text-muted-foreground italic">Fetching mandates from GoCardless…</p>
          ) : mandates.length === 0 && loaded ? (
            <p className="text-xs text-muted-foreground">
              No active mandates found for this customer in GoCardless.
              {" "}
              <button
                onClick={() => setShowPaste(true)}
                className="text-primary hover:underline"
              >
                Paste a mandate ID
              </button>{" "}
              if you know one (e.g. mandate is on a different GC customer record).
            </p>
          ) : (
            <>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Pick mandate</span>
                <select
                  value={mandateId}
                  onChange={(e) => onMandateIdChange(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm font-mono"
                >
                  <option value="">Pick…</option>
                  {mandates.map((m) => (
                    <option key={m.mandate_id} value={m.mandate_id}>
                      {m.mandate_id}
                      {" — "}
                      {m.bank_name ?? "Bank unknown"}
                      {m.account_last4 ? ` ••${m.account_last4}` : ""}
                      {" · "}
                      {m.status}
                      {m.scheme ? ` (${m.scheme})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {!showPaste && (
                <button
                  onClick={() => setShowPaste(true)}
                  className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                >
                  …or paste a mandate ID manually
                </button>
              )}
            </>
          )}

          {showPaste && (
            <div className="rounded-md border border-primary/30 bg-card p-2 space-y-2">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Mandate ID</span>
                <input
                  value={pasteInput}
                  onChange={(e) => setPasteInput(e.target.value)}
                  placeholder="MD000ABC123…"
                  className="mt-1 w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm font-mono"
                />
              </label>
              <div className="flex gap-2">
                <button
                  onClick={verifyPasted}
                  disabled={pasteBusy || !pasteInput.trim()}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {pasteBusy ? "Verifying..." : "Verify & use"}
                </button>
                <button
                  onClick={() => { setShowPaste(false); setPasteInput(""); }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active, title, subtitle, onClick,
}: { active: boolean; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border p-3 text-left transition-colors ${
        active
          ? "border-primary bg-primary/5"
          : "border-border bg-card hover:bg-accent/40"
      }`}
    >
      <div className={`text-sm font-semibold ${active ? "text-primary" : "text-foreground"}`}>{title}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</div>
    </button>
  );
}
