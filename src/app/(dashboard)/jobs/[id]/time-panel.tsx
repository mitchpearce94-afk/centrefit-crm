"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function TimePanel({
  jobId,
  timeEntries,
}: {
  jobId: string;
  timeEntries: any[];
}) {
  const [clockingIn, setClockingIn] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  // Check if user has an open time entry for this job
  const {
    data: { user },
  } = { data: { user: null as any } }; // Will be loaded on action

  const openEntry = timeEntries.find((t) => !t.end_time);

  async function clockIn() {
    setClockingIn(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Not authenticated");
      setClockingIn(false);
      return;
    }

    const { error } = await supabase.from("job_time").insert({
      job_id: jobId,
      staff_id: user.id,
      start_time: new Date().toISOString(),
      billable: true,
    });

    if (error) {
      alert(error.message);
    } else {
      router.refresh();
    }
    setClockingIn(false);
  }

  async function clockOut(entryId: string) {
    setClockingIn(true);
    const { error } = await supabase
      .from("job_time")
      .update({ end_time: new Date().toISOString() })
      .eq("id", entryId);

    if (error) {
      alert(error.message);
    } else {
      router.refresh();
    }
    setClockingIn(false);
  }

  // Calculate total hours
  const totalMinutes = timeEntries.reduce((acc, t) => {
    if (!t.end_time) return acc;
    const start = new Date(t.start_time).getTime();
    const end = new Date(t.end_time).getTime();
    return acc + (end - start) / 60000;
  }, 0);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalMins = Math.round(totalMinutes % 60);

  return (
    <div className="max-w-2xl">
      {/* Clock in/out button */}
      <div className="mb-5 flex items-center gap-4">
        {openEntry ? (
          <button
            onClick={() => clockOut(openEntry.id)}
            disabled={clockingIn}
            className="rounded-md bg-destructive px-5 py-2.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
          >
            {clockingIn ? "Stopping..." : "Clock Out"}
          </button>
        ) : (
          <button
            onClick={clockIn}
            disabled={clockingIn}
            className="rounded-md bg-success px-5 py-2.5 text-sm font-medium text-white hover:bg-success/90 disabled:opacity-50 transition-colors"
          >
            {clockingIn ? "Starting..." : "Clock In"}
          </button>
        )}
        <div className="text-sm text-muted-foreground">
          Total: <span className="font-medium text-foreground">{totalHours}h {totalMins}m</span>
        </div>
      </div>

      {/* Time entries */}
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                Staff
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                Date
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                Start
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                End
              </th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                Duration
              </th>
              <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">
                Billable
              </th>
            </tr>
          </thead>
          <tbody>
            {timeEntries.map((entry) => {
              const start = new Date(entry.start_time);
              const end = entry.end_time ? new Date(entry.end_time) : null;
              const durationMins = end
                ? Math.round((end.getTime() - start.getTime()) / 60000)
                : null;

              return (
                <tr
                  key={entry.id}
                  className={`border-b border-border last:border-0 ${
                    !end ? "bg-success/5" : ""
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {entry.staff && (
                        <span
                          className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium text-white"
                          style={{
                            backgroundColor:
                              entry.staff.colour ?? "#3b82f6",
                          }}
                        >
                          {entry.staff.initials}
                        </span>
                      )}
                      <span>{entry.staff?.display_name ?? "—"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {start.toLocaleDateString("en-AU")}
                  </td>
                  <td className="px-4 py-2.5">
                    {start.toLocaleTimeString("en-AU", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-2.5">
                    {end ? (
                      end.toLocaleTimeString("en-AU", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    ) : (
                      <span className="inline-flex items-center gap-1 text-success">
                        <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {durationMins !== null
                      ? `${Math.floor(durationMins / 60)}h ${durationMins % 60}m`
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {entry.billable ? (
                      <span className="text-success">Yes</span>
                    ) : (
                      <span className="text-muted-foreground">No</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {timeEntries.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No time entries yet. Clock in to start tracking.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
