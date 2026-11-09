"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import type { SiteChecklistTemplate, SiteChecklistTicks } from "@/lib/site-checklists";

/**
 * One site checklist as a page you can work through on a phone at the bench:
 * big tap targets, who ticked what and when, notes at the bottom. The job's
 * Progress tab reads the same row ("Alarm panel tested").
 */
export function SiteChecklistView({
  siteId,
  siteName,
  template,
  initialTicks,
  initialNotes,
  completedAt,
  jobs,
  linkedJobId,
}: {
  siteId: string;
  siteName: string;
  template: SiteChecklistTemplate;
  initialTicks: SiteChecklistTicks;
  initialNotes: string | null;
  completedAt: string | null;
  jobs: Array<{ id: string; number: string; reference: string | null }>;
  linkedJobId: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [ticks, setTicks] = useState<SiteChecklistTicks>(initialTicks);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const done = template.items.filter((i) => ticks[i.key]).length;
  const pct = Math.round((done / template.items.length) * 100);

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/sites/${siteId}/checklists/${template.kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Couldn't save");
    return j as { ticks: SiteChecklistTicks; completed: boolean };
  }

  async function toggle(itemKey: string) {
    setBusy(itemKey);
    try {
      const j = await post({ itemKey, done: !ticks[itemKey], jobId: linkedJobId ?? jobs[0]?.id ?? null });
      setTicks(j.ticks);
      if (j.completed) toast("Checklist complete — the job's Progress tab will show Alarm panel tested", "success");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save", "error");
    } finally {
      setBusy(null);
    }
  }

  async function saveNotes() {
    setBusy("notes");
    try {
      await post({ notes });
      toast("Notes saved", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center gap-2 text-sm">
        <Link href={`/sites/${siteId}`} className="text-muted-foreground hover:text-foreground transition-colors">{siteName}</Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-muted-foreground">Documentation</span>
      </div>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">{template.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{template.blurb}</p>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs font-medium tabular-nums text-muted-foreground">{done}/{template.items.length} ticked</span>
        {completedAt && <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">Complete</span>}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all ${pct === 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>

      <ol className="mt-4 overflow-hidden rounded-lg border border-border">
        {template.items.map((item, i) => {
          const t = ticks[item.key];
          return (
            <li key={item.key} className={`border-b border-border last:border-0 ${t ? "bg-success/5" : "bg-card"}`}>
              <button
                type="button"
                onClick={() => toggle(item.key)}
                disabled={busy === item.key}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40 disabled:opacity-60"
              >
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${t ? "border-success bg-success text-white" : "border-muted-foreground/40"}`}>
                  {t && <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${t ? "text-muted-foreground line-through" : "font-medium"}`}>{i + 1}. {item.label}</span>
                  {t && <span className="mt-0.5 block text-[11px] font-semibold text-success">Ticked by {t.by}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-5">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything odd on the bench — zones that needed re-terminating, parts swapped, what the photos show…"
          className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">
            {linkedJobId
              ? <>Linked to job <Link href={`/jobs/${linkedJobId}`} className="underline-offset-2 hover:underline">{jobs.find((j) => j.id === linkedJobId)?.number ?? "—"}</Link>. Panel photos go on that job&apos;s notes.</>
              : jobs[0] ? <>Ticks will link to job {jobs[0].number}.</> : "No open job on this site."}
          </p>
          <button onClick={saveNotes} disabled={busy === "notes"} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50">
            {busy === "notes" ? "Saving…" : "Save notes"}
          </button>
        </div>
      </div>
    </div>
  );
}
