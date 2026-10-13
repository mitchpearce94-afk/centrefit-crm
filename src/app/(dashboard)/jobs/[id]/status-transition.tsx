"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import type { Status } from "@/lib/types";

const phaseLabels: Record<string, string> = {
  pre_work: "Pre-Work",
  quoting: "Quoting",
  in_progress: "In Progress",
  tracking_hold: "Tracking & Hold",
  completion: "Completion",
};

export function StatusTransition({
  jobId,
  currentStatus,
  allStatuses,
  hasWorkEntries = true,
}: {
  jobId: string;
  currentStatus: Status;
  allStatuses: Status[];
  hasWorkEntries?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Hard write-up gate (Mark 2026-10-14, replaces the Aug soft confirm): the
  // DB trigger jobs_writeup_gate refuses Ready to Invoice / Complete while
  // Work Completed is empty. Rather than bounce the tech, ask for the line
  // right here, save it as today's Work Completed entry, then move the job.
  const [gate, setGate] = useState<{ status: Status; text: string; reason: string } | null>(null);
  const GATED = ["Ready to Invoice", "Complete"];

  async function changeStatus(newStatusId: string, opts?: { writeup?: string; noChargeReason?: string }) {
    const target = allStatuses.find((s) => s.id === newStatusId);
    if (!target) return;
    if (!opts && !hasWorkEntries && GATED.includes(target.name)) {
      setGate({ status: target, text: "", reason: "" });
      return;
    }
    if (!opts && target.name === "No Charge") {
      setGate({ status: target, text: "", reason: "" });
      return;
    }
    setUpdating(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (opts?.writeup) {
      const { error: wErr } = await supabase.from("job_work_entries").insert({
        job_id: jobId,
        staff_id: user?.id ?? null,
        work_date: new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Brisbane" }),
        content: opts.writeup,
      });
      if (wErr) { toast(wErr.message, "error"); setUpdating(false); return; }
    }

    const patch: Record<string, unknown> = { status_id: newStatusId };
    if (target.name === "No Charge") patch.no_charge_reason = opts?.noChargeReason ?? null;
    const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);

    if (error) {
      const gated = /WRITEUP_REQUIRED/.test(error.message);
      if (gated && !opts?.writeup) {
        setGate({ status: target, text: "", reason: "" });
        setUpdating(false);
        return;
      }
      toast(gated ? "Work Completed is still empty — write the job up first." : error.message, "error");
    } else {
      const newStatus = target;
      await supabase.from("job_notes").insert({
        job_id: jobId,
        content: `Status changed from "${currentStatus.name}" to "${newStatus.name}"${
          newStatus.name === "No Charge" && opts?.noChargeReason ? ` — no charge: ${opts.noChargeReason}` : ""
        }`,
        type: "system",
      });

      if (newStatus.name === "Ready to Invoice") {
        try {
          const res = await fetch(`/api/jobs/${jobId}/auto-pp2`, { method: "POST" });
          const data = await res.json();
          if (data?.created?.length) {
            toast(`PP2 invoice generated: ${data.created[0].xeroInvoiceNumber ?? "draft"}`);
          } else if (data?.errors?.length) {
            toast(`PP2 auto-create failed: ${data.errors[0].message}`, "error");
          }
        } catch (err: unknown) {
          toast(err instanceof Error ? err.message : "PP2 auto-create failed", "error");
        }
      }

      router.refresh();
    }
    setGate(null);
    setUpdating(false);
    setOpen(false);
  }

  // Group statuses by phase
  const byPhase: Record<string, Status[]> = {};
  for (const s of allStatuses) {
    if (!byPhase[s.phase]) byPhase[s.phase] = [];
    byPhase[s.phase].push(s);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={updating}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors hover:opacity-80"
        style={{
          backgroundColor: `${currentStatus.colour}20`,
          color: currentStatus.colour,
        }}
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: currentStatus.colour }}
        />
        {updating ? "Updating..." : currentStatus.name}
        <svg
          className="h-3 w-3 opacity-60"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <>
          {/* Mobile: bottom sheet with backdrop. Phones don't have screen real
              estate for a popover anchored to a small status pill, and the
              left-0 anchoring would clip on the right edge. Bottom sheet is
              the iOS/Android-native pattern. */}
          <div className="sm:hidden fixed inset-0 z-50 flex items-end" onClick={() => setOpen(false)}>
            <div className="absolute inset-0 bg-black/60" />
            <div className="relative w-full rounded-t-2xl border-t border-border bg-card shadow-2xl max-h-[80dvh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold">Change status</h3>
                <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground p-2 -m-2">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="overflow-y-auto">
                {Object.entries(byPhase).map(([phase, statuses]) => (
                  <div key={phase}>
                    <div className="sticky top-0 bg-muted px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      {phaseLabels[phase] ?? phase}
                    </div>
                    {statuses.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => changeStatus(s.id)}
                        disabled={s.id === currentStatus.id}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-sm transition-colors border-b border-border last:border-0 ${
                          s.id === currentStatus.id
                            ? "bg-primary/5 text-primary font-medium"
                            : "text-foreground active:bg-accent"
                        }`}
                      >
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: s.colour }} />
                        <span className="flex-1 text-left">{s.name}</span>
                        {s.id === currentStatus.id && (
                          <span className="text-xs text-primary">Current</span>
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Desktop: popover anchored to the trigger. */}
          <div className="hidden sm:block absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-card shadow-xl overflow-hidden">
            <div className="max-h-80 overflow-y-auto">
              {Object.entries(byPhase).map(([phase, statuses]) => (
                <div key={phase}>
                  <div className="sticky top-0 bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {phaseLabels[phase] ?? phase}
                  </div>
                  {statuses.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => changeStatus(s.id)}
                      disabled={s.id === currentStatus.id}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors ${
                        s.id === currentStatus.id
                          ? "bg-primary/5 text-primary font-medium"
                          : "text-foreground hover:bg-accent"
                      }`}
                    >
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: s.colour }}
                      />
                      {s.name}
                      {s.id === currentStatus.id && (
                        <span className="ml-auto text-xs text-primary">
                          Current
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {gate && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center sm:justify-center" onClick={() => setGate(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-border bg-card p-5 shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            {gate.status.name === "No Charge" ? (
              <>
                <h3 className="text-base font-semibold">No charge — why?</h3>
                <p className="text-sm text-muted-foreground">
                  One line so it never looks like a missed invoice. It goes on the job and in the notes.
                </p>
                <textarea
                  autoFocus
                  value={gate.reason}
                  onChange={(e) => setGate({ ...gate, reason: e.target.value })}
                  rows={2}
                  placeholder="e.g. Warranty call-back, Mark said no charge"
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold">Write the job up first</h3>
                <p className="text-sm text-muted-foreground">
                  Nothing is in Work Completed. A job can&apos;t go to <strong>{gate.status.name}</strong> blank — one line is enough
                  (&quot;Patrol run, all secure&quot; counts).
                </p>
                <textarea
                  autoFocus
                  value={gate.text}
                  onChange={(e) => setGate({ ...gate, text: e.target.value })}
                  rows={4}
                  placeholder="What was done on site…"
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setGate(null)}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={updating || (gate.status.name === "No Charge" ? gate.reason.trim().length < 3 : gate.text.trim().length < 3)}
                onClick={() =>
                  gate.status.name === "No Charge"
                    ? changeStatus(gate.status.id, { noChargeReason: gate.reason.trim() })
                    : changeStatus(gate.status.id, { writeup: gate.text.trim() })
                }
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {updating ? "Saving…" : gate.status.name === "No Charge" ? "Close as no charge" : `Save & move to ${gate.status.name}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
