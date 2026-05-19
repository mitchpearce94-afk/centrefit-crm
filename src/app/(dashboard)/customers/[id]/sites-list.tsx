"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { CustomerSite } from "@/lib/types";
import { useToast } from "@/components/ui/toast";

export function SitesList({
  customerId,
  sites,
}: {
  customerId: string;
  sites: CustomerSite[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Sites</h2>
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
        <SiteForm customerId={customerId} onDone={() => setShowForm(false)} />
      )}

      <div className="mt-3 space-y-2">
        {sites.map((site) => (
          <div key={site.id}>
            {editingId === site.id ? (
              <SiteForm
                customerId={customerId}
                site={site}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <div className="flex items-start justify-between rounded-lg border border-border bg-card p-3">
                <div>
                  <span className="text-sm font-medium">{site.name}</span>
                  {site.address && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {[site.address, site.suburb, site.state, site.postcode]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  )}
                  {site.phone && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <a href={`tel:${site.phone}`} className="hover:text-primary">📞 {site.phone}</a>
                    </p>
                  )}
                  {site.notes && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {site.notes}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setEditingId(site.id)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        ))}
        {sites.length === 0 && !showForm && (
          <p className="text-sm text-muted-foreground py-4">No sites yet.</p>
        )}
      </div>
    </div>
  );
}

function SiteForm({
  customerId,
  site,
  onDone,
}: {
  customerId: string;
  site?: CustomerSite;
  onDone: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(site?.name ?? "");
  const [address, setAddress] = useState(site?.address ?? "");
  const [suburb, setSuburb] = useState(site?.suburb ?? "");
  const [state, setState] = useState(site?.state ?? "QLD");
  const [postcode, setPostcode] = useState(site?.postcode ?? "");
  const [phone, setPhone] = useState(site?.phone ?? "");
  const [notes, setNotes] = useState(site?.notes ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Site name is required");
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      customer_id: customerId,
      name: name.trim(),
      address: address.trim() || null,
      suburb: suburb.trim() || null,
      state: state.trim() || null,
      postcode: postcode.trim() || null,
      phone: phone.trim() || null,
      notes: notes.trim() || null,
    };

    let result;
    if (site) {
      result = await supabase
        .from("customer_sites")
        .update(payload)
        .eq("id", site.id);
    } else {
      result = await supabase.from("customer_sites").insert(payload);
    }

    if (result.error) {
      setError(result.error.message);
    } else {
      toast(site ? "Site updated" : "Site added");
      onDone();
      router.refresh();
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!site) return;
    const { error: err } = await supabase
      .from("customer_sites")
      .delete()
      .eq("id", site.id);
    if (err) {
      setError(err.message);
    } else {
      toast("Site deleted");
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
      <input
        placeholder="Site Name *"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        className="w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <input
        placeholder="Street Address"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        className="w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div className="grid grid-cols-3 gap-2">
        <input
          placeholder="Suburb"
          value={suburb}
          onChange={(e) => setSuburb(e.target.value)}
          className="rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          value={state}
          onChange={(e) => setState(e.target.value)}
          className="rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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
        <input
          placeholder="Postcode"
          value={postcode}
          onChange={(e) => setPostcode(e.target.value)}
          className="rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <input
        placeholder="Phone (site reception / main contact)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        type="tel"
        className="w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <textarea
        placeholder="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        className="w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm resize-none focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : site ? "Update" : "Add Site"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        {site && !confirmDelete && (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="ml-auto rounded-md px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
          >
            Delete
          </button>
        )}
        {site && confirmDelete && (
          <div className="ml-auto flex gap-1">
            <button type="button" onClick={handleDelete} className="rounded-md bg-destructive px-3 py-1.5 text-xs text-white hover:bg-destructive/90">Confirm</button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">No</button>
          </div>
        )}
      </div>
    </form>
  );
}
