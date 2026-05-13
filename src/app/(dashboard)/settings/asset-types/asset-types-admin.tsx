"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import type { AssetType } from "@/lib/types";

const CATEGORIES = ["data", "cctv", "security", "access", "duress", "audio", "av", "other"] as const;

const FLAG_LABELS: { key: keyof AssetType; label: string; hint: string }[] = [
  { key: "has_serial", label: "Serial", hint: "Show serial number field" },
  { key: "has_mac", label: "MAC", hint: "Show MAC address field" },
  { key: "has_ip", label: "IP", hint: "Show IP address field" },
  { key: "has_network_credentials", label: "Admin creds", hint: "Subnet, admin user/password, firmware" },
  { key: "has_staff_credentials", label: "Staff creds", hint: "Secondary user/password (NVR-style)" },
  { key: "has_firmware", label: "Firmware", hint: "Firmware version field" },
  { key: "has_vlans", label: "VLANs", hint: "Repeating VLAN entries" },
  { key: "has_wifi", label: "Wi-Fi SSIDs", hint: "Repeating SSID + password entries" },
  { key: "is_key_info", label: "Key info", hint: "Surface on the Site → Key Information tab" },
];

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function AssetTypesAdmin({ types }: { types: AssetType[] }) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    let list = types;
    if (!showInactive) list = list.filter((t) => t.is_active);
    if (categoryFilter) list = list.filter((t) => t.category === categoryFilter);
    if (search.trim().length >= 2) {
      const q = search.toLowerCase();
      list = list.filter((t) => t.name.toLowerCase().includes(q) || t.slug.includes(q));
    }
    return list;
  }, [types, search, categoryFilter, showInactive]);

  const groupedByCategory = useMemo(() => {
    const map = new Map<string, AssetType[]>();
    for (const t of filtered) {
      const key = t.category ?? "uncategorised";
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  async function updateType(id: string, patch: Partial<AssetType>) {
    const { error } = await supabase.from("asset_types").update(patch).eq("id", id);
    if (error) {
      toast(error.message, "error");
      return;
    }
    router.refresh();
  }

  async function deleteType(id: string) {
    const { error } = await supabase.from("asset_types").delete().eq("id", id);
    if (error) {
      toast(error.message, "error");
      return;
    }
    toast("Asset type removed");
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search asset types..."
          className="flex-1 min-w-[200px] rounded-md border border-border bg-input px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-md border border-border bg-input px-3 py-2 text-sm"
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-border"
          />
          Show inactive
        </label>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + New asset type
        </button>
      </div>

      {adding && (
        <NewAssetTypeForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            router.refresh();
          }}
        />
      )}

      <div className="space-y-6">
        {groupedByCategory.map(([category, items]) => (
          <div key={category}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {category} ({items.length})
            </h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium hidden md:table-cell">Slug</th>
                    <th className="px-3 py-2 font-medium hidden lg:table-cell">Default Mfr</th>
                    <th className="px-3 py-2 font-medium">Fields</th>
                    <th className="px-3 py-2 font-medium w-24 text-center">Active</th>
                    <th className="px-3 py-2 font-medium w-32 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) =>
                    editingId === t.id ? (
                      <EditRow
                        key={t.id}
                        type={t}
                        onCancel={() => setEditingId(null)}
                        onSaved={() => {
                          setEditingId(null);
                          router.refresh();
                        }}
                      />
                    ) : (
                      <tr key={t.id} className={`border-b border-border last:border-0 ${!t.is_active ? "opacity-40" : ""}`}>
                        <td className="px-3 py-2 font-medium">{t.name}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground hidden md:table-cell">{t.slug}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground hidden lg:table-cell">
                          {t.default_manufacturer ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {FLAG_LABELS.filter((f) => t[f.key]).map((f) => (
                              <span
                                key={f.key}
                                className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                                title={f.hint}
                              >
                                {f.label}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={t.is_active}
                            onChange={(e) => updateType(t.id, { is_active: e.target.checked })}
                            className="rounded border-border"
                          />
                        </td>
                        <td className="px-3 py-2 text-right space-x-3">
                          <button
                            onClick={() => setEditingId(t.id)}
                            className="text-xs text-muted-foreground hover:text-foreground"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteType(t.id)}
                            className="text-xs text-muted-foreground hover:text-destructive"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {groupedByCategory.length === 0 && (
          <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            No asset types match your filters.
          </div>
        )}
      </div>
    </div>
  );
}

function EditRow({
  type,
  onCancel,
  onSaved,
}: {
  type: AssetType;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const [name, setName] = useState(type.name);
  const [category, setCategory] = useState(type.category ?? "");
  const [defaultMfr, setDefaultMfr] = useState(type.default_manufacturer ?? "");
  const [flags, setFlags] = useState({
    has_serial: type.has_serial,
    has_mac: type.has_mac,
    has_ip: type.has_ip,
    has_network_credentials: type.has_network_credentials,
    has_staff_credentials: type.has_staff_credentials,
    has_firmware: type.has_firmware,
    has_vlans: type.has_vlans,
    has_wifi: type.has_wifi,
    is_key_info: type.is_key_info,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) {
      toast("Name is required", "error");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("asset_types")
      .update({
        name: name.trim(),
        category: category || null,
        default_manufacturer: defaultMfr.trim() || null,
        ...flags,
      })
      .eq("id", type.id);
    setSaving(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    onSaved();
  }

  return (
    <tr className="border-b border-border bg-muted/20">
      <td colSpan={6} className="px-3 py-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs">
            <span className="text-muted-foreground">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-0.5 w-full rounded-md border border-border bg-input px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-0.5 w-full rounded-md border border-border bg-input px-2 py-1 text-sm"
            >
              <option value="">—</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Default manufacturer</span>
            <input
              type="text"
              value={defaultMfr}
              onChange={(e) => setDefaultMfr(e.target.value)}
              className="mt-0.5 w-full rounded-md border border-border bg-input px-2 py-1 text-sm"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {FLAG_LABELS.map((f) => (
            <label
              key={f.key}
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs cursor-pointer"
              title={f.hint}
            >
              <input
                type="checkbox"
                checked={(flags as any)[f.key]}
                onChange={(e) =>
                  setFlags((prev) => ({ ...prev, [f.key]: e.target.checked }))
                }
                className="rounded border-border"
              />
              {f.label}
            </label>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

function NewAssetTypeForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const supabase = createClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [defaultMfr, setDefaultMfr] = useState("");
  const [flags, setFlags] = useState({
    has_serial: true,
    has_mac: false,
    has_ip: false,
    has_network_credentials: false,
    has_staff_credentials: false,
    has_firmware: false,
    has_vlans: false,
    has_wifi: false,
    is_key_info: false,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) {
      toast("Name is required", "error");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("asset_types").insert({
      slug: slugify(name),
      name: name.trim(),
      category: category || null,
      default_manufacturer: defaultMfr.trim() || null,
      sort_order: 500,
      ...flags,
    });
    setSaving(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    onSaved();
  }

  return (
    <div className="mb-4 rounded-lg border border-primary/30 bg-card p-4">
      <h3 className="text-sm font-semibold mb-3">New asset type</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs">
          <span className="text-muted-foreground">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="mt-0.5 w-full rounded-md border border-border bg-input px-2 py-1 text-sm"
            placeholder="e.g. Cardio Distribution"
          />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-border bg-input px-2 py-1 text-sm"
          >
            <option value="">—</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Default manufacturer</span>
          <input
            type="text"
            value={defaultMfr}
            onChange={(e) => setDefaultMfr(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-border bg-input px-2 py-1 text-sm"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {FLAG_LABELS.map((f) => (
          <label
            key={f.key}
            className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs cursor-pointer"
            title={f.hint}
          >
            <input
              type="checkbox"
              checked={(flags as any)[f.key]}
              onChange={(e) =>
                setFlags((prev) => ({ ...prev, [f.key]: e.target.checked }))
              }
              className="rounded border-border"
            />
            {f.label}
          </label>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Create"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
