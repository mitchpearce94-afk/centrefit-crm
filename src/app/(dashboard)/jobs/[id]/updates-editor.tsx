"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Internal "Updates" box on a job — interim progress notes staff keep current
 * as a job evolves. Deliberately separate from Scope / Description: the
 * description feeds the invoice Scope of Works, whereas this is NEVER pushed
 * to a customer invoice. Same edit/save UX as ScopeEditor for consistency.
 */
export function UpdatesEditor({
  jobId,
  updates,
}: {
  jobId: string;
  updates: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(updates ?? "");

  function startEdit() {
    setDraft(updates ?? "");
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("jobs")
      .update({ updates: draft.trim() || null })
      .eq("id", jobId);
    setSaving(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    setEditing(false);
    toast("Updates saved", "success");
    router.refresh();
  }

  const isEmpty = !updates;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Updates
          <span className="ml-2 normal-case font-normal text-[10px] text-muted-foreground/70">
            Internal only — not on invoices
          </span>
        </h2>
        {!editing && (
          <button
            onClick={startEdit}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {isEmpty ? "+ Add" : "Edit"}
          </button>
        )}
      </div>

      {editing ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Progress, changes, things to track as the job moves..."
            rows={6}
            className="w-full bg-transparent p-4 text-sm focus:outline-none resize-y"
          />
          <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-3 py-2">
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : isEmpty ? (
        <button
          onClick={startEdit}
          className="w-full rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground hover:text-foreground hover:border-primary transition-colors text-left"
        >
          No updates yet — click to add.
        </button>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="max-h-[160px] overflow-y-auto p-4 text-sm whitespace-pre-wrap">
            {updates}
          </div>
        </div>
      )}
    </div>
  );
}
