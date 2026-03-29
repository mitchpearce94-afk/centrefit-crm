"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

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
            className="flex items-center justify-between rounded-lg border border-border bg-card p-3"
          >
            <div className="flex items-center gap-3">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium text-white"
                style={{ backgroundColor: js.staff?.colour ?? "#3b82f6" }}
              >
                {js.staff?.initials}
              </span>
              <div>
                <p className="text-sm font-medium">
                  {js.staff?.display_name}
                </p>
                {js.staff?.email && (
                  <p className="text-xs text-muted-foreground">
                    {js.staff.email}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => removeStaff(js.id)}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              Remove
            </button>
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
