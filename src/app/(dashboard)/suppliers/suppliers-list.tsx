"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  account_number: string | null;
  notes: string | null;
  is_active: boolean;
  parts?: { count: number }[];
}

export function SuppliersList({ suppliers }: { suppliers: Supplier[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const filtered = useMemo(() => {
    let list = suppliers;
    if (!showInactive) {
      list = list.filter((s) => s.is_active);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.contact_name ?? "").toLowerCase().includes(q) ||
          (s.email ?? "").toLowerCase().includes(q) ||
          (s.phone ?? "").includes(q) ||
          (s.account_number ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [suppliers, search, showInactive]);

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search suppliers..."
            className="w-full rounded-md border border-border bg-input pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-border"
          />
          Inactive
        </label>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          New Supplier
        </button>
      </div>

      {/* Supplier form */}
      {showForm && (
        <SupplierForm
          supplier={editing}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {/* Supplier list */}
      {filtered.length > 0 ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Supplier
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden lg:table-cell">
                  Contact
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden lg:table-cell">
                  Phone
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden lg:table-cell">
                  Account #
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground w-20">
                  Parts
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((supplier) => {
                const partsCount = supplier.parts?.[0]?.count ?? 0;
                return (
                  <tr
                    key={supplier.id}
                    onClick={() => {
                      setEditing(supplier);
                      setShowForm(true);
                    }}
                    className={`border-b border-border last:border-0 cursor-pointer hover:bg-accent/50 transition-colors ${
                      !supplier.is_active ? "opacity-50" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium">{supplier.name}</p>
                      {supplier.email && (
                        <p className="text-xs text-muted-foreground lg:hidden">
                          {supplier.email}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                      {supplier.contact_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                      {supplier.phone ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                      {supplier.account_number ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {partsCount > 0 ? partsCount : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {search ? "No suppliers matching your search." : "No suppliers yet."}
          </p>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Showing {filtered.length} of {suppliers.length} suppliers
      </p>
    </div>
  );
}

/* ── Supplier Form (create/edit) ── */
function SupplierForm({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const isEditing = !!supplier;

  const [name, setName] = useState(supplier?.name ?? "");
  const [contactName, setContactName] = useState(supplier?.contact_name ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [suburb, setSuburb] = useState(supplier?.suburb ?? "");
  const [state, setState] = useState(supplier?.state ?? "QLD");
  const [accountNumber, setAccountNumber] = useState(supplier?.account_number ?? "");
  const [notes, setNotes] = useState(supplier?.notes ?? "");
  const [isActive, setIsActive] = useState(supplier?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      name: name.trim(),
      contact_name: contactName.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
      suburb: suburb.trim() || null,
      state: state.trim() || null,
      account_number: accountNumber.trim() || null,
      notes: notes.trim() || null,
      is_active: isActive,
    };

    if (isEditing && supplier) {
      const { error: err } = await supabase
        .from("suppliers")
        .update(payload)
        .eq("id", supplier.id);
      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }
    } else {
      const { error: err } = await supabase.from("suppliers").insert(payload);
      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }
    }

    onSaved();
  }

  const inputClass =
    "block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="mb-5 rounded-lg border border-primary/30 bg-card p-5">
      <h3 className="text-sm font-bold mb-4">
        {isEditing ? `Edit: ${supplier?.name}` : "New Supplier"}
      </h3>

      {error && (
        <div className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Name
            </label>
            <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Contact Name
            </label>
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Phone
            </label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Email
            </label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Address
            </label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Suburb
              </label>
              <input value={suburb} onChange={(e) => setSuburb(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                State
              </label>
              <select value={state} onChange={(e) => setState(e.target.value)} className={inputClass}>
                <option>QLD</option><option>NSW</option><option>VIC</option><option>SA</option><option>WA</option><option>TAS</option><option>NT</option><option>ACT</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Account Number
            </label>
            <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className={inputClass} />
          </div>
          <div className="flex items-center gap-2 pt-5">
            <button
              type="button"
              onClick={() => setIsActive(!isActive)}
              className={`relative h-5 w-9 rounded-full transition-colors ${isActive ? "bg-primary" : "bg-muted"}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${isActive ? "left-[18px]" : "left-0.5"}`} />
            </button>
            <span className="text-sm text-muted-foreground">{isActive ? "Active" : "Inactive"}</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${inputClass} resize-none`} />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button type="submit" disabled={saving} className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Supplier"}
          </button>
          <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
    </svg>
  );
}
