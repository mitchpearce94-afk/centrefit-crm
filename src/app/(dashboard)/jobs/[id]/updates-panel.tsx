"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

interface UpdateEntry {
  id: string;
  staff_id: string | null;
  content: string;
  edited_at: string | null;
  archived_at: string | null;
  created_at: string;
  staff: { display_name: string; initials: string; colour: string | null } | null;
}

/**
 * Internal "Updates" log on a job — dated, author-attributed entries staff
 * add as a job evolves. Replaces the old single free-text box (jobs.updates;
 * legacy text was migrated as unattributed entries). Deliberately separate
 * from Scope / Description: NEVER pushed to a customer invoice. Entries are
 * archived rather than deleted so the history survives.
 */
export function UpdatesPanel({
  jobId,
  updates,
}: {
  jobId: string;
  updates: UpdateEntry[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const active = updates.filter((u) => !u.archived_at);
  const archived = updates.filter((u) => u.archived_at);

  async function addEntry() {
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      toast("Your session has expired — log in again in another tab, then retry.", "error");
      return;
    }
    const { error } = await supabase
      .from("job_updates")
      .insert({ job_id: jobId, staff_id: user.id, content });
    setSaving(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    setDraft("");
    setAdding(false);
    router.refresh();
  }

  async function saveEdit(entry: UpdateEntry) {
    const content = editDraft.trim();
    if (!content) return;
    setSaving(true);
    // .select() so an RLS-filtered update (0 rows) surfaces as an error
    // instead of silently saving nothing (same guard as job notes).
    const { data, error } = await supabase
      .from("job_updates")
      .update({ content, edited_at: new Date().toISOString() })
      .eq("id", entry.id)
      .select("id");
    setSaving(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    if (!data || data.length === 0) {
      toast("Couldn't save — please refresh and try again.", "error");
      return;
    }
    setEditingId(null);
    router.refresh();
  }

  function handleArchiveClick(entry: UpdateEntry) {
    if (confirmingArchive !== entry.id) {
      setConfirmingArchive(entry.id);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmingArchive(null), 4000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmingArchive(null);
    void setArchived(entry, true);
  }

  async function setArchived(entry: UpdateEntry, archive: boolean) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("job_updates")
      .update(
        archive
          ? { archived_at: new Date().toISOString(), archived_by: user?.id ?? null }
          : { archived_at: null, archived_by: null },
      )
      .eq("id", entry.id);
    if (error) {
      toast(error.message, "error");
      return;
    }
    toast(archive ? "Entry archived" : "Entry restored", "success");
    router.refresh();
  }

  function entryMeta(u: UpdateEntry) {
    const when = new Date(u.created_at);
    return `${when.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })} ${when.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}`;
  }

  function renderEntry(u: UpdateEntry, isArchived: boolean) {
    const isEditing = editingId === u.id;
    const confirming = confirmingArchive === u.id;
    return (
      <div
        key={u.id}
        className={`px-4 py-3 ${isArchived ? "opacity-60" : ""}`}
      >
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-medium text-white"
              style={{ backgroundColor: u.staff?.colour ?? "#6b7280" }}
            >
              {u.staff?.initials ?? "•"}
            </span>
            <span className="text-xs font-medium text-foreground truncate">
              {u.staff?.display_name ?? "Imported"}
            </span>
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              {entryMeta(u)}
              {u.edited_at && <span className="ml-1">(edited)</span>}
            </span>
          </div>
          {!isEditing && (
            <div className="flex items-center gap-1 shrink-0">
              {isArchived ? (
                <button
                  onClick={() => void setArchived(u, false)}
                  className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                >
                  Restore
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setEditingId(u.id);
                      setEditDraft(u.content);
                    }}
                    className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleArchiveClick(u)}
                    className={`rounded-md px-2 py-0.5 text-[11px] transition-colors ${
                      confirming
                        ? "border border-amber-500 bg-amber-500/10 text-amber-500"
                        : "border border-border text-muted-foreground hover:text-foreground hover:border-foreground"
                    }`}
                  >
                    {confirming ? "Tap to confirm" : "Archive"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {isEditing ? (
          <div className="mt-2">
            <textarea
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-input p-3 text-sm focus:border-primary focus:outline-none resize-y"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                onClick={() => setEditingId(null)}
                disabled={saving}
                className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveEdit(u)}
                disabled={saving || !editDraft.trim()}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm whitespace-pre-wrap">{u.content}</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Updates
          <span className="ml-2 normal-case font-normal text-[10px] text-muted-foreground/70">
            Internal only — not on invoices
          </span>
        </h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <span className="text-lg leading-none">+</span>
            Add Entry
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-2 rounded-lg border border-primary/30 bg-card overflow-hidden">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Progress, changes, things to track as the job moves..."
            rows={3}
            autoFocus
            className="w-full bg-transparent p-4 text-sm focus:outline-none resize-y"
          />
          <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-3 py-2">
            <button
              onClick={() => {
                setAdding(false);
                setDraft("");
              }}
              disabled={saving}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void addEntry()}
              disabled={saving || !draft.trim()}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Add entry"}
            </button>
          </div>
        </div>
      )}

      {active.length === 0 && !adding ? (
        <button
          onClick={() => setAdding(true)}
          className="w-full rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground hover:text-foreground hover:border-primary transition-colors text-left"
        >
          No updates yet — click to add the first entry.
        </button>
      ) : active.length > 0 ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="max-h-[320px] overflow-y-auto divide-y divide-border">
            {active.map((u) => renderEntry(u, false))}
          </div>
        </div>
      ) : null}

      {archived.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </button>
          {showArchived && (
            <div className="mt-1.5 rounded-lg border border-dashed border-border bg-muted/10 overflow-hidden divide-y divide-border">
              {archived.map((u) => renderEntry(u, true))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
