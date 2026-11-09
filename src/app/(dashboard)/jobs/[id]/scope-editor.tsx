"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

// Description only. The job reference is edited in the page header (job-reference-editor.tsx).
export function ScopeEditor({
  jobId,
  description,
}: {
  jobId: string;
  description: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftDesc, setDraftDesc] = useState(description ?? "");

  function startEdit() {
    setDraftDesc(description ?? "");
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("jobs")
      .update({ description: draftDesc.trim() || null })
      .eq("id", jobId);
    setSaving(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    setEditing(false);
    toast("Scope updated", "success");
    router.refresh();
  }

  const isEmpty = !description;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Scope / Description
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
            value={draftDesc}
            onChange={(e) => setDraftDesc(e.target.value)}
            placeholder="Scope of works / description..."
            rows={8}
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
          No scope yet — click to add.
        </button>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="max-h-[160px] overflow-y-auto p-4 text-sm whitespace-pre-wrap">
            {description}
          </div>
        </div>
      )}
    </div>
  );
}
