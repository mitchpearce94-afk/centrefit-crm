"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { Customer, CustomerType } from "@/lib/types";

const customerTypes: { value: CustomerType; label: string }[] = [
  { value: "commercial", label: "Commercial" },
  { value: "residential", label: "Residential" },
  { value: "government", label: "Government" },
  { value: "internal", label: "Internal" },
];

const inputClass =
  "mt-1 block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

interface CustomerFormProps {
  customer?: Customer;
}

export function CustomerForm({ customer }: CustomerFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const isEditing = !!customer;

  // Customer fields
  const [name, setName] = useState(customer?.name ?? "");
  const [type, setType] = useState<CustomerType>(customer?.type ?? "commercial");
  const [abn, setAbn] = useState(customer?.abn ?? "");
  const [notes, setNotes] = useState(customer?.notes ?? "");

  // Primary contact fields (new customer only)
  const [contactSameAsCustomer, setContactSameAsCustomer] = useState(true);
  const [contactName, setContactName] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMobile, setContactMobile] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  // Primary site fields (new customer only)
  const [siteName, setSiteName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [siteSuburb, setSiteSuburb] = useState("");
  const [siteState, setSiteState] = useState("QLD");
  const [sitePostcode, setSitePostcode] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const customerPayload = {
      name: name.trim(),
      type,
      abn: abn.trim() || null,
      notes: notes.trim() || null,
    };

    if (!customerPayload.name) {
      setError("Customer name is required");
      setSaving(false);
      return;
    }

    if (isEditing) {
      const { data, error: err } = await supabase
        .from("customers")
        .update(customerPayload)
        .eq("id", customer.id)
        .select()
        .single();

      if (err) {
        setError(err.message);
        setSaving(false);
      } else {
        router.push(`/customers/${data.id}`);
        router.refresh();
      }
      return;
    }

    // New customer: create customer + optional contact + optional site in sequence
    const { data: newCustomer, error: custErr } = await supabase
      .from("customers")
      .insert(customerPayload)
      .select()
      .single();

    if (custErr || !newCustomer) {
      setError(custErr?.message ?? "Failed to create customer");
      setSaving(false);
      return;
    }

    const resolvedContactName = contactSameAsCustomer
      ? name.trim()
      : contactName.trim();

    // Create primary contact if we have any contact info
    const hasContactInfo =
      resolvedContactName ||
      contactEmail.trim() ||
      contactMobile.trim() ||
      contactPhone.trim();

    if (hasContactInfo) {
      const { error: contactErr } = await supabase
        .from("customer_contacts")
        .insert({
          customer_id: newCustomer.id,
          name: resolvedContactName || name.trim(),
          role: contactRole.trim() || null,
          email: contactEmail.trim() || null,
          mobile: contactMobile.trim() || null,
          phone: contactPhone.trim() || null,
          is_primary: true,
        });

      if (contactErr) {
        // Customer created but contact failed — not fatal, log it
        console.error("Failed to create contact:", contactErr.message);
      }
    }

    // Create primary site if we have an address
    const hasSiteInfo = siteAddress.trim() || siteName.trim();
    if (hasSiteInfo) {
      const { error: siteErr } = await supabase
        .from("customer_sites")
        .insert({
          customer_id: newCustomer.id,
          name: siteName.trim() || name.trim(),
          address: siteAddress.trim() || null,
          suburb: siteSuburb.trim() || null,
          state: siteState || null,
          postcode: sitePostcode.trim() || null,
        });

      if (siteErr) {
        console.error("Failed to create site:", siteErr.message);
      }
    }

    router.push(`/customers/${newCustomer.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* --- Customer Info --- */}
      <div className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium">
            Customer Name <span className="text-destructive">*</span>
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            className={inputClass}
            placeholder="e.g. Snap Fitness Pimpama"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="type" className="block text-sm font-medium">
              Type
            </label>
            <select
              id="type"
              value={type}
              onChange={(e) => setType(e.target.value as CustomerType)}
              className={inputClass}
            >
              {customerTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="abn" className="block text-sm font-medium">
              ABN
            </label>
            <input
              id="abn"
              type="text"
              value={abn}
              onChange={(e) => setAbn(e.target.value)}
              className={inputClass}
              placeholder="XX XXX XXX XXX"
            />
          </div>
        </div>
      </div>

      {/* --- Primary Contact (new only) --- */}
      {!isEditing && (
        <div className="space-y-3 border-t border-border pt-5">
          <h3 className="text-sm font-semibold text-foreground">
            Primary Contact
          </h3>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={contactSameAsCustomer}
              onChange={(e) => setContactSameAsCustomer(e.target.checked)}
              className="rounded border-border accent-primary"
            />
            Contact name is the same as customer name
          </label>

          {!contactSameAsCustomer && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium">
                  Contact Name
                </label>
                <input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className={inputClass}
                  placeholder="Full name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Role</label>
                <input
                  value={contactRole}
                  onChange={(e) => setContactRole(e.target.value)}
                  className={inputClass}
                  placeholder="e.g. Site Manager"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium">Email</label>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className={inputClass}
              placeholder="contact@example.com"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium">Mobile</label>
              <input
                value={contactMobile}
                onChange={(e) => setContactMobile(e.target.value)}
                className={inputClass}
                placeholder="04XX XXX XXX"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Phone</label>
              <input
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className={inputClass}
                placeholder="07 XXXX XXXX"
              />
            </div>
          </div>
        </div>
      )}

      {/* --- Physical Address / Primary Site (new only) --- */}
      {!isEditing && (
        <div className="space-y-3 border-t border-border pt-5">
          <h3 className="text-sm font-semibold text-foreground">
            Physical Address
          </h3>

          <div>
            <label className="block text-sm font-medium">Site Name</label>
            <input
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              className={inputClass}
              placeholder="Leave blank to use customer name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">
              Street Address
            </label>
            <input
              value={siteAddress}
              onChange={(e) => setSiteAddress(e.target.value)}
              className={inputClass}
              placeholder="e.g. 10 Main Street"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium">Suburb</label>
              <input
                value={siteSuburb}
                onChange={(e) => setSiteSuburb(e.target.value)}
                className={inputClass}
                placeholder="Suburb"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">State</label>
              <select
                value={siteState}
                onChange={(e) => setSiteState(e.target.value)}
                className={inputClass}
              >
                <option value="QLD">QLD</option>
                <option value="NSW">NSW</option>
                <option value="VIC">VIC</option>
                <option value="SA">SA</option>
                <option value="WA">WA</option>
                <option value="TAS">TAS</option>
                <option value="NT">NT</option>
                <option value="ACT">ACT</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium">Postcode</label>
              <input
                value={sitePostcode}
                onChange={(e) => setSitePostcode(e.target.value)}
                className={inputClass}
                placeholder="4000"
              />
            </div>
          </div>
        </div>
      )}

      {/* --- Notes --- */}
      <div className="border-t border-border pt-5">
        <label htmlFor="notes" className="block text-sm font-medium">
          Notes
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className={`${inputClass} resize-none`}
          placeholder="Internal notes about this customer"
        />
      </div>

      {/* --- Actions --- */}
      <div className="flex gap-3 border-t border-border pt-5">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saving
            ? "Saving..."
            : isEditing
              ? "Update Customer"
              : "Create Customer"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
