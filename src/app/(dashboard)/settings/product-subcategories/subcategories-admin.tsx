"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";

export interface ProductSubcategory {
  id: string;
  category: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

const inputClass =
  "rounded-md border border-border bg-input px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function SubcategoriesAdmin({
  subcategories,
  categories,
}: {
  subcategories: ProductSubcategory[];
  categories: string[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [addCategory, setAddCategory] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, ProductSubcategory[]>();
    for (const cat of categories) map.set(cat, []);
    for (const s of subcategories) {
      const list = map.get(s.category) ?? [];
      list.push(s);
      map.set(s.category, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    }
    return Array.from(map.entries());
  }, [subcategories, categories]);

  async function add(category: string) {
    const name = newName.trim();
    if (!name) {
      toast("Name is required", "error");
      return;
    }
    setSaving(true);
    const maxSort = Math.max(
      0,
      ...subcategories.filter((s) => s.category === category).map((s) => s.sort_order),
    );
    const { error } = await supabase
      .from("product_subcategories")
      .insert({ category, name, sort_order: maxSort + 10 });
    setSaving(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    setNewName("");
    setAddCategory(null);
    router.refresh();
  }

  async function rename(id: string) {
    const name = editName.trim();
    if (!name) {
      toast("Name is required", "error");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("product_subcategories").update({ name }).eq("id", id);
    setSaving(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    setEditingId(null);
    router.refresh();
  }

  async function toggleActive(id: string, is_active: boolean) {
    const { error } = await supabase.from("product_subcategories").update({ is_active }).eq("id", id);
    if (error) {
      toast(error.message, "error");
      return;
    }
    router.refresh();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("product_subcategories").delete().eq("id", id);
    if (error) {
      toast(error.message, "error");
      return;
    }
    toast("Sub-category removed");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {grouped.map(([category, items]) => (
        <div key={category} className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold">
              {category}{" "}
              <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
            </h2>
            <button
              type="button"
              onClick={() => {
                setAddCategory(category);
                setNewName("");
              }}
              className="text-xs font-medium text-primary hover:text-primary/80"
            >
              + Add
            </button>
          </div>

          <div className="divide-y divide-border">
            {items.map((s) => (
              <div key={s.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                {editingId === s.id ? (
                  <>
                    <input
                      value={editName}
                      autoFocus
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && rename(s.id)}
                      className={`${inputClass} flex-1`}
                    />
                    <button
                      type="button"
                      onClick={() => rename(s.id)}
                      disabled={saving}
                      className="text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className={`flex-1 ${!s.is_active ? "text-muted-foreground line-through" : ""}`}>
                      {s.name}
                    </span>
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={s.is_active}
                        onChange={(e) => toggleActive(s.id, e.target.checked)}
                        className="rounded border-border"
                      />
                      Active
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(s.id);
                        setEditName(s.name);
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(s.id)}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            ))}

            {addCategory === category && (
              <div className="flex items-center gap-2 px-4 py-2">
                <input
                  value={newName}
                  autoFocus
                  placeholder="New sub-category name"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && add(category)}
                  className={`${inputClass} flex-1`}
                />
                <button
                  type="button"
                  onClick={() => add(category)}
                  disabled={saving}
                  className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setAddCategory(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            )}

            {items.length === 0 && addCategory !== category && (
              <p className="px-4 py-2 text-xs text-muted-foreground italic">
                No sub-categories yet.
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
