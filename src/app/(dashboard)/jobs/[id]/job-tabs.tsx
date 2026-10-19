"use client";

import { useState } from "react";
import Link from "next/link";
import { QuickActions } from "./quick-actions";
import { JobChecklist } from "./job-checklist";
import { WorkLog } from "./work-log";
import { ActivityLog } from "./activity-log";
import { NotesPanel } from "./notes-panel";
import { TimePanel } from "./time-panel";
import { StaffPanel } from "./staff-panel";
import { NbnPanel } from "./nbn-panel";
import { JobInvoices } from "./job-invoices";
import { ImportBomToAssetsButton } from "./import-bom-to-assets-button";
import { JobProcurement } from "./job-procurement";
import { ScopeEditor } from "./scope-editor";
import { UpdatesPanel } from "./updates-panel";
import { PlanChecklist } from "./plan-checklist";
import { WrapUpDay } from "./wrap-up-day";
import { KeyInfoPanel, type KeyInfoPhoto, type IfobUser } from "@/app/(dashboard)/sites/[id]/key-info-panel";
import type { AssetType, SiteAsset } from "@/lib/types";

/** The site's Key Information, fetched by the job page for the Key Info tab. */
export interface JobKeyInfo {
  assets: SiteAsset[];
  assetTypes: AssetType[];
  photos: KeyInfoPhoto[];
  notes: string | null;
  ifobUsers: IfobUser[];
}

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
  jobUpdates,
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
  receipts,
  stockItems = [],
  planFiles = [],
  planItems = [],
  keyInfo = null,
  isAdmin,
  viewerId,
  viewerInitials,
}: {
  jobId: string;
  job: any;
  allStatuses: any[];
  allStaff: StaffOption[];
  notes: any[];
  jobUpdates: any[];
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
  billingSettings: { labour_sell_rate: number; callout_fee_sell: number; it_service_labour_rate: number };
  receipts: { id: string; vendor: string | null; amount: number }[];
  /** Stock allocated from Inventory, not yet invoiced. */
  stockItems?: { id: string; name: string; sku: string | null; quantity: number; unitSell: number }[];
  planFiles?: any[];
  planItems?: any[];
  keyInfo?: JobKeyInfo | null;
  isAdmin: boolean;
  viewerId: string | null;
  viewerInitials: string;
}) {
  const [activeTab, setActiveTab] = useState("job");
  const showNbn = isNbnJob || nbnSteps.length > 0;

  // Filter non-system notes for count
  const userNotes = notes.filter((n: any) => n.type !== "system");

  const tabs = [
    { id: "job", label: "Job" },
    { id: "notes", label: "Notes", count: userNotes.length },
    { id: "time", label: "Time", count: timeEntries.length },
    { id: "staff", label: "Staff", count: job.job_staff?.length ?? 0 },
    // Site Key Information on the job (Michael, 2026-07-30) — NVR/router
    // creds, Wi-Fi, iFob users, photos — without leaving the job.
    ...(keyInfo && job.site ? [{ id: "keyinfo", label: "Key Info" }] : []),
    ...(planFiles.length > 0
      ? [{ id: "plan", label: "Plan", count: planItems.filter((i: any) => !i.orphaned && i.status !== "installed").length }]
      : []),
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
            jobUpdates={jobUpdates}
            timeEntries={timeEntries}
            scheduleEntries={scheduleEntries ?? []}
            planItems={planItems}
            procurementItems={procurementItems}
            viewerId={viewerId}
            viewerInitials={viewerInitials}
          />
        )}
        {activeTab === "notes" && (
          <NotesPanel jobId={jobId} notes={userNotes} />
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
        {activeTab === "keyinfo" && keyInfo && job.site && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Key Information for <span className="text-foreground font-medium">{job.site.name}</span> — edits here save to the site.
              </p>
              <Link href={`/sites/${job.site.id}`} className="text-xs text-muted-foreground hover:text-foreground shrink-0">
                Open site →
              </Link>
            </div>
            <KeyInfoPanel
              siteId={job.site.id}
              assets={keyInfo.assets}
              assetTypes={keyInfo.assetTypes}
              photos={keyInfo.photos}
              notes={keyInfo.notes}
              ifobUsers={keyInfo.ifobUsers}
            />
          </div>
        )}
        {activeTab === "plan" && (
          <PlanChecklist
            planFiles={planFiles}
            items={planItems}
            viewerId={viewerId}
            viewerInitials={viewerInitials}
            isNewBuild={job.is_new_build ?? false}
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
            <div className="mb-2 flex items-center justify-end gap-3">
              <ImportBomToAssetsButton jobId={jobId} />
              <Link
                href={`/procurement/${jobId}`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Open in Procurement →
              </Link>
            </div>
            <JobProcurement jobId={jobId} items={procurementItems} suppliers={suppliers} jobNumber={job.number ?? null} siteName={job.site?.name ?? null} />
          </div>
        )}
        {activeTab === "invoicing" && (
          <JobInvoices
            jobId={jobId}
            customerId={job.customer_id ?? null}
            siteId={job.site_id ?? null}
            jobDescription={job.description ?? null}
            jobNumber={job.number ?? null}
            invoices={invoices}
            linkedQuotes={linkedQuotes}
            checklistItems={checklistItems}
            workEntries={workEntries}
            productPrices={productPrices}
            billingSettings={billingSettings}
            receipts={receipts}
            stockItems={stockItems}
            isAdmin={isAdmin}
          />
        )}
      </div>
    </div>
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
          href={`/quoting/new?job=${jobId}`}
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
        href={`/quoting/new?job=${jobId}`}
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
  jobUpdates,
  timeEntries,
  scheduleEntries,
  planItems = [],
  procurementItems = [],
  viewerId,
  viewerInitials,
}: {
  jobId: string;
  job: any;
  allStatuses: any[];
  hasOpenTimer: boolean;
  openTimerId?: string;
  checklistItems: any[];
  procurementItems?: any[];
  templates: any[];
  workEntries: any[];
  notes: any[];
  jobUpdates: any[];
  timeEntries: any[];
  scheduleEntries: any[];
  planItems?: any[];
  viewerId: string | null;
  viewerInitials: string;
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
        {/* Site phone + site contact under the address so the tech can ring
            the club from the job without bouncing out to Sites (Michael,
            2026-07-30). Only renders what's actually recorded on the site. */}
        {(job.site?.phone || job.site?.site_contact?.mobile || job.site?.site_contact?.phone) && (
          <p className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {job.site.phone && (
              <span>
                Club{" "}
                <a href={`tel:${String(job.site.phone).replace(/\s+/g, "")}`} className="text-foreground hover:text-primary tabular-nums">
                  {job.site.phone}
                </a>
              </span>
            )}
            {job.site.site_contact && (job.site.site_contact.mobile || job.site.site_contact.phone) && (
              <span>
                {job.site.site_contact.name}{" "}
                <a
                  href={`tel:${String(job.site.site_contact.mobile || job.site.site_contact.phone).replace(/\s+/g, "")}`}
                  className="text-foreground hover:text-primary tabular-nums"
                >
                  {job.site.site_contact.mobile || job.site.site_contact.phone}
                </a>
              </span>
            )}
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

      {/* ── Updates (internal-only, not on invoices) ── */}
      <UpdatesPanel jobId={jobId} updates={jobUpdates} />

      {/* ── Checklist (scrollable) ── */}
      <JobChecklist
        jobId={jobId}
        items={checklistItems}
        templates={templates}
        viewerId={viewerId}
        viewerInitials={viewerInitials}
      />

      {/* ── Allocated parts (Mitchell 2026-10-15): what Sue has already pulled
          from stock for this job, so the tech doesn't log it again in Work
          Completed or grab a second one. ── */}
      <AllocatedParts items={procurementItems} />

      {/* ── Work Completed ── */}
      <WrapUpDay
        jobId={jobId}
        workEntries={workEntries}
        timeEntries={timeEntries}
        planItems={planItems}
        notes={notes}
        viewerId={viewerId}
      />
      <WorkLog jobId={jobId} entries={workEntries} />

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
                {se.attendance && (
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-500/20 text-amber-300">
                    {se.attendance === "did_not_attend" ? "Did not attend" : "Rescheduled"}
                  </span>
                )}
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
            href={`/scheduler?jobId=${jobId}`}
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

/* Parts allocated from stock (Inventory → Allocate). Read-only here; the
   Procurement tab has the full list and the invoice picks these up. */
function AllocatedParts({ items }: { items: any[] }) {
  const rows = items.filter((i) => i.allocated_from_stock);
  const unwrap = (v: any) => (Array.isArray(v) ? v[0] ?? null : v ?? null);
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
        Allocated parts
      </h2>
      <div className="rounded-lg border border-border bg-card">
        {rows.length === 0 ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">
            Nothing allocated from stock yet. Parts the office pulls from the cupboard for this job show here — don&rsquo;t log them again in Work Completed.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const who = unwrap(r.allocated_by_staff)?.display_name ?? null;
              const when = new Date(r.updated_at ?? r.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
              return (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="font-mono text-sm font-semibold w-10 shrink-0 text-right">{Number(r.quantity)} ×</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{r.product_name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {r.sku ? <span className="font-mono">{r.sku} · </span> : null}
                      {who ? `${who} · ` : ""}{when}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${r.invoiced_at ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}>
                    {r.invoiced_at ? "Invoiced" : "To bill"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
