"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { autoTransitionJobStatus } from "@/lib/job-status-transitions";

interface StaffOption {
  id: string;
  display_name: string;
  initials: string;
  colour: string;
}

export function StaffPanel({
  jobId,
  assignedStaff,
  allStaff,
}: {
  jobId: string;
  assignedStaff: any[];
  allStaff: StaffOption[];
}) {
  const [adding, setAdding] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();

  const assignedIds = assignedStaff.map((js: any) => js.staff?.id);
  const availableStaff = allStaff.filter((s) => !assignedIds.includes(s.id));

  async function addStaff(staffId: string) {
    setAdding(true);
    const { error } = await supabase.from("job_staff").insert({
      job_id: jobId,
      staff_id: staffId,
    });

    if (error) {
      toast(error.message, "error");
    } else {
      await autoTransitionJobStatus(jobId, "staff_assigned", supabase);
      router.refresh();
    }
    setAdding(false);
  }

  async function removeStaff(assignmentId: string) {
    const { error } = await supabase
      .from("job_staff")
      .delete()
      .eq("id", assignmentId);

    if (error) {
      toast(error.message, "error");
    } else {
      router.refresh();
    }
  }

  return (
    <div className="max-w-lg">
      {/* Assigned staff */}
      <h3 className="text-sm font-medium text-muted-foreground mb-3">
        Assigned to this job
      </h3>
      <div className="space-y-2 mb-6">
        {assignedStaff.map((js: any) => (
          <div
            key={js.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card p-3"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ring-1 ring-white/10"
                style={{ backgroundColor: js.staff?.colour ?? "#3b82f6" }}
              >
                {js.staff?.initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {js.staff?.display_name}
                </p>
                {js.staff?.phone && (
                  <a
                    href={`tel:${js.staff.phone}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-primary hover:underline font-mono"
                  >
                    {js.staff.phone}
                  </a>
                )}
                {!js.staff?.phone && js.staff?.email && (
                  <p className="text-xs text-muted-foreground truncate">
                    {js.staff.email}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {js.staff?.phone && (
                <a
                  href={`tel:${js.staff.phone}`}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors"
                  aria-label={`Call ${js.staff.display_name}`}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </a>
              )}
              <button
                onClick={() => removeStaff(js.id)}
                className="hidden sm:inline text-xs text-muted-foreground hover:text-destructive transition-colors px-2 py-1"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {assignedStaff.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">
            No staff assigned.
          </p>
        )}
      </div>

      {/* Available staff to add */}
      {availableStaff.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Add staff
          </h3>
          <div className="flex flex-wrap gap-2">
            {availableStaff.map((s) => (
              <button
                key={s.id}
                onClick={() => addStaff(s.id)}
                disabled={adding}
                className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
              >
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium text-white"
                  style={{ backgroundColor: s.colour }}
                >
                  {s.initials}
                </span>
                {s.display_name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
