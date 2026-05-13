"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { compressImage, mapWithConcurrency } from "@/lib/images/compress";

interface Attachment {
  url: string;
  name: string;
  type: string;
  size?: number;
}

export function NotesPanel({
  jobId,
  notes,
  defaultShowForm = false,
  openSignal,
}: {
  jobId: string;
  notes: any[];
  defaultShowForm?: boolean;
  /** Incrementing counter from parent — when it changes, auto-open the form. */
  openSignal?: number;
}) {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(defaultShowForm);

  // Parent (e.g. mobile action bar) bumps openSignal to ask us to open the form.
  useEffect(() => {
    if (openSignal === undefined || openSignal === 0) return;
    setShowForm(true);
  }, [openSignal]);
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
      {/* Header: stacks on mobile so search input gets full width and the
          New Note button is a full-width primary CTA. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-4 sm:mb-5">
        <div className="relative flex-1 sm:max-w-sm">
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
          className="w-full sm:w-auto rounded-md bg-primary px-4 py-2.5 sm:py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          + New Note
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

      {/* ── Mobile cards ── */}
      {filtered.length > 0 && (
        <div className="md:hidden space-y-2">
          {filtered.map((note) => {
            const attachments: Attachment[] = note.attachments ?? [];
            if (attachments.length === 0 && note.image_url) {
              attachments.push({ url: note.image_url, name: "Photo", type: "image" });
            }
            const isExpanded = expandedNote === note.id;
            const displayTitle = note.title || note.content.split("\n")[0].slice(0, 60) || "Untitled";
            const typeBadge = note.type !== "note" ? note.type : null;
            return (
              <button
                key={note.id}
                type="button"
                onClick={() => setExpandedNote(isExpanded ? null : note.id)}
                className="block w-full text-left rounded-lg border border-border bg-card p-4 active:bg-accent/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{displayTitle}</span>
                      {typeBadge && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase font-medium text-muted-foreground">
                          {typeBadge}
                        </span>
                      )}
                    </div>
                  </div>
                  {note.staff && (
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ring-1 ring-white/10"
                      style={{ backgroundColor: note.staff.colour ?? "#6b7280" }}
                    >
                      {note.staff.initials}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate">{note.staff?.display_name ?? "System"}</span>
                  <span className="shrink-0">
                    {new Date(note.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                  </span>
                </div>
                {attachments.length > 0 && (
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    {attachments.slice(0, 4).map((att, i) => (
                      <div key={i} className="h-9 w-9 rounded border border-border bg-muted overflow-hidden shrink-0">
                        {att.type?.startsWith("image") ? (
                          <img src={att.url} alt={att.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[8px] font-medium text-muted-foreground uppercase">
                            {att.name?.split(".").pop() ?? "file"}
                          </div>
                        )}
                      </div>
                    ))}
                    {attachments.length > 4 && (
                      <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        +{attachments.length - 4}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Desktop table ── (unchanged) */}
      {filtered.length > 0 ? (
        <div className="hidden md:block rounded-lg border border-border bg-card overflow-x-auto">
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
                                  loading="lazy"
                                  decoding="async"
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
          onMutated={() => {
            router.refresh();
          }}
          onDeleted={() => {
            setExpandedNote(null);
            router.refresh();
          }}
        />
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Showing {filtered.length} note{filtered.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

/* ── Note Detail (expanded view) ── */
function NoteDetail({
  note,
  onClose,
  onMutated,
  onDeleted,
}: {
  note: any;
  onClose: () => void;
  onMutated: () => void;
  onDeleted: () => void;
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState<string>(note?.title ?? "");
  const [content, setContent] = useState<string>(note?.content ?? "");
  const [noteType, setNoteType] = useState<"note" | "email" | "call">(
    (note?.type as "note" | "email" | "call") ?? "note",
  );
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingAtt, setConfirmingAtt] = useState<number | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!note) return null;

  const attachments: Attachment[] = Array.isArray(note.attachments) ? [...note.attachments] : [];
  if (attachments.length === 0 && note.image_url) {
    attachments.push({ url: note.image_url, name: "Photo", type: "image" });
  }

  function bucketPathFromUrl(url: string): string | null {
    // Public URL format: <project>/storage/v1/object/public/job-attachments/<path>
    const marker = "/storage/v1/object/public/job-attachments/";
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(url.slice(idx + marker.length));
  }

  async function saveEdit() {
    setSaving(true);
    const { error } = await supabase
      .from("job_notes")
      .update({
        title: title.trim() || null,
        content: content.trim(),
        type: noteType,
      })
      .eq("id", note.id);
    setSaving(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    setEditing(false);
    onMutated();
  }

  function handleDeleteClick() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmingDelete(false), 4000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmingDelete(false);
    void deleteNote();
  }

  async function deleteNote() {
    setSaving(true);
    // Best-effort: delete the stored objects, then the row. Ignore storage errors;
    // the row delete is what the user sees.
    const paths = attachments
      .map((a) => bucketPathFromUrl(a.url))
      .filter((p): p is string => !!p);
    if (paths.length > 0) {
      await supabase.storage.from("job-attachments").remove(paths);
    }
    const { error } = await supabase.from("job_notes").delete().eq("id", note.id);
    setSaving(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    onDeleted();
  }

  function handleAttachmentDeleteClick(idx: number) {
    if (confirmingAtt !== idx) {
      setConfirmingAtt(idx);
      if (attTimer.current) clearTimeout(attTimer.current);
      attTimer.current = setTimeout(() => setConfirmingAtt(null), 4000);
      return;
    }
    if (attTimer.current) clearTimeout(attTimer.current);
    setConfirmingAtt(null);
    void deleteAttachment(idx);
  }

  async function deleteAttachment(idx: number) {
    const target = attachments[idx];
    if (!target) return;
    const remaining = attachments.filter((_, i) => i !== idx);
    const path = bucketPathFromUrl(target.url);
    if (path) {
      await supabase.storage.from("job-attachments").remove([path]);
    }
    const remainingImage = remaining.find((a) => a.type?.startsWith("image"))?.url ?? null;
    const stillReferencedByImageUrl = note.image_url && remaining.some((a) => a.url === note.image_url);
    const { error } = await supabase
      .from("job_notes")
      .update({
        attachments: remaining,
        image_url: stillReferencedByImageUrl ? note.image_url : remainingImage,
      })
      .eq("id", note.id);
    if (error) {
      toast(error.message, "error");
      return;
    }
    onMutated();
  }

  const inputClass =
    "block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="mt-4 rounded-lg border border-primary/30 bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between bg-muted/50 px-4 py-3 border-b border-border gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium truncate">
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
        <div className="flex items-center gap-1.5 shrink-0">
          {!editing && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(true);
                }}
                className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
              >
                Edit
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteClick();
                }}
                disabled={saving}
                className={`rounded-md px-2 py-1 text-xs transition-colors ${
                  confirmingDelete
                    ? "border border-destructive bg-destructive/10 text-destructive"
                    : "border border-border text-muted-foreground hover:text-destructive hover:border-destructive"
                }`}
              >
                {saving ? "Deleting…" : confirmingDelete ? "Tap to confirm" : "Delete"}
              </button>
            </>
          )}
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
      </div>

      {/* Content */}
      <div className="px-4 py-4">
        {editing ? (
          <div className="space-y-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note title"
              className={inputClass}
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              placeholder="Details..."
              className={`${inputClass} resize-none`}
            />
            <div className="flex flex-wrap items-center gap-2">
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
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setTitle(note?.title ?? "");
                  setContent(note?.content ?? "");
                  setNoteType((note?.type as "note" | "email" | "call") ?? "note");
                }}
                className="w-full sm:w-auto rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={saving || !content.trim()}
                className="w-full sm:w-auto rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm whitespace-pre-wrap">{note.content}</p>
        )}
      </div>

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Attachments ({attachments.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {attachments.map((att, i) => {
              const confirming = confirmingAtt === i;
              return (
                <div key={i} className="relative group">
                  <a href={att.url} target="_blank" rel="noopener noreferrer" className="block">
                    {att.type?.startsWith("image") ? (
                      <img
                        src={att.url}
                        alt={att.name}
                        loading="lazy"
                        decoding="async"
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
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleAttachmentDeleteClick(i);
                    }}
                    title={confirming ? "Tap to confirm delete" : "Delete attachment"}
                    className={`absolute -top-1.5 -right-1.5 flex items-center justify-center rounded-full text-white shadow ring-1 ring-white/10 transition-all ${
                      confirming
                        ? "h-6 px-2 text-[10px] font-semibold bg-destructive"
                        : "h-5 w-5 text-xs bg-destructive/90 hover:bg-destructive"
                    }`}
                  >
                    {confirming ? "Tap to confirm" : "×"}
                  </button>
                </div>
              );
            })}
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
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
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

    // Compress images client-side (resize to 1920px JPEG) then upload 4-in-parallel.
    // Sequential await in a for-loop kills throughput when techs drop 50-100 photos.
    let done = 0;
    if (selectedFiles.length > 0) {
      setUploadProgress({ done: 0, total: selectedFiles.length });
    }
    const uploaded = await mapWithConcurrency<File, Attachment | null>(selectedFiles, 4, async (file) => {
      const prepped = await compressImage(file);
      const ext = prepped.name.split(".").pop();
      const path = `${jobId}/notes/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { data, error } = await supabase.storage
        .from("job-attachments")
        .upload(path, prepped);
      done++;
      setUploadProgress({ done, total: selectedFiles.length });
      if (error || !data) return null;
      const { data: urlData } = supabase.storage
        .from("job-attachments")
        .getPublicUrl(data.path);
      return {
        url: urlData.publicUrl,
        name: file.name,
        type: prepped.type,
        size: prepped.size,
      };
    });
    const attachments: Attachment[] = uploaded.filter((a): a is Attachment => a !== null);
    setUploadProgress(null);

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
                loading="lazy"
                decoding="async"
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

      {/* Actions — stacked on mobile so the Save button is full-width and
          never gets pushed off-screen. Type pills + Attach sit above; the
          two main actions (Cancel / Save) take the bottom row. */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
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
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
        >
          <AttachIcon className="h-3.5 w-3.5" />
          Attach
        </button>
      </div>
      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-2 border-t border-border">
        <button
          type="button"
          onClick={onClose}
          className="w-full sm:w-auto rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || (!title.trim() && !content.trim() && selectedFiles.length === 0)}
          className="w-full sm:w-auto rounded-md bg-primary px-5 py-2.5 sm:py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {uploadProgress
            ? `Uploading ${uploadProgress.done}/${uploadProgress.total}…`
            : saving
              ? "Saving..."
              : "Save Note"}
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
