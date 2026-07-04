"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Site-first creation (D5): one form captures the site AND its owner; the
 * backing customer record is created invisibly (site = billing account 1:1,
 * so adding another club for a known owner still creates its own backing
 * record — "Copy owner from…" just saves the retyping).
 */
export interface OwnerPrefillOption {
  siteId: string;
  siteName: string;
  ownerName: string;
  abn: string | null;
  billingEmail: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

const STATES = ["QLD", "NSW", "VIC", "SA", "WA", "TAS", "NT", "ACT"];

export function AddSiteButton({ ownerPrefills }: { ownerPrefills: OwnerPrefillOption[] }) {
  const router = useRouter();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [suburb, setSuburb] = useState("");
  const [state, setState] = useState("QLD");
  const [postcode, setPostcode] = useState("");
  const [phone, setPhone] = useState("");
  const [siteEmail, setSiteEmail] = useState("");
  const [notes, setNotes] = useState("");

  const [ownerName, setOwnerName] = useState("");
  const [abn, setAbn] = useState("");
  const [ownerBillingEmail, setOwnerBillingEmail] = useState("");
  const [invoiceName, setInvoiceName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const [copySearch, setCopySearch] = useState("");
  const [showCopy, setShowCopy] = useState(false);

  const copyMatches = useMemo(() => {
    const q = copySearch.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    return ownerPrefills
      .filter((o) => o.ownerName.toLowerCase().includes(q) || o.siteName.toLowerCase().includes(q))
      .slice(0, 12);
  }, [ownerPrefills, copySearch]);

  function applyPrefill(o: OwnerPrefillOption) {
    setOwnerName(o.ownerName);
    setAbn(o.abn ?? "");
    setOwnerBillingEmail(o.billingEmail ?? "");
    setContactName(o.contactName ?? "");
    setContactEmail(o.contactEmail ?? "");
    setContactPhone(o.contactPhone ?? "");
    setShowCopy(false);
    setCopySearch("");
  }

  function reset() {
    setName(""); setAddress(""); setSuburb(""); setState("QLD");
    setPostcode(""); setPhone(""); setSiteEmail(""); setNotes("");
    setOwnerName(""); setAbn(""); setOwnerBillingEmail(""); setInvoiceName("");
    setContactName(""); setContactEmail(""); setContactPhone("");
    setCopySearch(""); setShowCopy(false);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Site name is required"); return; }
    if (!ownerName.trim()) { setError("Owner name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/sites/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site: {
            name: name.trim(), address: address.trim(), suburb: suburb.trim(), state: state.trim(),
            postcode: postcode.trim(), phone: phone.trim(), email: siteEmail.trim(), notes: notes.trim(),
          },
          owner: {
            name: ownerName.trim(), abn: abn.trim(), billingEmail: ownerBillingEmail.trim(),
            invoiceName: invoiceName.trim(),
            contactName: contactName.trim(), contactEmail: contactEmail.trim(), contactPhone: contactPhone.trim(),
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to create site");
        setSaving(false);
        return;
      }
      toast("Site added");
      setOpen(false);
      reset();
      setSaving(false);
      router.push(`/sites/${json.siteId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        + Add site
      </button>
    );
  }

  const inputClass =
    "w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Add a site</h3>
          <button onClick={() => setOpen(false)} disabled={saving} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-2">
          {error && <p className="text-xs text-destructive">{error}</p>}

          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Site</p>
          <input autoFocus placeholder="Site Name *" value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
          <input placeholder="Street Address" value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
          <div className="grid grid-cols-3 gap-2">
            <input placeholder="Suburb" value={suburb} onChange={(e) => setSuburb(e.target.value)} className={inputClass} />
            <select value={state} onChange={(e) => setState(e.target.value)} className={inputClass}>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input placeholder="Postcode" value={postcode} onChange={(e) => setPostcode(e.target.value)} className={inputClass} />
          </div>
          <input placeholder="Phone (site reception / main contact)" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" className={inputClass} />
          <input placeholder="Site email (reception / manager — invoices go to the owner's billing email)" value={siteEmail} onChange={(e) => setSiteEmail(e.target.value)} type="text" className={inputClass} />
          <textarea placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${inputClass} resize-none`} />

          <div className="flex items-center justify-between pt-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Owner</p>
            {!showCopy ? (
              <button type="button" onClick={() => setShowCopy(true)} className="text-[11px] text-primary hover:underline">
                Copy owner from an existing site…
              </button>
            ) : (
              <button type="button" onClick={() => { setShowCopy(false); setCopySearch(""); }} className="text-[11px] text-muted-foreground hover:underline">
                Cancel copy
              </button>
            )}
          </div>
          {showCopy && (
            <div>
              <input
                placeholder="Search sites or owners…"
                value={copySearch}
                onChange={(e) => setCopySearch(e.target.value)}
                className={inputClass}
              />
              {copyMatches.length > 0 && (
                <div className="mt-1 max-h-36 overflow-y-auto rounded-md border border-border divide-y divide-border">
                  {copyMatches.map((o) => (
                    <button
                      key={o.siteId}
                      type="button"
                      onClick={() => applyPrefill(o)}
                      className="block w-full px-2.5 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      {o.ownerName}
                      <span className="block text-[11px] text-muted-foreground">{o.siteName}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <input placeholder="Owner / entity name *" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required className={inputClass} />
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="ABN" value={abn} onChange={(e) => setAbn(e.target.value)} className={inputClass} />
            <input placeholder="Owner billing email" value={ownerBillingEmail} onChange={(e) => setOwnerBillingEmail(e.target.value)} className={inputClass} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <input
                placeholder="Invoice name — blank bills as the site name"
                value={invoiceName}
                onChange={(e) => setInvoiceName(e.target.value)}
                className={inputClass}
              />
              {!invoiceName && /pty\s+ltd|ltd$|limited$/i.test(ownerName) && (
                <button
                  type="button"
                  onClick={() => setInvoiceName(ownerName.trim())}
                  className="shrink-0 rounded-md border border-border px-2 py-1.5 text-[11px] text-primary hover:bg-accent"
                  title="Bill invoices to the owner entity instead of the site name"
                >
                  Use owner
                </button>
              )}
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Set when the owner&apos;s accounts team needs the legal entity on invoices (e.g. Bravofit clubs).
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} className={inputClass} />
            <input placeholder="Contact email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={inputClass} />
            <input placeholder="Mobile" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={inputClass} />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} disabled={saving} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {saving ? "Saving…" : "Add site"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
