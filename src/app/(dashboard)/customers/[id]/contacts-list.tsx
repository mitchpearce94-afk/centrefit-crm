"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { CustomerContact } from "@/lib/types";
import { useToast } from "@/components/ui/toast";

export function ContactsList({
  customerId,
  contacts,
}: {
  customerId: string;
  contacts: CustomerContact[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Contacts</h2>
        <button
          onClick={() => {
            setShowForm(true);
            setEditingId(null);
          }}
          className="text-sm text-primary hover:text-primary/80 transition-colors"
        >
          + Add
        </button>
      </div>

      {showForm && !editingId && (
        <ContactForm
          customerId={customerId}
          onDone={() => setShowForm(false)}
        />
      )}

      <div className="mt-3 space-y-2">
        {contacts.map((contact) => (
          <div key={contact.id}>
            {editingId === contact.id ? (
              <ContactForm
                customerId={customerId}
                contact={contact}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <div className="flex items-start justify-between rounded-lg border border-border bg-card p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{contact.name}</span>
                    {contact.is_primary && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                        Primary
                      </span>
                    )}
                  </div>
                  {contact.role && (
                    <p className="text-xs text-muted-foreground">{contact.role}</p>
                  )}
                  <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                    {contact.email && <span>{contact.email}</span>}
                    {contact.mobile && <span>{contact.mobile}</span>}
                    {contact.phone && !contact.mobile && <span>{contact.phone}</span>}
                  </div>
                </div>
                <button
                  onClick={() => setEditingId(contact.id)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        ))}
        {contacts.length === 0 && !showForm && (
          <p className="text-sm text-muted-foreground py-4">No contacts yet.</p>
        )}
      </div>
    </div>
  );
}

function ContactForm({
  customerId,
  contact,
  onDone,
}: {
  customerId: string;
  contact?: CustomerContact;
  onDone: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(contact?.name ?? "");
  const [role, setRole] = useState(contact?.role ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [mobile, setMobile] = useState(contact?.mobile ?? "");
  const [isPrimary, setIsPrimary] = useState(contact?.is_primary ?? false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      customer_id: customerId,
      name: name.trim(),
      role: role.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      mobile: mobile.trim() || null,
      is_primary: isPrimary,
    };

    let result;
    if (contact) {
      result = await supabase
        .from("customer_contacts")
        .update(payload)
        .eq("id", contact.id);
    } else {
      result = await supabase.from("customer_contacts").insert(payload);
    }

    if (result.error) {
      setError(result.error.message);
    } else {
      toast(contact ? "Contact updated" : "Contact added");
      onDone();
      router.refresh();
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!contact) return;
    const { error: err } = await supabase
      .from("customer_contacts")
      .delete()
      .eq("id", contact.id);
    if (err) {
      setError(err.message);
    } else {
      toast("Contact deleted");
      onDone();
      router.refresh();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 rounded-lg border border-primary/30 bg-card p-3 space-y-2"
    >
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <input
          placeholder="Name *"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <input
          placeholder="Role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <input
        placeholder="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          placeholder="Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <input
          placeholder="Mobile"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          className="rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isPrimary}
          onChange={(e) => setIsPrimary(e.target.checked)}
          className="rounded border-border"
        />
        Primary contact
      </label>
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : contact ? "Update" : "Add Contact"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        {contact && !confirmDelete && (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="ml-auto rounded-md px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
          >
            Delete
          </button>
        )}
        {contact && confirmDelete && (
          <div className="ml-auto flex gap-1">
            <button type="button" onClick={handleDelete} className="rounded-md bg-destructive px-3 py-1.5 text-xs text-white hover:bg-destructive/90">Confirm</button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">No</button>
          </div>
        )}
      </div>
    </form>
  );
}
