"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ui/toast";
import { brisbaneDateISO } from "@/lib/dates";

/**
 * Site-first plan creation (site-first-CONTEXT D5, 2026-07-03): staff pick a
 * SITE, not a customer. The backing customer record is derived from the site
 * and never surfaced beyond the owner fine print. Multi-site plans are still
 * supported for sites sharing the same owner (one consolidated mandate email).
 */
export interface SiteOption {
  id: string;
  name: string;
  suburb: string | null;
  state: string | null;
  customer: {
    id: string;
    name: string;
    contactName: string | null;
    contactEmail: string | null;
  };
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
  site: SiteOption;
  /** Map of serviceId -> quantity (1-default). Items not in map are unselected. */
  items: Map<string, number>;
}

export function NewRecurringPlanWizard({
  sites,
  services,
}: {
  sites: SiteOption[];
  services: Service[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  // Manual-lookup conversion bridges through query params (workstream D):
  //   ?customer=<id>&site=<id>&plan_sku=<code>&from_enquiry=<id>
  // Site-first: `site` is authoritative; a legacy `customer`-only link seeds
  // that owner's first site. We pre-tick the matching service and on submit
  // stamp the resulting plan id back onto the enquiry.
  const initialSiteId = searchParams.get("site");
  const initialCustomerId = searchParams.get("customer");
  const initialPlanSku = searchParams.get("plan_sku");
  const fromEnquiryId = searchParams.get("from_enquiry");

  const [drafts, setDrafts] = useState<SiteDraft[]>(() => {
    const seed =
      (initialSiteId ? sites.find((s) => s.id === initialSiteId) : undefined) ??
      (initialCustomerId ? sites.find((s) => s.customer.id === initialCustomerId) : undefined);
    if (!seed) return [];
    const seedItems = new Map<string, number>();
    if (initialPlanSku) {
      const svc = services.find((s) => s.code === initialPlanSku);
      if (svc) seedItems.set(svc.id, 1);
    }
    return [{ site: seed, items: seedItems }];
  });
  const [firstInvoiceDate, setFirstInvoiceDate] = useState<string>("");
  // Independent first-charge date for the yearly cadence (e.g. a MyAlarm
  // yearly sub migrated in mid-cycle bills on a different date than monthly).
  const [yearlyFirstInvoiceDate, setYearlyFirstInvoiceDate] = useState<string>("");

  // Mandate attachment mode. Default = send signup link to the customer
  // (existing flow). Alternative = attach an existing GC mandate the
  // customer has already signed.
  const [mandateMode, setMandateMode] = useState<"signup" | "existing">("signup");
  const [existingMandateId, setExistingMandateId] = useState<string>("");

  // The backing customer, derived from the first picked site.
  const owner = drafts[0]?.site.customer ?? null;

  // Sibling sites (same owner) not yet in the draft — offered by "add site".
  const siblingOptions = useMemo(() => {
    if (!owner) return [];
    const used = new Set(drafts.map((d) => d.site.id));
    return sites.filter((s) => s.customer.id === owner.id && !used.has(s.id));
  }, [sites, drafts, owner]);

  const totals = useMemo(() => {
    let monthly = 0, yearly = 0;
    for (const d of drafts) {
      for (const [svcId, qty] of d.items.entries()) {
        const svc = services.find((s) => s.id === svcId);
        if (!svc) continue;
        const line = Number(svc.price_inc_gst) * qty;
        if (svc.frequency === "monthly") monthly += line;
        else yearly += line;
      }
    }
    return { monthly, yearly };
  }, [drafts, services]);

  function pickSite(id: string) {
    const site = sites.find((s) => s.id === id);
    if (!site) return;
    // Picking (or re-picking) the lead site resets the draft to just it —
    // the owner may have changed, and stale sibling drafts can't follow.
    setDrafts([{ site, items: new Map() }]);
  }

  function addSite(id: string) {
    const site = siblingOptions.find((s) => s.id === id);
    if (!site) return;
    setDrafts((prev) => [...prev, { site, items: new Map() }]);
  }

  function removeSite(idx: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
  }

  function toggleItem(idx: number, serviceId: string) {
    setDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== idx) return d;
        const newMap = new Map(d.items);
        if (newMap.has(serviceId)) newMap.delete(serviceId);
        else newMap.set(serviceId, 1);
        return { ...d, items: newMap };
      }),
    );
  }

  function setQuantity(idx: number, serviceId: string, qty: number) {
    if (qty < 1) qty = 1;
    setDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== idx) return d;
        const newMap = new Map(d.items);
        if (newMap.has(serviceId)) newMap.set(serviceId, qty);
        return { ...d, items: newMap };
      }),
    );
  }

  async function submit() {
    if (!owner || drafts.length === 0) {
      toast("Pick a site before submitting", "error");
      return;
    }
    if (drafts.some((d) => d.items.size === 0)) {
      toast("Each site needs at least one service", "error");
      return;
    }
    if (mandateMode === "signup" && !owner.contactEmail) {
      toast("Site owner has no contact email — set one before creating a plan", "error");
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
          customerId: owner.id,
          firstInvoiceDate: firstInvoiceDate || null,
          yearlyFirstInvoiceDate: yearlyFirstInvoiceDate || null,
          sites: drafts.map((d) => ({
            siteId: d.site.id,
            items: Array.from(d.items.entries()).map(([serviceId, quantity]) => ({
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
          : `Created ${json.planIds.length} ${planWord} — mandate email sent to ${owner.contactEmail}`,
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
            Set up direct-debit billing for a site. Pick the site first — the owner&apos;s billing details ride along automatically. Each site gets its own GoCardless mandate.
          </p>
        </div>
        <Link
          href="/invoices/recurring"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </Link>
      </div>

      {/* Step 1: Site */}
      <section className="surface-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">1</span>
          <h2 className="text-base font-semibold">Site</h2>
        </div>
        <SitePicker sites={sites} selected={drafts[0]?.site ?? null} onPick={pickSite} />
        {owner && (
          <p className="text-xs text-muted-foreground">
            Owner: <span className="text-foreground">{owner.name}</span>
            {owner.contactName && owner.contactName !== owner.name && <> · {owner.contactName}</>}
            {owner.contactEmail && <> · <span className="font-mono">{owner.contactEmail}</span></>}
            {!owner.contactEmail && <span className="text-destructive"> · No email on file (required for mandate signup)</span>}
          </p>
        )}
      </section>

      {/* Step 2: Services per site */}
      {owner && (
        <section className="surface-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">2</span>
            <h2 className="text-base font-semibold">Services</h2>
          </div>

          {drafts.map((draft, idx) => (
            <SiteEditor
              key={draft.site.id}
              index={idx}
              draft={draft}
              services={services}
              onToggleItem={(svcId) => toggleItem(idx, svcId)}
              onQuantityChange={(svcId, qty) => setQuantity(idx, svcId, qty)}
              onRemove={drafts.length > 1 ? () => removeSite(idx) : undefined}
            />
          ))}

          {siblingOptions.length > 0 && (
            <label className="block">
              <select
                value=""
                onChange={(e) => e.target.value && addSite(e.target.value)}
                className="rounded-md border border-border bg-input px-3 py-1.5 text-sm text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">+ Add another {owner.name} site…</option>
                {siblingOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}{s.suburb ? ` — ${s.suburb}` : ""}</option>
                ))}
              </select>
            </label>
          )}
        </section>
      )}

      {/* Step 3: Mandate source */}
      {owner && drafts.length > 0 && (
        <section className="surface-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">3</span>
            <h2 className="text-base font-semibold">Mandate</h2>
          </div>
          <MandateSourcePicker
            customerId={owner.id}
            mode={mandateMode}
            onModeChange={setMandateMode}
            mandateId={existingMandateId}
            onMandateIdChange={setExistingMandateId}
          />
        </section>
      )}

      {/* Step 4: Review + submit */}
      {owner && drafts.length > 0 && (
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
                min={brisbaneDateISO()}
                onChange={(e) => setFirstInvoiceDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <span className="mt-1 block text-[11px] text-muted-foreground">
                Leave blank to bill from the day the customer&apos;s mandate is verified. Pick a future date for sites that haven&apos;t opened yet (e.g. a gym launching in 3 months).
              </span>
            </label>
            {totals.yearly > 0 && (
              <label className="mt-3 block border-t border-border pt-3">
                <span className="text-xs font-medium text-muted-foreground">Yearly charge date (optional)</span>
                <input
                  type="date"
                  value={yearlyFirstInvoiceDate}
                  min={brisbaneDateISO()}
                  onChange={(e) => setYearlyFirstInvoiceDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  This plan has a yearly service. Set its own first-charge date if it differs from the monthly start (e.g. a MyAlarm yearly sub migrated from the old system). Blank = same as the start date above.
                </span>
              </label>
            )}
          </div>
          <div className="rounded-md border border-border bg-muted/20 p-4 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sites</span>
              <span className="font-medium">{drafts.length}</span>
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
              Submitting will create {drafts.length} GoCardless customer{drafts.length === 1 ? "" : "s"} (with `+sitename` email aliases), generate {drafts.length} mandate signup link{drafts.length === 1 ? "" : "s"}, and email everything in one consolidated message to <span className="font-mono">{owner.contactEmail}</span>.
              Each site&apos;s Xero RepeatingInvoice fires automatically once that site&apos;s mandate is active.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Submitting will attach {drafts.length} plan{drafts.length === 1 ? "" : "s"} to existing mandate{" "}
              <span className="font-mono">{existingMandateId || "(none picked)"}</span> and create the Xero RepeatingInvoice{drafts.length === 1 ? "" : "s"} immediately. No signup email is sent — the customer has already authorised the direct debit.
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
 * Searchable site picker (site-first D5). Click to open, type to filter by
 * site name, suburb, or owner name; click result to select. Closes on
 * outside click or Esc. Site name leads; owner is fine print.
 */
function SitePicker({
  sites,
  selected,
  onPick,
}: {
  sites: SiteOption[];
  selected: SiteOption | null;
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
    if (!q) return sites;
    return sites.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      (s.suburb ?? "").toLowerCase().includes(q) ||
      s.customer.name.toLowerCase().includes(q),
    );
  }, [sites, query]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <span className={selected ? "text-foreground" : "text-muted-foreground"}>
          {selected ? `${selected.name}${selected.suburb ? ` — ${selected.suburb}` : ""}` : "Select a site..."}
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
              placeholder="Search sites or owners..."
              className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">No matches</div>
            )}
            {filtered.map((s) => {
              const isSelected = selected?.id === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    onPick(s.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    isSelected ? "bg-primary/10 text-primary" : "hover:bg-accent"
                  }`}
                >
                  <span>{s.name}{s.suburb ? ` — ${s.suburb}` : ""}</span>
                  <span className="ml-2 text-[11px] text-muted-foreground">{s.customer.name}</span>
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
  draft,
  services,
  onToggleItem,
  onQuantityChange,
  onRemove,
}: {
  index: number;
  draft: SiteDraft;
  services: Service[];
  onToggleItem: (svcId: string) => void;
  onQuantityChange: (svcId: string, qty: number) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Site {index + 1}</span>
          <span className="text-xs font-medium">
            {draft.site.name}{draft.site.suburb ? ` — ${draft.site.suburb}` : ""}
          </span>
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
          const selected = draft.items.has(svc.id);
          const qty = draft.items.get(svc.id) ?? 1;
          return (
            <label
              key={svc.id}
              className="flex items-center gap-3 px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent"
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
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteInput, setPasteInput] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);

  useEffect(() => {
    if (mode !== "existing" || loadedFor === customerId) return;
    setLoading(true);
    fetch(`/api/gc/mandates?customer_id=${encodeURIComponent(customerId)}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, json: j })))
      .then(({ ok, json }) => {
        if (!ok) {
          toast(json.error ?? "Failed to load GC mandates", "error");
          return;
        }
        setMandates(json.mandates as MandateOption[]);
        setLoadedFor(customerId);
      })
      .catch((e) => toast(e instanceof Error ? e.message : "Network error", "error"))
      .finally(() => setLoading(false));
  }, [mode, loadedFor, customerId, toast]);

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
          ) : (
            <>
              {mandates.length === 0 && loadedFor === customerId ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-300 space-y-1">
                  <p className="font-medium">No mandates auto-detected for this owner.</p>
                  <p className="text-amber-300/80 leading-relaxed">
                    The auto-detect only finds mandates already linked to this
                    site&apos;s owner via a prior plan. If they signed a
                    mandate elsewhere (e.g. brought over from outside the CRM,
                    or sits on a different record) paste the
                    mandate ID below — it starts with <span className="font-mono">MD</span>
                    and you&apos;ll find it on the GoCardless dashboard under
                    Customers → Mandates.
                  </p>
                </div>
              ) : (
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
              )}

              {/* Paste-by-ID is always available, not only on empty list —
                  mandate may live on a different customer record. */}
              {!showPaste && (
                <button
                  onClick={() => setShowPaste(true)}
                  className="text-[11px] text-primary hover:text-primary/80 hover:underline"
                >
                  + Paste a mandate ID from GoCardless
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
