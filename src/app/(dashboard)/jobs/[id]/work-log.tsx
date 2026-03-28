"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const QUICK_LINES = [
  "Left KGSQ at __:__ and travelled to site",
  "Arrived on site at __:__",
  "Opened routed cables and terminated at controls",
  "Mounted and installed cameras",
  "Terminated all data cables",
  "Routed cables through patch panels",
  "Terminated all cables into server cabinet",
  "Tested all cameras — working as normal",
  "Tested all access control — working as normal",
  "Tested all duress buttons — working as normal",
  "Set static IP addresses to all cameras",
  "Built and mounted CCTV monitor on top of server cabinet",
  "Final walk-through with client and sign-off",
  "Left site at __:__ and travelled back",
];

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
  const [showQuickLines, setShowQuickLines] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  function insertQuickLine(line: string) {
    const newContent = content
      ? content.trimEnd() + "\n" + line
      : line;
    setContent(newContent);
    setShowQuickLines(false);
    // Focus textarea and put cursor at end
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.selectionStart = newContent.length;
        textareaRef.current.selectionEnd = newContent.length;
      }
    }, 0);
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

      {/* ── Add work entry form ── */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-5 rounded-lg border border-primary/30 bg-card p-4 space-y-3"
        >
          {/* Date */}
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              className="rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-xs text-muted-foreground">
              {new Date(workDate + "T00:00:00").toLocaleDateString("en-AU", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>

          {/* Main textarea */}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            autoFocus
            placeholder={"What work was completed today?\nOne line per task — e.g.:\n\nTerminated all data cables behind the video wall\nRouted cables through patch panels\nTested all cameras — working as normal"}
            className="w-full rounded-md border border-border bg-input px-3 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-y font-mono leading-relaxed"
          />

          {/* Quick lines */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowQuickLines(!showQuickLines)}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
            >
              <ZapIcon className="h-3.5 w-3.5" />
              Quick Insert
            </button>
            {showQuickLines && (
              <div className="absolute left-0 bottom-full z-50 mb-1 w-80 max-h-64 overflow-y-auto rounded-lg border border-border bg-card shadow-xl">
                {QUICK_LINES.map((line, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => insertQuickLine(line)}
                    className="block w-full px-3 py-2 text-left text-xs hover:bg-accent transition-colors border-b border-border last:border-0"
                  >
                    {line}
                  </button>
                ))}
              </div>
            )}
          </div>

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

          {/* Actions row */}
          <div className="flex items-center gap-2 pt-1">
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
              Photos
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
              className="rounded-md border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !content.trim()}
              className="rounded-md bg-primary px-5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Save Entry"}
            </button>
          </div>
        </form>
      )}

      {/* ── Work entries ── */}
      <div className="space-y-4">
        {entries.map((entry: any) => {
          const images: string[] = entry.image_urls ?? [];
          const lines = entry.content.split("\n").filter((l: string) => l.trim());

          return (
            <div
              key={entry.id}
              className="rounded-lg border border-border bg-card overflow-hidden"
            >
              {/* Entry header */}
              <div className="flex items-center justify-between bg-muted/50 px-4 py-2 border-b border-border">
                <div className="flex items-center gap-2">
                  {entry.staff && (
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium text-white"
                      style={{
                        backgroundColor: entry.staff.colour ?? "#3b82f6",
                      }}
                    >
                      {entry.staff.initials}
                    </span>
                  )}
                  <span className="text-sm font-medium">
                    {entry.staff?.display_name ?? "Unknown"}
                  </span>
                </div>
                <span className="text-xs font-medium text-muted-foreground">
                  {new Date(entry.work_date + "T00:00:00").toLocaleDateString(
                    "en-AU",
                    {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    }
                  )}
                </span>
              </div>

              {/* Entry content — rendered as bullet list */}
              <div className="px-4 py-3">
                <ul className="space-y-1">
                  {lines.map((line: string, i: number) => (
                    <li
                      key={i}
                      className="flex gap-2 text-sm"
                    >
                      <span className="text-muted-foreground mt-1.5 shrink-0">•</span>
                      <span>{line.replace(/^[-•*]\s*/, "")}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Photos */}
              {images.length > 0 && (
                <div className="px-4 pb-3 flex flex-wrap gap-2">
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
                        className="h-20 w-auto rounded-md border border-border object-cover hover:opacity-90 transition-opacity"
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {entries.length === 0 && !showForm && (
          <div className="rounded-lg border border-dashed border-border py-10 text-center">
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

function ZapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
