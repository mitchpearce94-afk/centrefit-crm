"use client";

import { useState, useRef } from "react";
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const supabase = createClient();

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    // Preview for images
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  }

  function clearFile() {
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim() && !selectedFile) return;
    setSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    let imageUrl: string | null = null;

    // Upload image if selected
    if (selectedFile) {
      const ext = selectedFile.name.split(".").pop();
      const path = `${jobId}/${Date.now()}.${ext}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("job-attachments")
        .upload(path, selectedFile);

      if (uploadError) {
        alert(`Upload failed: ${uploadError.message}`);
        setSaving(false);
        return;
      }

      const { data: urlData } = supabase.storage
        .from("job-attachments")
        .getPublicUrl(uploadData.path);

      imageUrl = urlData.publicUrl;
    }

    const { error } = await supabase.from("job_notes").insert({
      job_id: jobId,
      staff_id: user?.id ?? null,
      content: content.trim() || (selectedFile ? `Photo: ${selectedFile.name}` : ""),
      type: noteType,
      image_url: imageUrl,
    });

    if (error) {
      alert(error.message);
    } else {
      setContent("");
      clearFile();
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

        {/* Image preview */}
        {previewUrl && (
          <div className="mt-2 relative inline-block">
            <img
              src={previewUrl}
              alt="Preview"
              className="h-24 w-auto rounded-md border border-border object-cover"
            />
            <button
              type="button"
              onClick={clearFile}
              className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] text-white hover:bg-destructive/80"
            >
              ×
            </button>
          </div>
        )}
        {selectedFile && !previewUrl && (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{selectedFile.name}</span>
            <button
              type="button"
              onClick={clearFile}
              className="text-destructive hover:underline"
            >
              Remove
            </button>
          </div>
        )}

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

          {/* Image upload button */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
          >
            <CameraIcon className="h-3.5 w-3.5" />
            Photo
          </button>

          <button
            type="submit"
            disabled={saving || (!content.trim() && !selectedFile)}
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
                <span>{note.staff?.display_name ?? "System"}</span>
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
            {note.image_url && (
              <a
                href={note.image_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block"
              >
                <img
                  src={note.image_url}
                  alt="Attachment"
                  className="max-h-48 w-auto rounded-md border border-border object-cover hover:opacity-90 transition-opacity"
                />
              </a>
            )}
          </div>
        ))}
        {notes.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">No notes yet.</p>
        )}
      </div>
    </div>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
