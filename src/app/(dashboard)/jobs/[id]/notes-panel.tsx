"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function NotesPanel({
  jobId,
  notes,
}: {
  jobId: string;
  notes: any[];
}) {
  const [content, setContent] = useState("");
  const [noteType, setNoteType] = useState<"note" | "email" | "call">("note");
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("job_notes").insert({
      job_id: jobId,
      staff_id: user?.id ?? null,
      content: content.trim(),
      type: noteType,
    });

    if (error) {
      alert(error.message);
    } else {
      setContent("");
      router.refresh();
    }
    setSaving(false);
  }

  return (
    <div className="max-w-2xl">
      {/* Add note form */}
      <form onSubmit={handleAdd} className="mb-5">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          placeholder="Add a note..."
          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
        />
        <div className="mt-2 flex items-center gap-3">
          <div className="flex gap-1 rounded-md border border-border p-0.5">
            {(["note", "email", "call"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setNoteType(t)}
                className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                  noteType === t
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={saving || !content.trim()}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? "Adding..." : "Add Note"}
          </button>
        </div>
      </form>

      {/* Notes list */}
      <div className="space-y-3">
        {notes.map((note) => (
          <div
            key={note.id}
            className={`rounded-lg border p-3 ${
              note.type === "system"
                ? "border-border/50 bg-muted/30"
                : "border-border bg-card"
            }`}
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                {note.staff && (
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium text-white"
                    style={{
                      backgroundColor: note.staff.colour ?? "#6b7280",
                    }}
                  >
                    {note.staff.initials}
                  </span>
                )}
                <span>
                  {note.staff?.display_name ?? "System"}
                </span>
                {note.type !== "system" && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">
                    {note.type}
                  </span>
                )}
              </div>
              <span>
                {new Date(note.created_at).toLocaleDateString("en-AU")}{" "}
                {new Date(note.created_at).toLocaleTimeString("en-AU", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <p
              className={`mt-2 text-sm whitespace-pre-wrap ${
                note.type === "system"
                  ? "text-muted-foreground italic"
                  : ""
              }`}
            >
              {note.content}
            </p>
          </div>
        ))}
        {notes.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">No notes yet.</p>
        )}
      </div>
    </div>
  );
}
