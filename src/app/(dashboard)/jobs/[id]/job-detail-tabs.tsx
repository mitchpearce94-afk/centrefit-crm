"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { Tabs } from "@/components/tabs";
import { NotesPanel } from "./notes-panel";
import { TimePanel } from "./time-panel";
import { StaffPanel } from "./staff-panel";
import { NbnPanel } from "./nbn-panel";
import type { Category, Status } from "@/lib/types";

interface StaffOption {
  id: string;
  display_name: string;
  initials: string;
  colour: string;
}

const inputClass =
  "block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function JobDetailTabs({
  jobId,
  job,
  notes,
  timeEntries,
  nbnSteps,
  allStaff,
  categories,
}: {
  jobId: string;
  job: any;
  notes: any[];
  timeEntries: any[];
  nbnSteps: any[];
  allStaff: StaffOption[];
  categories: Category[];
}) {
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
            return (
              <DetailsTab
                jobId={jobId}
                job={job}
                categories={categories}
              />
            );
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

function DetailsTab({
  jobId,
  job,
  categories,
}: {
  jobId: string;
  job: any;
  categories: Category[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();

  const [reference, setReference] = useState(job.reference ?? "");
  const [description, setDescription] = useState(job.description ?? "");
  const [category1Id, setCategory1Id] = useState(job.category_1_id ?? "");
  const [category2Id, setCategory2Id] = useState(job.category_2_id ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const jobTypes = categories.filter((c) => c.type === "job_type");
  const businessUnits = categories.filter((c) => c.type === "business_unit");

  async function handleSave() {
    setSaving(true);
    setSaved(false);

    const { error } = await supabase
      .from("jobs")
      .update({
        reference: reference.trim() || null,
        description: description.trim() || null,
        category_1_id: category1Id || null,
        category_2_id: category2Id || null,
      })
      .eq("id", jobId);

    if (error) {
      toast(error.message, "error");
    } else {
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  }

  // Auto-save on blur for text fields
  function handleBlur() {
    if (
      reference !== (job.reference ?? "") ||
      description !== (job.description ?? "")
    ) {
      handleSave();
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      {/* Reference — inline editable */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Reference
        </label>
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          onBlur={handleBlur}
          className={inputClass}
          placeholder="PO number, brief title, or job reference"
        />
      </div>

      {/* Description — big editable textarea */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={handleBlur}
          rows={10}
          className={`${inputClass} resize-y`}
          placeholder="Scope of work, key details, special instructions, completion notes..."
        />
      </div>

      {/* Categories — inline editable */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Job Type
          </label>
          <select
            value={category1Id}
            onChange={(e) => {
              setCategory1Id(e.target.value);
              // Save immediately on category change
              setTimeout(() => handleSave(), 0);
            }}
            className={inputClass}
          >
            <option value="">No type</option>
            {jobTypes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Business Unit
          </label>
          <select
            value={category2Id}
            onChange={(e) => {
              setCategory2Id(e.target.value);
              setTimeout(() => handleSave(), 0);
            }}
            className={inputClass}
          >
            <option value="">No unit</option>
            {businessUnits.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Info row */}
      <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border text-sm">
        <div>
          <span className="text-muted-foreground">Customer</span>
          <p className="font-medium">{job.customer?.name ?? "—"}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Site</span>
          <p className="font-medium">{job.site?.name ?? "—"}</p>
          {job.site?.address && (
            <p className="text-xs text-muted-foreground">
              {[job.site.address, job.site.suburb, job.site.state, job.site.postcode]
                .filter(Boolean)
                .join(", ")}
            </p>
          )}
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

      {/* Save indicator */}
      {(saving || saved) && (
        <div className="text-xs text-muted-foreground">
          {saving ? "Saving..." : "Saved"}
        </div>
      )}
    </div>
  );
}
