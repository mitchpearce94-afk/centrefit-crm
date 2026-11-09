"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";

/**
 * The job reference is the job's title everywhere (jobs list, board, plan
 * builder), so it is edited right under the CFA number — click the text or
 * the pencil, type, Enter saves, Escape cancels. Mitchell 9 Nov 2026:
 * "make it so we can add / edit the job reference" — it used to hide as a
 * small input at the bottom of the Scope box.
 */
export function JobReferenceEditor({ jobId, reference }: { jobId: string; reference: string | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(reference ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function start() {
    setDraft(reference ?? "");
    setEditing(true);
  }

  async function save() {
    const next = draft.trim() || null;
    if (next === (reference ?? null)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("jobs").update({ reference: next }).eq("id", jobId);
    setSaving(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    setEditing(false);
    toast(next ? "Reference saved" : "Reference cleared", "success");
    router.refresh();
  }

  if (editing) {
    return (
      <div className="mt-1 flex items-center gap-2">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") setEditing(false);
          }}
          disabled={saving}
          maxLength={120}
          placeholder="Job reference — e.g. New Build, Felixgate, WiFi, PO 1234"
          className="h-9 w-full max-w-xl rounded-md border border-input bg-background px-3 text-base font-medium focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          autoFocus
        />
        <button
          onClick={() => void save()}
          disabled={saving}
          className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => setEditing(false)}
          disabled={saving}
          className="h-9 rounded-md px-3 text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      title="Edit job reference"
      className="group mt-1 flex max-w-full items-center gap-2 text-left"
    >
      {reference ? (
        <span className="truncate text-lg font-medium">{reference}</span>
      ) : (
        <span className="text-base text-muted-foreground">+ Add a job reference</span>
      )}
      <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
  );
}
