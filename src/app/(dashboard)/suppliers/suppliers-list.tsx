"use client";

import { useState, useMemo, useEffect } from "react";
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

interface ImportAction {
  action: "create" | "link" | "update" | "skip";
  xeroContactId: string;
  name: string;
  supplierId?: string;
  note?: string;
}
interface ImportPreview {
  summary: {
    xeroSupplierCount: number;
    toCreate: number;
    toLink: number;
    toUpdate: number;
    skipped: number;
  };
  actions: ImportAction[];
}

export function SuppliersList({ suppliers }: { suppliers: Supplier[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [createNew, setCreateNew] = useState(false);

  async function loadImportPreview(withCreateNew: boolean) {
    setImporting(true);
    try {
      const qs = new URLSearchParams({ dryRun: "1" });
      if (withCreateNew) qs.set("createNew", "1");
      const res = await fetch(`/api/suppliers/import-from-xero?${qs.toString()}`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        alert(json.error ?? "Preview failed");
        return;
      }
      setImportPreview(json as ImportPreview);
    } finally {
      setImporting(false);
    }
  }

  async function confirmImport() {
    setImporting(true);
    try {
      const qs = new URLSearchParams();
      if (createNew) qs.set("createNew", "1");
      const url = `/api/suppliers/import-from-xero${qs.toString() ? `?${qs}` : ""}`;
      const res = await fetch(url, { method: "POST" });
      const json = await res.json();
      if (!res.ok || json.error) {
        alert(json.error ?? "Import failed");
        return;
      }
      setImportPreview(null);
      setCreateNew(false);
      router.refresh();
    } finally {
      setImporting(false);
    }
  }

  async function toggleCreateNew(next: boolean) {
    setCreateNew(next);
    await loadImportPreview(next);
  }

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
          onClick={() => loadImportPreview(createNew)}
          disabled={importing}
          className="rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors shrink-0"
          title="Pull suppliers from Xero and populate CRM"
        >
          {importing ? "Loading…" : "Import from Xero"}
        </button>
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

      {importPreview && (
        <XeroImportPreviewModal
          preview={importPreview}
          busy={importing}
          createNew={createNew}
          onToggleCreateNew={toggleCreateNew}
          onCancel={() => {
            setImportPreview(null);
            setCreateNew(false);
          }}
          onConfirm={confirmImport}
        />
      )}

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        // Click outside the panel to dismiss (but not while saving)
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-lg border border-border bg-background shadow-xl flex flex-col">
        <div className="border-b border-border px-5 py-4 flex items-center justify-between gap-4">
          <h3 className="text-base font-semibold">
            {isEditing ? `Edit: ${supplier?.name}` : "New Supplier"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label="Close"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

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
        </form>

        <div className="border-t border-border px-5 py-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={(e) => {
              // Trigger the form submit from outside the form element
              const form = (e.currentTarget.closest("div[class*='max-w-3xl']") as HTMLElement)?.querySelector("form");
              if (form) form.requestSubmit();
            }}
            disabled={saving}
            className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : isEditing ? "Save Changes" : "Create Supplier"}
          </button>
        </div>
      </div>
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

function XeroImportPreviewModal({
  preview,
  busy,
  createNew,
  onToggleCreateNew,
  onCancel,
  onConfirm,
}: {
  preview: ImportPreview;
  busy: boolean;
  createNew: boolean;
  onToggleCreateNew: (next: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const s = preview.summary;
  const nothingToDo = s.toCreate === 0 && s.toLink === 0 && s.toUpdate === 0;
  const newItems = preview.actions.filter((a) => a.action === "create");
  const linkItems = preview.actions.filter((a) => a.action === "link");
  const updateItems = preview.actions.filter((a) => a.action === "update");
  // Split skip items into two buckets:
  //   - "no match" skips (would become creates if toggle is on)
  //   - other skips (already synced, conflicts, etc.)
  const unmatchedSkips = preview.actions.filter(
    (a) => a.action === "skip" && a.note?.startsWith("No CRM match"),
  );
  const otherSkips = preview.actions.filter(
    (a) => a.action === "skip" && !a.note?.startsWith("No CRM match"),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-lg border border-border bg-background shadow-xl flex flex-col">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">Import suppliers from Xero</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Found {s.xeroSupplierCount} active supplier contact{s.xeroSupplierCount === 1 ? "" : "s"} in Xero.
          </p>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <ImportStat label="Link existing" value={s.toLink} tone="neutral" />
            <ImportStat label="Backfill fields" value={s.toUpdate} tone="neutral" />
            <ImportStat
              label={createNew ? "Create new" : "Unmatched"}
              value={createNew ? s.toCreate : unmatchedSkips.length}
              tone={createNew ? "good" : "muted"}
            />
            <ImportStat label="No change" value={otherSkips.length} tone="muted" />
          </div>

          <label className="flex items-start gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={createNew}
              onChange={(e) => onToggleCreateNew(e.target.checked)}
              disabled={busy}
              className="mt-0.5 rounded border-border"
            />
            <div>
              <div className="font-medium">Also create new CRM suppliers from unmatched Xero contacts</div>
              <div className="text-muted-foreground text-[11px] mt-0.5">
                Default OFF. Xero orgs usually have hundreds of supplier contacts you don&rsquo;t
                want in the CRM. Only turn this on if you specifically want to bulk-import.
              </div>
            </div>
          </label>

          {linkItems.length > 0 && (
            <ActionSection
              title="Will link to existing CRM suppliers"
              tone="sky"
              items={linkItems.map((i) => ({ title: i.name, subtitle: "name match" }))}
            />
          )}
          {updateItems.length > 0 && (
            <ActionSection
              title="Will backfill missing fields"
              tone="muted"
              items={updateItems.map((i) => ({ title: i.name, subtitle: "already linked" }))}
            />
          )}
          {createNew && newItems.length > 0 && (
            <ActionSection
              title="Will create new suppliers"
              tone="emerald"
              items={newItems.map((i) => ({ title: i.name, subtitle: i.xeroContactId }))}
            />
          )}
          {!createNew && unmatchedSkips.length > 0 && (
            <ActionSection
              title="Unmatched Xero contacts (ignored)"
              tone="muted"
              items={unmatchedSkips
                .slice(0, 50)
                .map((i) => ({ title: i.name, subtitle: "not in CRM" }))}
            />
          )}
          {otherSkips.length > 0 && (
            <ActionSection
              title="No change"
              tone="muted"
              items={otherSkips.map((i) => ({ title: i.name, subtitle: i.note ?? "" }))}
            />
          )}

          {nothingToDo && (
            <p className="text-center text-xs text-muted-foreground italic">
              Nothing to import.
            </p>
          )}
        </div>

        <div className="border-t border-border px-5 py-3 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || nothingToDo}
            className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Importing…" : "Confirm & Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "neutral" | "muted";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-400"
      : tone === "neutral"
        ? "text-foreground"
        : "text-muted-foreground";
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className={`text-lg font-semibold ${toneClass}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function ActionSection({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "emerald" | "sky" | "muted";
  items: { title: string; subtitle: string }[];
}) {
  const titleClass =
    tone === "emerald"
      ? "text-emerald-400"
      : tone === "sky"
        ? "text-sky-400"
        : "text-muted-foreground";
  return (
    <section>
      <h3 className={`text-xs font-semibold uppercase tracking-wide ${titleClass}`}>
        {title} ({items.length})
      </h3>
      <div className="mt-2 rounded-md border border-border bg-muted/20 max-h-40 overflow-y-auto">
        <ul className="divide-y divide-border text-xs">
          {items.map((it, i) => (
            <li key={i} className="px-3 py-1.5 flex items-center justify-between gap-3">
              <span className="flex-1 truncate">{it.title}</span>
              <span className="text-muted-foreground text-[10px] truncate">{it.subtitle}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
