"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { compressImage, mapWithConcurrency } from "@/lib/images/compress";
import { useKeyboardOpen } from "@/lib/hooks/use-keyboard-open";
import { autoTransitionJobStatus } from "@/lib/job-status-transitions";
import { QuickActions } from "./quick-actions";
import { JobChecklist } from "./job-checklist";
import { WorkLog } from "./work-log";
import { ActivityLog } from "./activity-log";
import { NotesPanel } from "./notes-panel";
import { TimePanel } from "./time-panel";
import { StaffPanel } from "./staff-panel";
import { NbnPanel } from "./nbn-panel";
import { JobInvoices } from "./job-invoices";
import { JobProcurement } from "./job-procurement";
import { ScopeEditor } from "./scope-editor";

interface StaffOption {
  id: string;
  display_name: string;
  initials: string;
  colour: string;
}

export function JobTabs({
  jobId,
  job,
  allStatuses,
  allStaff,
  notes,
  timeEntries,
  nbnSteps,
  workEntries,
  checklistItems,
  templates,
  isNbnJob,
  hasOpenTimer,
  openTimerId,
  scheduleEntries,
  invoices,
  linkedQuotes,
  procurementItems,
  suppliers,
  productPrices,
  billingSettings,
  isAdmin,
}: {
  jobId: string;
  job: any;
  allStatuses: any[];
  allStaff: StaffOption[];
  notes: any[];
  timeEntries: any[];
  nbnSteps: any[];
  workEntries: any[];
  checklistItems: any[];
  templates: any[];
  isNbnJob: boolean;
  hasOpenTimer: boolean;
  openTimerId?: string;
  scheduleEntries?: any[];
  invoices: any[];
  linkedQuotes: any[];
  procurementItems: any[];
  suppliers: any[];
  productPrices: Record<string, { sell_price: number; cost_price: number }>;
  billingSettings: { labour_sell_rate: number; callout_fee_sell: number };
  isAdmin: boolean;
}) {
  const [activeTab, setActiveTab] = useState("job");
  const [notesOpenSignal, setNotesOpenSignal] = useState(0);
  const [workOpenSignal, setWorkOpenSignal] = useState(0);
  const showNbn = isNbnJob || nbnSteps.length > 0;

  // Filter non-system notes for count
  const userNotes = notes.filter((n: any) => n.type !== "system");

  const tabs = [
    { id: "job", label: "Job" },
    { id: "notes", label: "Notes", count: userNotes.length },
    { id: "time", label: "Time", count: timeEntries.length },
    { id: "staff", label: "Staff", count: job.job_staff?.length ?? 0 },
    ...(showNbn ? [{ id: "nbn", label: "NBN Steps", count: nbnSteps.length }] : []),
    { id: "quoting", label: "Quoting", count: linkedQuotes.length },
    { id: "procurement", label: "Procurement", count: procurementItems.length },
    { id: "invoicing", label: "Invoicing", count: invoices.length },
  ];

  return (
    <div>
      {/* Tab strip — pill buttons, horizontal scroll. Trailing pr-12
          keeps the last tab from butting against the screen edge, and
          the wider w-16 fade fully masks any peek-through. */}
      <div className="relative min-w-0">
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1 pr-12 py-1">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0 text-[10px] font-semibold ${
                      active
                        ? "bg-white/20 text-primary-foreground"
                        : "bg-muted-foreground/15 text-muted-foreground"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/* Right-edge fade — wider so the next pill doesn't peek past it. */}
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-16"
          style={{
            background: "linear-gradient(to left, var(--background) 40%, transparent)",
          }}
        />
      </div>

      {/* Tab content */}
      <div className="pt-5">
        {activeTab === "job" && (
          <JobOverview
            jobId={jobId}
            job={job}
            allStatuses={allStatuses}
            hasOpenTimer={hasOpenTimer}
            openTimerId={openTimerId}
            checklistItems={checklistItems}
            templates={templates}
            workEntries={workEntries}
            notes={notes}
            timeEntries={timeEntries}
            scheduleEntries={scheduleEntries ?? []}
            workOpenSignal={workOpenSignal}
          />
        )}
        {activeTab === "notes" && (
          <NotesPanel jobId={jobId} notes={userNotes} openSignal={notesOpenSignal} />
        )}
        {activeTab === "time" && (
          <TimePanel jobId={jobId} timeEntries={timeEntries} />
        )}
        {activeTab === "staff" && (
          <StaffPanel
            jobId={jobId}
            assignedStaff={job.job_staff ?? []}
            allStaff={allStaff}
          />
        )}
        {activeTab === "nbn" && (
          <NbnPanel jobId={jobId} steps={nbnSteps} isNbnJob={isNbnJob} />
        )}
        {activeTab === "quoting" && (
          <QuotingPanel jobId={jobId} linkedQuotes={linkedQuotes} />
        )}
        {activeTab === "procurement" && (
          <div>
            <div className="mb-2 flex justify-end">
              <Link
                href={`/procurement/${jobId}`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Open in Procurement →
              </Link>
            </div>
            <JobProcurement jobId={jobId} items={procurementItems} suppliers={suppliers} />
          </div>
        )}
        {activeTab === "invoicing" && (
          <JobInvoices
            jobId={jobId}
            customerId={job.customer_id ?? null}
            jobDescription={job.description ?? null}
            jobNumber={job.number ?? null}
            invoices={invoices}
            linkedQuotes={linkedQuotes}
            checklistItems={checklistItems}
            workEntries={workEntries}
            productPrices={productPrices}
            billingSettings={billingSettings}
            isAdmin={isAdmin}
          />
        )}
      </div>

      {/* Mobile thumb-reach action bar. Hidden on lg+ where the in-tab
          buttons are already easy to reach. Wraps the whole page in a
          pb-24 spacer (via JobTabs root) so content doesn't sit behind it. */}
      <MobileActionBar
        jobId={jobId}
        hasOpenTimer={hasOpenTimer}
        openTimerId={openTimerId}
        onOpenNote={() => {
          setNotesOpenSignal((n) => n + 1);
          setActiveTab("notes");
        }}
        onOpenWork={() => {
          setWorkOpenSignal((n) => n + 1);
          setActiveTab("job");
        }}
      />
    </div>
  );
}

/* ── Mobile bottom action bar ──
   Thumb-reach buttons: + Photo · + Note · + Work · Timer. Photo path
   compresses client-side, uploads, and creates a `job_notes` row with
   the attachment — no description required. */
function MobileActionBar({
  jobId,
  hasOpenTimer,
  openTimerId,
  onOpenNote,
  onOpenWork,
}: {
  jobId: string;
  hasOpenTimer: boolean;
  openTimerId?: string;
  onOpenNote: () => void;
  onOpenWork: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"clock" | "photo" | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const keyboardOpen = useKeyboardOpen();

  async function toggleClock() {
    setBusy("clock");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setBusy(null); return; }
    if (hasOpenTimer && openTimerId) {
      await supabase
        .from("job_time")
        .update({ end_time: new Date().toISOString() })
        .eq("id", openTimerId);
    } else {
      await supabase.from("job_time").insert({
        job_id: jobId,
        staff_id: user.id,
        start_time: new Date().toISOString(),
        billable: true,
      });
      await autoTransitionJobStatus(jobId, "work_started", supabase);
    }
    router.refresh();
    setBusy(null);
  }

  async function handlePhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setBusy("photo");
    setProgress({ done: 0, total: files.length });

    const { data: { user } } = await supabase.auth.getUser();
    let done = 0;
    const uploaded = await mapWithConcurrency(files, 4, async (file) => {
      const prepped = await compressImage(file);
      const ext = prepped.name.split(".").pop();
      const path = `${jobId}/notes/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { data, error } = await supabase.storage
        .from("job-attachments")
        .upload(path, prepped);
      done++;
      setProgress({ done, total: files.length });
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
    const attachments = uploaded.filter((a): a is NonNullable<typeof a> => !!a);

    if (attachments.length > 0) {
      const { error } = await supabase.from("job_notes").insert({
        job_id: jobId,
        staff_id: user?.id ?? null,
        title: `${attachments.length} photo${attachments.length === 1 ? "" : "s"}`,
        content: "",
        type: "note",
        attachments,
        image_url: attachments[0].url,
      });
      if (error) {
        toast(error.message, "error");
      } else {
        toast(`${attachments.length} photo${attachments.length === 1 ? "" : "s"} added`, "success");
        router.refresh();
      }
    } else {
      toast("Upload failed", "error");
    }

    setProgress(null);
    setBusy(null);
  }

  const itemClass =
    "flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors disabled:opacity-50";

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        onChange={handlePhotos}
        className="hidden"
      />
      {/* Spacer so the last content isn't hidden under the action bar +
          the global MobileNav. Both are ~64px tall stacked = ~128px. */}
      <div className="lg:hidden h-36" aria-hidden />
      <div
        className={`lg:hidden fixed inset-x-0 z-50 border-t border-border bg-background/95 backdrop-blur transition-transform duration-150 ${
          keyboardOpen ? "translate-y-full pointer-events-none" : ""
        }`}
        style={{
          // Sit directly above the global MobileNav (which is 64px tall +
          // safe-area-inset-bottom). z-50 puts us above the nav (z-40) so
          // the upload-progress strip is visible.
          bottom: "calc(env(safe-area-inset-bottom) + 64px)",
        }}
      >
        {progress && (
          <div className="px-3 py-1.5 text-[11px] text-muted-foreground bg-primary/5 border-b border-border">
            Uploading {progress.done}/{progress.total}…
          </div>
        )}
        <div className="flex">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy === "photo"}
            className={`${itemClass} text-foreground active:bg-accent`}
          >
            <CameraIcon className="h-5 w-5" />
            <span>Photo</span>
          </button>
          <button
            type="button"
            onClick={onOpenNote}
            className={`${itemClass} text-foreground active:bg-accent`}
          >
            <NoteIcon className="h-5 w-5" />
            <span>Note</span>
          </button>
          <button
            type="button"
            onClick={onOpenWork}
            className={`${itemClass} text-foreground active:bg-accent`}
          >
            <WrenchIcon className="h-5 w-5" />
            <span>Work</span>
          </button>
          <button
            type="button"
            onClick={toggleClock}
            disabled={busy === "clock"}
            className={`${itemClass} active:bg-accent ${hasOpenTimer ? "text-destructive" : "text-success"}`}
          >
            {hasOpenTimer ? (
              <span className="h-5 w-5 flex items-center justify-center">
                <span className="h-2.5 w-2.5 rounded-full bg-destructive animate-pulse" />
              </span>
            ) : (
              <ClockBarIcon className="h-5 w-5" />
            )}
            <span>{hasOpenTimer ? "Stop" : "Start"}</span>
          </button>
        </div>
      </div>
    </>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function NoteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  );
}

function WrenchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function ClockBarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

/* ── Quoting Tab ── */
function QuotingPanel({
  jobId,
  linkedQuotes,
}: {
  jobId: string;
  linkedQuotes: Array<{ id: string; ref: string; status: string; total?: number | null }>;
}) {
  if (linkedQuotes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
        <p className="text-sm text-muted-foreground mb-3">No quotes linked to this job yet.</p>
        <Link
          href={`/quoting/new?jobId=${jobId}`}
          className="inline-flex rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + New quote for this job
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {linkedQuotes.map((q) => (
        <Link
          key={q.id}
          href={`/quoting/${q.id}`}
          className="block rounded-lg border border-border bg-card p-4 hover:border-primary transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground font-mono">{q.ref}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 capitalize">{q.status}</p>
            </div>
            <span className="text-xs text-muted-foreground">Open →</span>
          </div>
        </Link>
      ))}
      <Link
        href={`/quoting/new?jobId=${jobId}`}
        className="inline-flex rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mt-3"
      >
        + Add another quote
      </Link>
    </div>
  );
}

/* ── Job Overview Tab ── */
function JobOverview({
  jobId,
  job,
  allStatuses,
  hasOpenTimer,
  openTimerId,
  checklistItems,
  templates,
  workEntries,
  notes,
  timeEntries,
  scheduleEntries,
  workOpenSignal,
}: {
  jobId: string;
  job: any;
  allStatuses: any[];
  hasOpenTimer: boolean;
  openTimerId?: string;
  checklistItems: any[];
  templates: any[];
  workEntries: any[];
  notes: any[];
  timeEntries: any[];
  scheduleEntries: any[];
  workOpenSignal?: number;
}) {
  return (
    <div className="space-y-6">
      {/* ── Metadata — just site name + address. Everything else
          (customer link, categories, staff avatars) is one tap away in
          the dedicated tabs; this row exists to orient the tech. ── */}
      <div className="text-sm">
        {job.site ? (
          <Link
            href={`/sites/${job.site.id}`}
            className="font-medium text-foreground hover:text-primary transition-colors"
          >
            {job.site.name}
          </Link>
        ) : (
          <Link
            href={`/customers/${job.customer?.id}`}
            className="font-medium text-foreground hover:text-primary transition-colors"
          >
            {job.customer?.name}
          </Link>
        )}
        {job.site?.address && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {[job.site.address, job.site.suburb, job.site.state, job.site.postcode].filter(Boolean).join(", ")}
          </p>
        )}
      </div>

      {/* ── Quick Actions ── */}
      <QuickActions
        jobId={jobId}
        hasOpenTimer={hasOpenTimer}
        openTimerId={openTimerId}
        allStatuses={allStatuses}
        currentStatusName={(job.status as any)?.name}
        siteAddress={job.site ? [job.site.address, job.site.suburb, job.site.state, job.site.postcode].filter(Boolean).join(", ") : null}
      />

      {/* Order optimised for the on-site tech: scope → checklist → work log
          come first, then schedule + activity for context. */}

      {/* ── Scope / Description (editable) ── */}
      <ScopeEditor
        jobId={jobId}
        description={job.description ?? null}
        reference={job.reference ?? null}
      />

      {/* ── Checklist (scrollable) ── */}
      <JobChecklist
        jobId={jobId}
        items={checklistItems}
        templates={templates}
      />

      {/* ── Work Completed ── */}
      <WorkLog jobId={jobId} entries={workEntries} openSignal={workOpenSignal} />

      {/* ── Scheduled Dates ── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
          Scheduled
        </h2>
        <div className="flex flex-wrap gap-2">
          {scheduleEntries.length > 0 ? scheduleEntries.map((se: any) => {
            const schedDate = new Date(se.schedule_date + "T00:00:00");
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const isPast = schedDate < today;
            const isToday = schedDate.getTime() === today.getTime();
            return (
              <div
                key={se.id}
                className={`flex items-center gap-2 rounded-md border px-3 py-1.5 ${isToday ? "border-primary bg-primary/5" : isPast ? "border-border opacity-50" : "border-border bg-card"}`}
              >
                {se.staff && (
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-medium text-white"
                    style={{ backgroundColor: se.staff.colour ?? "#3b82f6" }}
                  >
                    {se.staff.initials}
                  </span>
                )}
                <span className="text-sm font-medium">
                  {isToday ? "Today" : schedDate.toLocaleDateString("en-AU", {
                    weekday: "short", day: "numeric", month: "short",
                  })}
                </span>
                {se.start_time && se.end_time && (
                  <span className="text-xs text-muted-foreground">
                    {se.start_time.slice(0, 5)} - {se.end_time.slice(0, 5)}
                  </span>
                )}
              </div>
            );
          }) : (
            <span className="text-sm text-muted-foreground">Not scheduled</span>
          )}
          <Link
            href="/scheduler"
            className="flex items-center rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-primary hover:border-primary transition-colors"
          >
            {scheduleEntries.length > 0 ? "Open Scheduler" : "Schedule this job"}
          </Link>
        </div>
      </div>

      {/* ── Activity Log ── */}
      <ActivityLog
        notes={notes}
        timeEntries={timeEntries}
        workEntries={workEntries}
        checklistItems={checklistItems}
      />
    </div>
  );
}
