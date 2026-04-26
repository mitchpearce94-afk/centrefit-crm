"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

interface ScopeRole {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  is_handled_in_generator: boolean;
  sort_order: number;
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

const inputClass =
  "block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function ScopeRolesManager({ roles }: { roles: ScopeRole[] }) {
  const supabase = createClient();
  const router = useRouter();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ScopeRole | null>(null);
  const [busy, setBusy] = useState(false);

  async function deleteRole(role: ScopeRole) {
    if (role.is_handled_in_generator) {
      toast("This role is hard-coded in the generator — deleting it would orphan products. Edit the slug instead.", "error");
      return;
    }
    if (!confirm(`Delete the "${role.label}" role? Products tagged with this role will fall into the Miscellaneous block until retagged.`)) return;
    setBusy(true);
    const { error } = await supabase.from("quote_scope_roles").delete().eq("id", role.id);
    setBusy(false);
    if (error) toast(error.message, "error");
    else { toast(`Deleted ${role.label}`); router.refresh(); }
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + New role
        </button>
      </div>

      {showForm && (
        <RoleForm
          role={editing}
          onSaved={() => { setShowForm(false); setEditing(null); router.refresh(); }}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      <div className="surface-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Label</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Slug</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Description</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider text-center">Status</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {roles.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground italic">No roles yet — add one to get started.</td></tr>
            )}
            {roles.map((role) => (
              <tr key={role.id} className="transition-colors hover:bg-accent/40">
                <td className="px-4 py-2.5 font-medium text-foreground">{role.label}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{role.slug}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[420px]">{role.description || <span className="opacity-50">—</span>}</td>
                <td className="px-4 py-2.5 text-center">
                  {role.is_handled_in_generator ? (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">Handled</span>
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Misc fallback</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="inline-flex gap-2">
                    <button
                      onClick={() => { setEditing(role); setShowForm(true); }}
                      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Edit
                    </button>
                    {!role.is_handled_in_generator && (
                      <button
                        onClick={() => deleteRole(role)}
                        disabled={busy}
                        className="text-[11px] text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground italic">
        Roles flagged <span className="text-emerald-400">Handled</span> have dedicated wording in the scope-of-works generator (e.g. "(N) IP cameras…"). Adding a new role here makes it selectable in the Products page; if the generator doesn't have specific wording for it, items tagged with that role will appear in the <strong>Additional items</strong> block listing the product name + qty.
      </p>
    </div>
  );
}

function RoleForm({ role, onSaved, onCancel }: {
  role: ScopeRole | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const isEditing = !!role;
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState(role?.label ?? "");
  const [slug, setSlug] = useState(role?.slug ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [sortOrder, setSortOrder] = useState(role?.sort_order?.toString() ?? "100");
  const [slugDirty, setSlugDirty] = useState(false);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function onLabelChange(v: string) {
    setLabel(v);
    if (!slugDirty && !isEditing) setSlug(slugify(v));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) { toast("Label is required", "error"); return; }
    const finalSlug = slug.trim() || slugify(label);
    if (!finalSlug) { toast("Slug couldn't be derived from the label", "error"); return; }
    setBusy(true);
    const payload = {
      label: label.trim(),
      slug: finalSlug,
      description: description.trim() || null,
      sort_order: parseInt(sortOrder, 10) || 100,
    };
    if (isEditing && role) {
      const { error } = await supabase.from("quote_scope_roles").update(payload).eq("id", role.id);
      if (error) { toast(error.message, "error"); setBusy(false); return; }
      toast("Role updated");
    } else {
      const { error } = await supabase.from("quote_scope_roles").insert(payload);
      if (error) { toast(error.message, "error"); setBusy(false); return; }
      toast("Role created");
    }
    onSaved();
  }

  if (!mounted) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm pointer-events-none" />
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative w-full max-w-[560px] max-h-[92vh] overflow-y-auto rounded-xl bg-background border border-border shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Scope role</p>
            <h2 className="text-base font-semibold text-foreground truncate">
              {isEditing ? `Edit — ${role!.label}` : "New scope role"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Label</label>
              <input value={label} onChange={(e) => onLabelChange(e.target.value)} required className={inputClass} placeholder="e.g. Smart Lock" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Slug <span className="font-normal text-muted-foreground/60">(used internally)</span></label>
              <input
                value={slug}
                onChange={(e) => { setSlug(e.target.value); setSlugDirty(true); }}
                className={inputClass + " font-mono"}
                placeholder="auto from label"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Description <span className="font-normal text-muted-foreground/60">(internal — shows in this list)</span></label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} placeholder="What kind of product is this for?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Sort order</label>
              <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className={inputClass} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4 bg-muted/30">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-primary px-5 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {busy ? "Saving..." : isEditing ? "Update role" : "Create role"}
          </button>
        </div>
      </form>
    </div>
  );

  return createPortal(modal, document.body);
}
