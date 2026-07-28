"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Chasing notes for unsigned mandates — "rang Tuesday, owner back next week"
 * etc. Only rendered while the plan is draft / awaiting mandate; once signed
 * the box disappears (the notes stay in the DB). Mitchell 2026-07-14.
 */
export function ChaseNotes({ planId, initialNotes }: { planId: string; initialNotes: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/recurring-plans/${planId}/chase-notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setDirty(false);
      toast("Notes saved");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Mandate chasing notes
        </p>
        {dirty && (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setDirty(true);
        }}
        rows={2}
        placeholder="e.g. Rang 28/7 — owner overseas, chase again next Monday"
        className="w-full resize-y rounded-md border border-border bg-input px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />
      <p className="mt-1 text-[10px] text-muted-foreground">
        Hidden automatically once the mandate is signed.
      </p>
    </div>
  );
}
