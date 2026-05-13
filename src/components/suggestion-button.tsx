"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";

type Category = "Feature" | "Bug" | "UI/UX" | "Other";
const CATEGORIES: Category[] = ["Feature", "Bug", "UI/UX", "Other"];

export function SuggestionButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Send a suggestion"
        title="Send a suggestion"
        className={
          className ??
          "flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors"
        }
      >
        <BulbIcon className="h-4 w-4" />
      </button>
      {open && <SuggestionModal onClose={() => setOpen(false)} />}
    </>
  );
}

function SuggestionModal({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState<Category>("Feature");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (body.trim().length < 3) {
      toast("Add a little more detail", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim(), category }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Send failed" }));
        toast(data.error ?? "Send failed", "error");
        setSubmitting(false);
        return;
      }
      toast("Suggestion sent — thanks!", "success");
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Send failed", "error");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md rounded-t-2xl lg:rounded-2xl border border-border bg-card shadow-2xl max-h-[90dvh] overflow-y-auto"
      >
        <div className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Send a suggestion</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Goes straight to Mitchell. Bug, feature, polish — whatever you&apos;ve got.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Category
            </label>
            <div className="flex gap-1 rounded-md border border-border p-0.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                    category === c
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              What&apos;s on your mind?
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              autoFocus
              placeholder="Describe the suggestion, the pain point it would fix, or where it would live..."
              className="block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-y"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {body.length}/5000
            </p>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || body.trim().length < 3}
              className="w-full sm:w-auto rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {submitting ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function BulbIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2z" />
    </svg>
  );
}
