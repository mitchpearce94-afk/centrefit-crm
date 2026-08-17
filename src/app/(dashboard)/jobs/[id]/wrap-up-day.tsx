"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { autoTransitionJobStatus } from "@/lib/job-status-transitions";
import { brisbaneDateISO } from "@/lib/dates";

/**
 * "Wrap up my day" (Mitchell 2026-08-18): one tap drafts today's Work
 * Completed entry from the day's exhaust — the tech's time entries, plan
 * checklist ticks (rough-in and fit-off) and photos added to Notes — so
 * writing the job up means checking a draft and adding a line, not composing
 * from a blank box at 4pm. The draft lands as a normal job_work_entries row,
 * editable in the Work Completed log below.
 */

export function WrapUpDay({
  jobId,
  workEntries,
  timeEntries,
  planItems,
  notes,
  viewerId,
}: {
  jobId: string;
  workEntries: any[];
  timeEntries: any[];
  planItems: any[];
  notes: any[];
  viewerId: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();

  const today = brisbaneDateISO(new Date());
  const dayStartMs = new Date(`${today}T00:00:00+10:00`).getTime();
  const alreadyToday = workEntries.some(
    (w) => w.work_date === today && (!viewerId || w.staff_id === viewerId),
  );

  function fmtTime(iso: string): string {
    return new Date(iso).toLocaleTimeString("en-AU", {
      timeZone: "Australia/Brisbane",
      hour: "numeric",
      minute: "2-digit",
    }).replace(/\s/g, "").toLowerCase();
  }

  function buildDraft(): string {
    const lines: string[] = [];

    // Time on site — the viewer's entries today, or anyone's if none.
    const todaysTime = timeEntries.filter((t) => new Date(t.start_time).getTime() >= dayStartMs);
    const mine = viewerId ? todaysTime.filter((t) => t.staff_id === viewerId) : [];
    const use = mine.length > 0 ? mine : todaysTime;
    for (const t of use) {
      lines.push(`On site ${fmtTime(t.start_time)}${t.end_time ? `–${fmtTime(t.end_time)}` : " (timer still running)"}`);
    }

    // Plan checklist ticks today.
    const roughedToday = planItems.filter(
      (i) => i.roughed_in_at && new Date(i.roughed_in_at).getTime() >= dayStartMs,
    );
    const fittedToday = planItems.filter(
      (i) => i.installed_at && new Date(i.installed_at).getTime() >= dayStartMs,
    );
    const tagOf = (label: string) => label.split(" · ")[0];
    const summarise = (items: any[]) => {
      const tags = items.map((i) => tagOf(i.label));
      return tags.length <= 12 ? tags.join(", ") : `${tags.slice(0, 12).join(", ")} +${tags.length - 12} more`;
    };
    if (roughedToday.length > 0) {
      lines.push(`Roughed in ${roughedToday.length} cable run${roughedToday.length === 1 ? "" : "s"}: ${summarise(roughedToday)}`);
    }
    if (fittedToday.length > 0) {
      lines.push(`Fitted off ${fittedToday.length} device${fittedToday.length === 1 ? "" : "s"}: ${summarise(fittedToday)}`);
    }

    // Photos dropped into Notes today.
    const photosToday = notes
      .filter((n) => n.created_at && new Date(n.created_at).getTime() >= dayStartMs)
      .reduce((s, n) => s + (Array.isArray(n.attachments) ? n.attachments.length : n.image_url ? 1 : 0), 0);
    if (photosToday > 0) {
      lines.push(`${photosToday} photo${photosToday === 1 ? "" : "s"} added to Notes`);
    }

    if (lines.length === 0) {
      lines.push("On site today.");
    }
    lines.push("");
    lines.push("Other notes: ");
    return lines.join("\n");
  }

  async function wrapUp() {
    setBusy(true);
    const { error } = await supabase.from("job_work_entries").insert({
      job_id: jobId,
      staff_id: viewerId,
      work_date: today,
      content: buildDraft(),
    });
    if (error) {
      toast(error.message, "error");
    } else {
      autoTransitionJobStatus(jobId, "work_started");
      toast("Today's entry drafted from your timers, plan ticks and photos — check it and add anything else.");
      router.refresh();
    }
    setBusy(false);
  }

  if (alreadyToday) return null;

  return (
    <button
      type="button"
      onClick={wrapUp}
      disabled={busy}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/50 bg-primary/10 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50 sm:w-auto"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
      {busy ? "Drafting…" : "Wrap up my day"}
    </button>
  );
}
