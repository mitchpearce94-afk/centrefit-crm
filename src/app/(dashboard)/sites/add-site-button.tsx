"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";

interface CustomerOption {
  id: string;
  name: string;
}

const STATES = ["QLD", "NSW", "VIC", "SA", "WA", "TAS", "NT", "ACT"];

/**
 * Add a site from the Sites tab for an EXISTING customer. Mirrors the
 * customer-tab site form field-for-field (incl. billing_email) so sites
 * created here and sites created under a customer are identical.
 */
export function AddSiteButton({ customers }: { customers: CustomerOption[] }) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [suburb, setSuburb] = useState("");
  const [state, setState] = useState("QLD");
  const [postcode, setPostcode] = useState("");
  const [phone, setPhone] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [notes, setNotes] = useState("");

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    const base = q ? customers.filter((c) => c.name.toLowerCase().includes(q)) : customers;
    return base.slice(0, 50);
  }, [customers, customerSearch]);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  function reset() {
    setCustomerId("");
    setCustomerSearch("");
    setName(""); setAddress(""); setSuburb(""); setState("QLD");
    setPostcode(""); setPhone(""); setBillingEmail(""); setNotes("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) { setError("Pick a customer for this site"); return; }
    if (!name.trim()) { setError("Site name is required"); return; }
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.from("customer_sites").insert({
      customer_id: customerId,
      name: name.trim(),
      address: address.trim() || null,
      suburb: suburb.trim() || null,
      state: state.trim() || null,
      postcode: postcode.trim() || null,
      phone: phone.trim() || null,
      billing_email: billingEmail.trim() || null,
      notes: notes.trim() || null,
    });
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    toast("Site added");
    setOpen(false);
    reset();
    setSaving(false);
    router.refresh();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !saving && setOpen(false)}>
      <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Add a site</h3>
          <button onClick={() => setOpen(false)} disabled={saving} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-2">
          {error && <p className="text-xs text-destructive">{error}</p>}

          {/* Customer picker */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Customer *</label>
            {selectedCustomer ? (
              <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-sm">
                <span>{selectedCustomer.name}</span>
                <button type="button" onClick={() => { setCustomerId(""); setCustomerSearch(""); }} className="text-xs text-muted-foreground hover:text-foreground">Change</button>
              </div>
            ) : (
              <>
                <input
                  autoFocus
                  placeholder="Search customers…"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className={inputClass}
                />
                {customerSearch.trim() && (
                  <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border divide-y divide-border">
                    {filteredCustomers.length === 0 ? (
                      <p className="px-2.5 py-2 text-xs text-muted-foreground">No matching customers.</p>
                    ) : (
                      filteredCustomers.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => { setCustomerId(c.id); setCustomerSearch(""); }}
                          className="block w-full px-2.5 py-1.5 text-left text-sm hover:bg-accent"
                        >
                          {c.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <input placeholder="Site Name *" value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
          <input placeholder="Street Address" value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
          <div className="grid grid-cols-3 gap-2">
            <input placeholder="Suburb" value={suburb} onChange={(e) => setSuburb(e.target.value)} className={inputClass} />
            <select value={state} onChange={(e) => setState(e.target.value)} className={inputClass}>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input placeholder="Postcode" value={postcode} onChange={(e) => setPostcode(e.target.value)} className={inputClass} />
          </div>
          <input placeholder="Phone (site reception / main contact)" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" className={inputClass} />
          <input placeholder="Billing email (where this site's invoices go — wins over the customer's)" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} type="text" className={inputClass} />
          <textarea placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${inputClass} resize-none`} />

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
