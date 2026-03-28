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

export function JobTabs({
  jobId,
  job,
  notes,
  timeEntries,
  nbnSteps,
  allStaff,
  isNbnJob,
}: {
  jobId: string;
  job: any;
  notes: any[];
  timeEntries: any[];
  nbnSteps: any[];
  allStaff: StaffOption[];
  isNbnJob: boolean;
}) {
  const showNbn = isNbnJob || nbnSteps.length > 0;

  const tabs = [
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
    <Tabs tabs={tabs} defaultTab="notes">
      {(activeTab) => {
        switch (activeTab) {
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
