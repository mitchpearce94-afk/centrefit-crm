"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function WorkLog({
  jobId,
  entries,
}: {
  jobId: string;
  entries: any[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [content, setContent] = useState("");
  const [workDate, setWorkDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [saving, setSaving] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
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
    if (!content.trim()) return;
    setSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Upload photos
    const imageUrls: string[] = [];
    for (const file of selectedFiles) {
      const ext = file.name.split(".").pop();
      const path = `${jobId}/work/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { data, error } = await supabase.storage
        .from("job-attachments")
        .upload(path, file);
      if (!error && data) {
        const { data: urlData } = supabase.storage
          .from("job-attachments")
          .getPublicUrl(data.path);
        imageUrls.push(urlData.publicUrl);
      }
    }

    const { error } = await supabase.from("job_work_entries").insert({
      job_id: jobId,
      staff_id: user?.id ?? null,
      work_date: workDate,
      content: content.trim(),
      image_urls: imageUrls,
    });

    if (error) {
      alert(error.message);
    } else {
      setContent("");
      setSelectedFiles([]);
      setPreviews([]);
      setShowForm(false);
      router.refresh();
    }
    setSaving(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Work Completed
        </h2>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <span className="text-lg leading-none">+</span>
            Add Entry
          </button>
        )}
      </div>

      {/* Add work entry form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-4 rounded-lg border border-primary/30 bg-card p-4 space-y-3"
        >
          <div className="flex items-center gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground">
                Date
              </label>
              <input
                type="date"
                value={workDate}
                onChange={(e) => setWorkDate(e.target.value)}
                className="mt-0.5 rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            autoFocus
            placeholder="What work was completed? Equipment installed, issues found, tests performed..."
            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-y"
          />

          {/* Photo previews */}
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

          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
            >
              <CameraIcon className="h-3.5 w-3.5" />
              Add Photos
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setContent("");
                setSelectedFiles([]);
                setPreviews([]);
              }}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !content.trim()}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Save Entry"}
            </button>
          </div>
        </form>
      )}

      {/* Work entries list */}
      <div className="space-y-3">
        {entries.map((entry: any) => {
          const images: string[] = entry.image_urls ?? [];
          return (
            <div
              key={entry.id}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                <div className="flex items-center gap-2">
                  {entry.staff && (
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium text-white"
                      style={{
                        backgroundColor: entry.staff.colour ?? "#3b82f6",
                      }}
                    >
                      {entry.staff.initials}
                    </span>
                  )}
                  <span className="font-medium text-foreground">
                    {entry.staff?.display_name ?? "Unknown"}
                  </span>
                </div>
                <span>
                  {new Date(entry.work_date + "T00:00:00").toLocaleDateString(
                    "en-AU",
                    { weekday: "short", day: "numeric", month: "short", year: "numeric" }
                  )}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{entry.content}</p>
              {images.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {images.map((url: string, i: number) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img
                        src={url}
                        alt=""
                        className="h-24 w-auto rounded-md border border-border object-cover hover:opacity-90 transition-opacity"
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {entries.length === 0 && !showForm && (
          <div className="rounded-lg border border-dashed border-border py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No work entries yet.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="mt-2 text-sm text-primary hover:text-primary/80 transition-colors"
            >
              Add the first entry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
    </svg>
  );
}
