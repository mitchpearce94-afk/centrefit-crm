"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { DD_TEMPLATE_PLACEHOLDERS } from "@/lib/recurring/dd-migration-shared";

export function TemplateEditor({ initialSubject, initialBody }: { initialSubject: string; initialBody: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  const dirty = subject !== initialSubject || body !== initialBody;

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/dd-migration/template", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_subject: subject, email_body: body }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Save failed");
      toast("Template saved");
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      <div className="space-y-3">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Body</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={16}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono leading-relaxed"
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save template"}
          </button>
          {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
        </div>
      </div>
      <aside className="rounded-md border border-border bg-muted/30 p-3 text-xs">
        <p className="font-semibold text-foreground">Placeholders</p>
        <ul className="mt-2 space-y-1.5">
          {DD_TEMPLATE_PLACEHOLDERS.map((p) => (
            <li key={p.key}>
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{`{{${p.key}}}`}</code>
              <span className="ml-1.5 text-muted-foreground">{p.meaning}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-muted-foreground">
          &ldquo;Draft invitation email&rdquo; fills these in, opens the email in your mail client from accounts@, and logs the touch. Nothing is sent automatically.
        </p>
      </aside>
    </div>
  );
}
