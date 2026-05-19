"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { CustomerSite } from "@/lib/types";
import { useToast } from "@/components/ui/toast";

const AU_STATES = ["QLD", "NSW", "VIC", "SA", "WA", "TAS", "NT", "ACT"];

export function SiteEditForm({ site }: { site: CustomerSite }) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [name, setName] = useState(site.name);
  const [address, setAddress] = useState(site.address ?? "");
  const [suburb, setSuburb] = useState(site.suburb ?? "");
  const [state, setState] = useState(site.state ?? "QLD");
  const [postcode, setPostcode] = useState(site.postcode ?? "");
  const [phone, setPhone] = useState(site.phone ?? "");
  const [notes, setNotes] = useState(site.notes ?? "");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Site name is required");
      return;
    }
    setSaving(true);
    setError(null);
    const { error: err } = await supabase
      .from("customer_sites")
      .update({
        name: name.trim(),
        address: address.trim() || null,
        suburb: suburb.trim() || null,
        state: state.trim() || null,
        postcode: postcode.trim() || null,
        phone: phone.trim() || null,
        notes: notes.trim() || null,
      })
      .eq("id", site.id);
    if (err) {
      setError(err.message);
    } else {
      toast("Site updated");
      router.refresh();
    }
    setSaving(false);
  }

  async function handleDelete() {
    const { error: err } = await supabase
      .from("customer_sites")
      .delete()
      .eq("id", site.id);
    if (err) {
      setError(err.message);
    } else {
      toast("Site deleted");
      router.push("/sites");
      router.refresh();
    }
  }

  const inputClass =
    "w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <form
      onSubmit={handleSave}
      className="max-w-xl rounded-lg border border-border bg-card p-5 space-y-3"
    >
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div>
        <label className="text-xs font-medium text-muted-foreground">
          Site Name *
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass + " mt-1"}
          required
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">
          Street Address
        </label>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className={inputClass + " mt-1"}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Suburb</label>
          <input
            value={suburb}
            onChange={(e) => setSuburb(e.target.value)}
            className={inputClass + " mt-1"}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">State</label>
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className={inputClass + " mt-1"}
          >
            {AU_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Postcode
          </label>
          <input
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
            className={inputClass + " mt-1"}
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">
          Phone (site reception / main contact)
        </label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={inputClass + " mt-1"}
          placeholder="04XX XXX XXX or 07 XXXX XXXX"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className={inputClass + " mt-1 resize-none"}
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="ml-auto rounded-md px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
          >
            Delete site
          </button>
        ) : (
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={handleDelete}
              className="rounded-md bg-destructive px-3 py-2 text-sm text-white hover:bg-destructive/90"
            >
              Confirm delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </form>
  );
}
