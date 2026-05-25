"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import type { Category } from "@/lib/types";

export function JobTypesAdmin({ types }: { types: Category[] }) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = types;
    if (!showInactive) list = list.filter((t) => t.is_active);
    if (search.trim().length >= 2) {
      const q = search.toLowerCase();
      list = list.filter((t) => t.name.toLowerCase().includes(q));
    }
    return list;
  }, [types, search, showInactive]);

  async function updateType(id: string, patch: Partial<Category>) {
    const { error } = await supabase.from("categories").update(patch).eq("id", id);
    if (error) {
      toast(error.message, "error");
      return;
    }
    router.refresh();
  }

  async function deleteType(id: string) {
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) {
      // Categories with FK references (jobs assigned to this type) will fail
      // — fall back to deactivation so the type drops out of pickers without
      // breaking historic jobs.
      toast(
        `${error.message}. Deactivating instead so it stops appearing in pickers.`,
        "error",
      );
      await updateType(id, { is_active: false });
      return;
    }
    toast("Job type removed");
    router.refresh();
  }

  function nextSortOrder(): number {
    const max = types.reduce((m, t) => Math.max(m, t.sort_order ?? 0), 0);
    return max + 1;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search job types..."
          className="flex-1 min-w-[200px] rounded-md border border-border bg-input px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
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
          + New job type
        </button>
      </div>

      {adding && (
        <NewJobTypeForm
          defaultSortOrder={nextSortOrder()}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            router.refresh();
          }}
        />
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium w-16">Order</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium w-24 text-center">Active</th>
              <th className="px-3 py-2 font-medium w-40 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) =>
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
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{t.sort_order}</td>
                  <td className="px-3 py-2 font-medium">{t.name}</td>
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
                      onClick={() => {
                        if (confirmingDeleteId === t.id) {
                          setConfirmingDeleteId(null);
                          void deleteType(t.id);
                        } else {
                          setConfirmingDeleteId(t.id);
                          setTimeout(() => {
                            setConfirmingDeleteId((cur) => (cur === t.id ? null : cur));
                          }, 4000);
                        }
                      }}
                      className={`text-xs ${
                        confirmingDeleteId === t.id
                          ? "text-destructive font-semibold"
                          : "text-muted-foreground hover:text-destructive"
                      }`}
                    >
                      {confirmingDeleteId === t.id ? "Tap to confirm" : "Delete"}
                    </button>
                  </td>
                </tr>
              ),
            )}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-12 text-center text-sm text-muted-foreground">
                  No job types match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditRow({
  type,
  onCancel,
  onSaved,
}: {
  type: Category;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const [name, setName] = useState(type.name);
  const [sortOrder, setSortOrder] = useState<number>(type.sort_order ?? 0);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) {
      toast("Name is required", "error");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("categories")
      .update({ name: name.trim(), sort_order: sortOrder })
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
      <td colSpan={4} className="px-3 py-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs sm:col-span-2">
            <span className="text-muted-foreground">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="mt-0.5 w-full rounded-md border border-border bg-input px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Sort order</span>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
              className="mt-0.5 w-full rounded-md border border-border bg-input px-2 py-1 text-sm"
            />
          </label>
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

function NewJobTypeForm({
  defaultSortOrder,
  onClose,
  onSaved,
}: {
  defaultSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState<number>(defaultSortOrder);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) {
      toast("Name is required", "error");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("categories").insert({
      type: "job_type",
      name: name.trim(),
      sort_order: sortOrder,
      is_active: true,
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
      <h3 className="text-sm font-semibold mb-3">New job type</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs sm:col-span-2">
          <span className="text-muted-foreground">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="mt-0.5 w-full rounded-md border border-border bg-input px-2 py-1 text-sm"
            placeholder="e.g. Solar Install"
          />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Sort order</span>
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
            className="mt-0.5 w-full rounded-md border border-border bg-input px-2 py-1 text-sm"
          />
        </label>
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
