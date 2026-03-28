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

interface CustomerFormProps {
  customer?: Customer;
}

export function CustomerForm({ customer }: CustomerFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const isEditing = !!customer;

  const [name, setName] = useState(customer?.name ?? "");
  const [type, setType] = useState<CustomerType>(customer?.type ?? "commercial");
  const [abn, setAbn] = useState(customer?.abn ?? "");
  const [notes, setNotes] = useState(customer?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name: name.trim(),
      type,
      abn: abn.trim() || null,
      notes: notes.trim() || null,
    };

    if (!payload.name) {
      setError("Customer name is required");
      setSaving(false);
      return;
    }

    let result;
    if (isEditing) {
      result = await supabase
        .from("customers")
        .update(payload)
        .eq("id", customer.id)
        .select()
        .single();
    } else {
      result = await supabase
        .from("customers")
        .insert(payload)
        .select()
        .single();
    }

    if (result.error) {
      setError(result.error.message);
      setSaving(false);
    } else {
      router.push(`/customers/${result.data.id}`);
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="name" className="block text-sm font-medium">
          Customer Name *
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="mt-1 block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="e.g. Snap Fitness Pimpama"
        />
      </div>

      <div>
        <label htmlFor="type" className="block text-sm font-medium">
          Type
        </label>
        <select
          id="type"
          value={type}
          onChange={(e) => setType(e.target.value as CustomerType)}
          className="mt-1 block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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
          className="mt-1 block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="XX XXX XXX XXX"
        />
      </div>

      <div>
        <label htmlFor="notes" className="block text-sm font-medium">
          Notes
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="mt-1 block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : isEditing ? "Update Customer" : "Create Customer"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
