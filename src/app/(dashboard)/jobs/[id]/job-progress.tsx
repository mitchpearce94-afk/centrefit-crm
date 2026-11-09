"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { GROUP_ORDER, type JobProgress, type ProgressStep } from "@/lib/jobs/progress";

/**
 * Go-to-whoa checklist for a job (docs/job-lifecycle-CONTEXT.md D5–D7).
 * Every step shows its state, the evidence (or what's missing), who ticked
 * it, and a link to where it gets done. Auto steps come from the data;
 * anyone can tick a step by hand or mark it N/A.
 */

export function JobProgressPanel({
  jobId,
  progress,
  onOpenTab,
  staffNames = [],
}: {
  jobId: string;
  progress: JobProgress;
  onOpenTab: (tabId: string) => void;
  /** Staff display names for the responsible-person picker. */
  staffNames?: string[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<{ key: string; state: "done" | "na" } | null>(null);
  const [note, setNote] = useState("");
  const [ownerFor, setOwnerFor] = useState<string | null>(null);

  async function setOwner(key: string, owner: string, scope: "job" | "default") {
    setBusy(key);
    try {
      const res = await fetch(`/api/jobs/${jobId}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "owner", stepKey: key, owner, scope }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Couldn't change the owner");
      setOwnerFor(null);
      toast(owner ? (scope === "default" ? `${owner} now owns this step on every job` : `${owner} owns this step on this job`) : "Owner reset", "success");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't change the owner", "error");
    } finally {
      setBusy(null);
    }
  }

  async function mark(key: string, state: "done" | "na" | "clear", noteText?: string) {
    setBusy(key);
    try {
      const res = await fetch(`/api/jobs/${jobId}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepKey: key, state, note: noteText }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Couldn't update the step");
      setNoteFor(null);
      setNote("");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't update the step", "error");
    } finally {
      setBusy(null);
    }
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const groups = GROUP_ORDER.map((g) => ({ group: g, steps: progress.steps.filter((s) => s.group === g) })).filter((g) => g.steps.length > 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Job progress — {progress.set === "fitout" ? "fitout" : "service job"}
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            In the order a job runs. Steps marked ● are read straight from the CRM (documents, quotes, invoices, plans); tick the rest by hand, or mark anything N/A. Click a name to change who&apos;s responsible.
          </p>
        </div>
        <span className="text-xs font-medium text-muted-foreground shrink-0 tabular-nums">
          {progress.done}/{progress.total} done
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-4">
        <div className={`h-full rounded-full transition-all duration-300 ${pct === 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="space-y-4">
        {groups.map(({ group, steps }) => {
          const gDone = steps.filter((s) => s.state === "done").length;
          const gTotal = steps.filter((s) => s.state !== "na").length;
          return (
            <section key={group} className="rounded-lg border border-border overflow-hidden">
              <header className="flex items-center justify-between bg-muted/40 px-4 py-2">
                <h3 className="text-sm font-semibold">{group}</h3>
                <span className="text-[11px] text-muted-foreground tabular-nums">{gDone}/{gTotal}</span>
              </header>
              <div>
                {steps.map((s) => (
                  <StepRow
                    key={s.key}
                    step={s}
                    busy={busy === s.key}
                    onOpenTab={onOpenTab}
                    onTick={() => (s.source === "auto" ? setNoteFor({ key: s.key, state: "done" }) : mark(s.key, "done"))}
                    onNa={() => setNoteFor({ key: s.key, state: "na" })}
                    onUndo={() => mark(s.key, "clear")}
                    noteOpen={noteFor?.key === s.key ? noteFor.state : null}
                    note={note}
                    setNote={setNote}
                    onNoteSave={() => noteFor && mark(noteFor.key, noteFor.state, note)}
                    onNoteCancel={() => { setNoteFor(null); setNote(""); }}
                    ownerOpen={ownerFor === s.key}
                    onOwnerOpen={() => setOwnerFor(ownerFor === s.key ? null : s.key)}
                    onOwnerSave={(owner, scope) => setOwner(s.key, owner, scope)}
                    staffNames={staffNames}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function StepRow({
  step, busy, onOpenTab, onTick, onNa, onUndo, noteOpen, note, setNote, onNoteSave, onNoteCancel, ownerOpen, onOwnerOpen, onOwnerSave, staffNames,
}: {
  step: ProgressStep;
  busy: boolean;
  onOpenTab: (tabId: string) => void;
  onTick: () => void;
  onNa: () => void;
  onUndo: () => void;
  noteOpen: "done" | "na" | null;
  note: string;
  setNote: (v: string) => void;
  onNoteSave: () => void;
  onNoteCancel: () => void;
  ownerOpen: boolean;
  onOwnerOpen: () => void;
  onOwnerSave: (owner: string, scope: "job" | "default") => void;
  staffNames: string[];
}) {
  const isTab = step.href?.startsWith("tab:");
  const openLabel = isTab ? `${tabLabel(step.href!.slice(4))} tab` : step.key === "alarm_tested" ? "Open checklist" : "Open";
  return (
    <div className={`border-b border-border last:border-0 px-4 py-2.5 ${step.state === "done" ? "bg-success/5" : step.state === "partial" ? "bg-amber-500/5" : step.state === "na" ? "opacity-60" : "bg-card"}`}>
      <div className="flex gap-3">
        <StateIcon state={step.state} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <p className={`text-sm font-medium ${step.state === "done" ? "text-muted-foreground" : step.state === "na" ? "line-through text-muted-foreground" : ""}`}>
              {step.label}
            </p>
            <span className="text-[10px] text-muted-foreground" title={step.source === "auto" ? "Read from the CRM data" : "Ticked by a person"}>
              {step.source === "auto" ? "●" : "○"}
            </span>
            {step.state === "partial" && <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-500">Partial</span>}
            {step.by && <span className="text-[11px] font-semibold text-success">{step.state === "na" ? "N/A by" : "Ticked by"} {step.by}</span>}
            <button
              type="button"
              onClick={onOwnerOpen}
              title={step.ownerSource === "job" ? "Set for this job — click to change" : step.ownerSource === "global" ? "Default for every job — click to change" : "Usual owner — click to change"}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${step.ownerSource === "job" ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-muted/40 text-muted-foreground hover:text-foreground hover:border-primary/40"}`}
            >
              {step.owner ?? "Who?"}{step.ownerSource === "job" ? " · this job" : ""}
            </button>
          </div>
          {ownerOpen && <OwnerEditor current={step.owner} staffNames={staffNames} busy={busy} onSave={onOwnerSave} onCancel={onOwnerOpen} />}
          <p className="text-xs text-muted-foreground mt-0.5">
            {step.detail ?? (step.state === "pending" ? step.hint : "")}
          </p>
          {noteOpen && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                autoFocus
                placeholder={noteOpen === "na" ? "Why isn't this needed? (optional)" : "Note (optional)"}
                className="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                onKeyDown={(e) => { if (e.key === "Enter") onNoteSave(); if (e.key === "Escape") onNoteCancel(); }}
              />
              <button onClick={onNoteSave} disabled={busy} className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {noteOpen === "na" ? "Mark N/A" : "Tick"}
              </button>
              <button onClick={onNoteCancel} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 self-start">
          {step.href && (
            isTab ? (
              <button onClick={() => onOpenTab(step.href!.slice(4))} className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                {openLabel}
              </button>
            ) : (
              <Link href={step.href} className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                {openLabel}
              </Link>
            )
          )}
          {step.manual ? (
            <button onClick={onUndo} disabled={busy} className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors">
              Undo
            </button>
          ) : (step.state === "pending" || step.state === "partial") && !noteOpen ? (
            <>
              <button onClick={onTick} disabled={busy} className="rounded-md border border-success/40 px-2 py-1 text-[11px] text-success hover:bg-success/10 disabled:opacity-50 transition-colors">
                Tick
              </button>
              <button onClick={onNa} disabled={busy} className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors">
                N/A
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Pick who's responsible: a staff name or anything typed; for this job or as the new default. */
function OwnerEditor({ current, staffNames, busy, onSave, onCancel }: { current: string | null; staffNames: string[]; busy: boolean; onSave: (owner: string, scope: "job" | "default") => void; onCancel: () => void }) {
  const [value, setValue] = useState(current ?? "");
  const [scope, setScope] = useState<"job" | "default">("job");
  const options = Array.from(new Set([...(current ? [current] : []), ...staffNames, "Mark", "Sue", "Mitch", "Fit-off tech", "CRM"]));
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
      <input
        list="progress-owner-names"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        placeholder="Who does this step?"
        className="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        onKeyDown={(e) => { if (e.key === "Enter") onSave(value.trim(), scope); if (e.key === "Escape") onCancel(); }}
      />
      <datalist id="progress-owner-names">{options.map((n) => <option key={n} value={n} />)}</datalist>
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground"><input type="radio" checked={scope === "job"} onChange={() => setScope("job")} /> this job</label>
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground"><input type="radio" checked={scope === "default"} onChange={() => setScope("default")} /> every job from now on</label>
      <button onClick={() => onSave(value.trim(), scope)} disabled={busy} className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">Save</button>
      {current && <button onClick={() => onSave("", scope)} disabled={busy} className="text-xs text-muted-foreground hover:text-foreground">Reset</button>}
      <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
    </div>
  );
}

function tabLabel(id: string): string {
  return { job: "Job", quoting: "Quoting", procurement: "Procurement", invoicing: "Invoicing", nbn: "NBN Steps", plan: "Plan" }[id] ?? id;
}

function StateIcon({ state }: { state: ProgressStep["state"] }) {
  if (state === "done") {
    return (
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success text-white">
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      </span>
    );
  }
  if (state === "na") {
    return <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/40 text-[10px] text-muted-foreground">–</span>;
  }
  if (state === "partial") {
    return (
      <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-amber-500" style={{ background: "linear-gradient(90deg, rgb(245 158 11) 50%, transparent 50%)" }} title="Partial" />
    );
  }
  return <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-muted-foreground/40" />;
}

/** One-line strip for the Job tab: done/total + the next thing to do. */
export function JobProgressStrip({ progress, onOpen }: { progress: JobProgress; onOpen: () => void }) {
  if (progress.total === 0) return null;
  const pct = Math.round((progress.done / progress.total) * 100);
  return (
    <button
      onClick={onOpen}
      className="mb-4 w-full rounded-lg border border-border bg-card px-4 py-3 text-left hover:border-primary/50 transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Progress</span>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">{progress.done}/{progress.total} done</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${pct === 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground truncate">
        {progress.next ? <>Next: <span className="text-foreground font-medium">{progress.next.label}</span>{progress.next.detail ? ` — ${progress.next.detail}` : ""}</> : "Everything on the list is done."}
      </p>
    </button>
  );
}
