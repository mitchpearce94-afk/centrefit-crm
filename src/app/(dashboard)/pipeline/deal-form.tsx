"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DealStage } from "@/lib/types";

interface Deal {
  id: string;
  title: string;
  description: string | null;
  stage: DealStage;
  contact_name: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  assigned_to: string | null;
  customer_id: string | null;
}

interface CustomerOption {
  id: string;
  name: string;
}

interface StaffOption {
  id: string;
  display_name: string;
  initials: string;
  colour: string;
}

const STAGE_OPTIONS: { id: DealStage; label: string }[] = [
  { id: "lead", label: "Lead" },
  { id: "quote_sent", label: "Quote Sent" },
  { id: "accepted", label: "Accepted" },
];

export function DealForm({
  deal,
  customers,
  staff,
  onClose,
  onSaved,
}: {
  deal: Deal | null;
  customers: CustomerOption[];
  staff: StaffOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const isEditing = !!deal;

  const [title, setTitle] = useState(deal?.title ?? "");
  const [description, setDescription] = useState(deal?.description ?? "");
  const [stage, setStage] = useState<DealStage>(deal?.stage ?? "lead");
  const [customerId, setCustomerId] = useState(deal?.customer_id ?? "");
  const [contactName, setContactName] = useState(deal?.contact_name ?? "");
  const [contactPhone, setContactPhone] = useState(deal?.contact_phone ?? "");
  const [contactEmail, setContactEmail] = useState(deal?.contact_email ?? "");
  const [assignedTo, setAssignedTo] = useState(deal?.assigned_to ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New customer inline creation
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerType, setNewCustomerType] = useState<"commercial" | "residential" | "government" | "internal">("commercial");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    setSaving(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // If creating a new customer inline, insert them first
    let resolvedCustomerId = customerId || null;
    if (creatingCustomer && newCustomerName.trim()) {
      const { data: newCust, error: custErr } = await supabase
        .from("customers")
        .insert({
          name: newCustomerName.trim(),
          type: newCustomerType,
        })
        .select("id")
        .single();
      if (custErr) {
        setError(custErr.message);
        setSaving(false);
        return;
      }
      resolvedCustomerId = newCust.id;

      // If contact details were provided, create a primary contact
      if (contactName.trim()) {
        await supabase.from("customer_contacts").insert({
          customer_id: newCust.id,
          name: contactName.trim(),
          phone: contactPhone.trim() || null,
          email: contactEmail.trim() || null,
          is_primary: true,
        });
      }
    }

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      stage,
      customer_id: resolvedCustomerId,
      contact_name: contactName.trim() || null,
      contact_phone: contactPhone.trim() || null,
      contact_email: contactEmail.trim() || null,
      assigned_to: assignedTo || null,
      created_by: user?.id ?? null,
    };

    if (isEditing && deal) {
      const { error: err } = await supabase
        .from("pipeline_deals")
        .update(payload)
        .eq("id", deal.id);
      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }
    } else {
      const { error: err } = await supabase
        .from("pipeline_deals")
        .insert(payload);
      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }
    }

    onSaved();
  }

  async function handleDelete() {
    if (!deal || !confirm("Delete this deal?")) return;
    setSaving(true);
    const { error: err } = await supabase
      .from("pipeline_deals")
      .delete()
      .eq("id", deal.id);
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    onSaved();
  }

  const inputClass =
    "block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-lg rounded-t-2xl lg:rounded-2xl border border-border bg-card shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">
              {isEditing ? "Edit Deal" : "New Deal"}
            </h2>
            <button
              onClick={onClose}
              className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18" /><path d="M6 6l12 12" />
              </svg>
            </button>
          </div>

          {error && (
            <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Title */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Deal Title
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Snap Fitness Toowoomba — Full Fitout"
                required
                autoFocus
                className={inputClass}
              />
            </div>

            {/* Stage */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Stage
              </label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value as DealStage)}
                className={inputClass}
              >
                {STAGE_OPTIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Customer */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Customer
              </label>
              {!creatingCustomer ? (
                <div className="flex gap-2">
                  <select
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className={`${inputClass} flex-1`}
                  >
                    <option value="">Select customer...</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerId("");
                      setCreatingCustomer(true);
                    }}
                    className="shrink-0 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                  >
                    + New
                  </button>
                </div>
              ) : (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-primary">New Customer</span>
                    <button
                      type="button"
                      onClick={() => setCreatingCustomer(false)}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                  <input
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="Customer name"
                    autoFocus
                    className={inputClass}
                  />
                  <select
                    value={newCustomerType}
                    onChange={(e) => setNewCustomerType(e.target.value as any)}
                    className={inputClass}
                  >
                    <option value="commercial">Commercial</option>
                    <option value="residential">Residential</option>
                    <option value="government">Government</option>
                    <option value="internal">Internal</option>
                  </select>
                </div>
              )}
            </div>

            {/* Assigned To */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Assigned To
              </label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className={inputClass}
              >
                <option value="">Unassigned</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.display_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Contact info */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Contact
              </label>
              <div className="grid grid-cols-3 gap-2">
                <input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Name"
                  className={inputClass}
                />
                <input
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="Phone"
                  className={inputClass}
                />
                <input
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="Email"
                  type="email"
                  className={inputClass}
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Scope, notes, context..."
                className={`${inputClass} resize-none`}
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saving
                  ? "Saving..."
                  : isEditing
                  ? "Save Changes"
                  : "Create Deal"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              {isEditing && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={saving}
                  className="ml-auto rounded-md border border-border px-4 py-2 text-sm text-destructive hover:bg-destructive/10 hover:border-destructive transition-colors disabled:opacity-50"
                >
                  Delete
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
