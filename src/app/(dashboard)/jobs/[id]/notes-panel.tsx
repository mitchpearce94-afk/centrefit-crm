"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

interface Attachment {
  url: string;
  name: string;
  type: string;
  size?: number;
}

export function NotesPanel({
  jobId,
  notes,
}: {
  jobId: string;
  notes: any[];
}) {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const router = useRouter();

  // Filter notes by search
  const filtered = notes.filter((note) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (note.title ?? "").toLowerCase().includes(q) ||
      note.content.toLowerCase().includes(q) ||
      (note.staff?.display_name ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div>
      {/* Header: search + new note */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes..."
            className="w-full rounded-md border border-border bg-input pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          New Note
        </button>
      </div>

      {/* New note form */}
      {showForm && (
        <NoteForm
          jobId={jobId}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            router.refresh();
          }}
        />
      )}

      {/* Notes table */}
      {filtered.length > 0 ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Note
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-32">
                  Files
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-36">
                  Entered By
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground w-28">
                  Date
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((note) => {
                const attachments: Attachment[] = note.attachments ?? [];
                // Backwards compat: old single image_url
                if (attachments.length === 0 && note.image_url) {
                  attachments.push({ url: note.image_url, name: "Photo", type: "image" });
                }
                const isExpanded = expandedNote === note.id;
                const displayTitle = note.title || note.content.split("\n")[0].slice(0, 60) || "Untitled";
                const typeBadge = note.type !== "note" ? note.type : null;

                return (
                  <tr
                    key={note.id}
                    className="border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer"
                    onClick={() => setExpandedNote(isExpanded ? null : note.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-primary font-medium hover:underline">
                          {displayTitle}
                        </span>
                        {typeBadge && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase font-medium text-muted-foreground">
                            {typeBadge}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {attachments.length > 0 && (
                        <div className="flex items-center gap-1">
                          {attachments.slice(0, 3).map((att, i) => (
                            <div
                              key={i}
                              className="h-8 w-8 rounded border border-border bg-muted overflow-hidden shrink-0"
                            >
                              {att.type?.startsWith("image") ? (
                                <img
                                  src={att.url}
                                  alt={att.name}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[8px] font-medium text-muted-foreground uppercase">
                                  {att.name?.split(".").pop() ?? "file"}
                                </div>
                              )}
                            </div>
                          ))}
                          {attachments.length > 3 && (
                            <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              +{attachments.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <div className="flex items-center gap-2">
                        {note.staff && (
                          <span
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-medium text-white"
                            style={{ backgroundColor: note.staff.colour ?? "#6b7280" }}
                          >
                            {note.staff.initials}
                          </span>
                        )}
                        <span className="truncate text-xs">
                          {note.staff?.display_name ?? "System"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(note.created_at).toLocaleDateString("en-AU", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {search ? "No notes matching your search." : "No notes yet."}
          </p>
          {!search && !showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="mt-2 text-sm text-primary hover:text-primary/80 transition-colors"
            >
              Add the first note
            </button>
          )}
        </div>
      )}

      {/* Expanded note detail */}
      {expandedNote && (
        <NoteDetail
          note={filtered.find((n) => n.id === expandedNote)}
          onClose={() => setExpandedNote(null)}
        />
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Showing {filtered.length} note{filtered.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

/* ── Note Detail (expanded view) ── */
function NoteDetail({ note, onClose }: { note: any; onClose: () => void }) {
  if (!note) return null;

  const attachments: Attachment[] = note.attachments ?? [];
  if (attachments.length === 0 && note.image_url) {
    attachments.push({ url: note.image_url, name: "Photo", type: "image" });
  }

  return (
    <div className="mt-4 rounded-lg border border-primary/30 bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between bg-muted/50 px-4 py-3 border-b border-border">
        <div>
          <h3 className="text-sm font-medium">
            {note.title || note.content.split("\n")[0].slice(0, 60) || "Untitled"}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {note.staff?.display_name ?? "System"} · {new Date(note.created_at).toLocaleDateString("en-AU", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}{" "}
            {new Date(note.created_at).toLocaleTimeString("en-AU", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
        >
          Close
        </button>
      </div>

      {/* Content */}
      <div className="px-4 py-4">
        <p className="text-sm whitespace-pre-wrap">{note.content}</p>
      </div>

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Attachments ({attachments.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {attachments.map((att, i) => (
              <a
                key={i}
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group"
              >
                {att.type?.startsWith("image") ? (
                  <img
                    src={att.url}
                    alt={att.name}
                    className="h-24 w-auto rounded-md border border-border object-cover group-hover:opacity-90 transition-opacity"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-md border border-border bg-muted group-hover:bg-accent transition-colors">
                    <div className="text-center">
                      <FileIcon className="h-6 w-6 text-muted-foreground mx-auto" />
                      <p className="mt-1 text-[10px] text-muted-foreground truncate max-w-[80px]">
                        {att.name}
                      </p>
                    </div>
                  </div>
                )}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── New Note Form ── */
function NoteForm({
  jobId,
  onClose,
  onSaved,
}: {
  jobId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [noteType, setNoteType] = useState<"note" | "email" | "call">("note");
  const [saving, setSaving] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const supabase = createClient();

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setSelectedFiles((prev) => [...prev, ...files]);
    const newPreviews = files
      .filter((f) => f.type.startsWith("image/"))
      .map((f) => URL.createObjectURL(f));
    setPreviews((prev) => [...prev, ...newPreviews]);
  }

  function removeFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() && !content.trim() && selectedFiles.length === 0) return;
    setSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Upload files
    const attachments: Attachment[] = [];
    for (const file of selectedFiles) {
      const ext = file.name.split(".").pop();
      const path = `${jobId}/notes/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { data, error } = await supabase.storage
        .from("job-attachments")
        .upload(path, file);
      if (!error && data) {
        const { data: urlData } = supabase.storage
          .from("job-attachments")
          .getPublicUrl(data.path);
        attachments.push({
          url: urlData.publicUrl,
          name: file.name,
          type: file.type,
          size: file.size,
        });
      }
    }

    const { error } = await supabase.from("job_notes").insert({
      job_id: jobId,
      staff_id: user?.id ?? null,
      title: title.trim() || null,
      content: content.trim() || (title.trim() ? title.trim() : ""),
      type: noteType,
      attachments,
      // Keep backwards compat
      image_url: attachments.find((a) => a.type?.startsWith("image"))?.url ?? null,
    });

    if (error) {
      toast(error.message, "error");
      setSaving(false);
      return;
    }

    onSaved();
  }

  const inputClass =
    "block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-5 rounded-lg border border-primary/30 bg-card p-4 space-y-3"
    >
      {/* Title */}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Note title (e.g. Customer Photos, Site Inspection)"
        className={inputClass}
        autoFocus
      />

      {/* Content */}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        placeholder="Details..."
        className={`${inputClass} resize-none`}
      />

      {/* File previews */}
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {previews.map((url, i) => (
            <div key={i} className="relative">
              <img
                src={url}
                alt=""
                className="h-20 w-20 rounded-md border border-border object-cover"
              />
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] text-white"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {/* Non-image file names */}
      {selectedFiles
        .filter((f) => !f.type.startsWith("image/"))
        .map((f, i) => (
          <div key={`file-${i}`} className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileIcon className="h-3.5 w-3.5" />
            <span>{f.name}</span>
          </div>
        ))}

      {/* Actions row */}
      <div className="flex items-center gap-3 pt-1">
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

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
        >
          <AttachIcon className="h-3.5 w-3.5" />
          Attach Files
        </button>

        <div className="flex-1" />

        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || (!title.trim() && !content.trim() && selectedFiles.length === 0)}
          className="rounded-md bg-primary px-5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : "Save Note"}
        </button>
      </div>
    </form>
  );
}

// ── Icons ──

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function AttachIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
