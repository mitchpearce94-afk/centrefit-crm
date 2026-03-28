"use client";

import { Tabs } from "@/components/tabs";
import { NotesPanel } from "./notes-panel";
import { TimePanel } from "./time-panel";
import { StaffPanel } from "./staff-panel";
import { NbnPanel } from "./nbn-panel";

interface StaffOption {
  id: string;
  display_name: string;
  initials: string;
  colour: string;
}

export function JobDetailTabs({
  jobId,
  job,
  notes,
  timeEntries,
  nbnSteps,
  allStaff,
}: {
  jobId: string;
  job: any;
  notes: any[];
  timeEntries: any[];
  nbnSteps: any[];
  allStaff: StaffOption[];
}) {
  // Check if this is an NBN job (category name contains "NBN")
  const isNbnJob = job.category_1?.name?.includes("NBN") ?? false;
  const showNbn = isNbnJob || nbnSteps.length > 0;

  const tabs = [
    { id: "details", label: "Details" },
    { id: "notes", label: "Notes", count: notes.length },
    { id: "time", label: "Time", count: timeEntries.length },
    {
      id: "staff",
      label: "Staff",
      count: job.job_staff?.length ?? 0,
    },
    ...(showNbn
      ? [{ id: "nbn", label: "NBN Steps", count: nbnSteps.length }]
      : []),
  ];

  return (
    <Tabs tabs={tabs} defaultTab="details">
      {(activeTab) => {
        switch (activeTab) {
          case "details":
            return <DetailsTab job={job} />;
          case "notes":
            return <NotesPanel jobId={jobId} notes={notes} />;
          case "time":
            return <TimePanel jobId={jobId} timeEntries={timeEntries} />;
          case "staff":
            return (
              <StaffPanel
                jobId={jobId}
                assignedStaff={job.job_staff ?? []}
                allStaff={allStaff}
              />
            );
          case "nbn":
            return (
              <NbnPanel
                jobId={jobId}
                steps={nbnSteps}
                isNbnJob={isNbnJob}
              />
            );
          default:
            return null;
        }
      }}
    </Tabs>
  );
}

function DetailsTab({ job }: { job: any }) {
  return (
    <div className="max-w-2xl space-y-5">
      {job.description && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-1">
            Description
          </h3>
          <p className="text-sm whitespace-pre-wrap">{job.description}</p>
        </div>
      )}

      {job.site && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-1">
            Site
          </h3>
          <p className="text-sm">{job.site.name}</p>
          {job.site.address && (
            <p className="text-sm text-muted-foreground">
              {[job.site.address, job.site.suburb, job.site.state, job.site.postcode]
                .filter(Boolean)
                .join(", ")}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">Job Type</span>
          <p className="font-medium">{job.category_1?.name ?? "—"}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Business Unit</span>
          <p className="font-medium">{job.category_2?.name ?? "—"}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Estimated Value</span>
          <p className="font-medium">
            {job.estimated_value
              ? `$${Number(job.estimated_value).toLocaleString()}`
              : "—"}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Due Date</span>
          <p className="font-medium">
            {job.due_date
              ? new Date(job.due_date).toLocaleDateString("en-AU")
              : "—"}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Created</span>
          <p className="font-medium">
            {new Date(job.created_at).toLocaleDateString("en-AU")}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Last Updated</span>
          <p className="font-medium">
            {new Date(job.updated_at).toLocaleDateString("en-AU")}
          </p>
        </div>
      </div>

      {/* Assigned Staff */}
      {job.job_staff?.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            Assigned Staff
          </h3>
          <div className="flex flex-wrap gap-2">
            {job.job_staff.map((js: any) => (
              <div
                key={js.id}
                className="flex items-center gap-2 rounded-full border border-border px-3 py-1"
              >
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium text-white"
                  style={{
                    backgroundColor: js.staff?.colour ?? "#3b82f6",
                  }}
                >
                  {js.staff?.initials}
                </span>
                <span className="text-sm">{js.staff?.display_name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
