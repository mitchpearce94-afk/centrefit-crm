"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import type { Status, Category } from "@/lib/types";

const phases = [
  { value: "", label: "All Phases" },
  { value: "pre_work", label: "Pre-Work" },
  { value: "quoting", label: "Quoting" },
  { value: "in_progress", label: "In Progress" },
  { value: "tracking_hold", label: "Tracking & Hold" },
  { value: "completion", label: "Completion" },
];

const periods = [
  { value: "", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
];

interface StaffOption {
  id: string;
  display_name: string;
  initials: string;
  colour: string;
}

export function JobFilters({
  statuses,
  categories,
  staff,
  currentUserId,
  defaultQuery,
  defaultPhase,
  defaultStatus,
  defaultCategory,
  defaultPeriod,
  defaultStaff,
  defaultView,
}: {
  statuses: Status[];
  categories: Category[];
  staff?: StaffOption[];
  currentUserId?: string;
  defaultQuery?: string;
  defaultPhase?: string;
  defaultStatus?: string;
  defaultCategory?: string;
  defaultPeriod?: string;
  defaultStaff?: string;
  defaultView?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const jobTypes = categories.filter((c) => c.type === "job_type");

  const isMyJobs = defaultStaff === currentUserId;
  const isActive = defaultView === "active";

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      if (key === "phase") {
        params.delete("status");
      }
      startTransition(() => {
        router.push(`/jobs?${params.toString()}`);
      });
    },
    [router, searchParams, startTransition]
  );

  function toggleMyJobs() {
    const params = new URLSearchParams(searchParams.toString());
    if (isMyJobs) {
      // Switch to all staff
      params.delete("staff");
      params.set("view", defaultView ?? "active");
    } else {
      // Switch to my jobs
      if (currentUserId) params.set("staff", currentUserId);
      params.set("view", defaultView ?? "active");
    }
    startTransition(() => {
      router.push(`/jobs?${params.toString()}`);
    });
  }

  function toggleActive() {
    const params = new URLSearchParams(searchParams.toString());
    if (isActive) {
      params.set("view", "all");
    } else {
      params.set("view", "active");
    }
    // Preserve staff filter
    if (defaultStaff) params.set("staff", defaultStaff);
    startTransition(() => {
      router.push(`/jobs?${params.toString()}`);
    });
  }

  const filteredStatuses = defaultPhase
    ? statuses.filter((s) => s.phase === defaultPhase)
    : statuses;

  return (
    <div className="mt-4 space-y-3">
      {/* Quick toggles */}
      <div className="flex gap-2">
        <button
          onClick={toggleMyJobs}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            isMyJobs
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          My Jobs
        </button>
        <button
          onClick={() => {
            const params = new URLSearchParams(searchParams.toString());
            params.delete("staff");
            params.set("view", defaultView ?? "active");
            startTransition(() => { router.push(`/jobs?${params.toString()}`); });
          }}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            !isMyJobs
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          All Staff
        </button>
        <div className="w-px bg-border" />
        <button
          onClick={toggleActive}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            isActive
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          Active
        </button>
        <button
          onClick={() => {
            const params = new URLSearchParams(searchParams.toString());
            params.set("view", "all");
            if (defaultStaff) params.set("staff", defaultStaff);
            startTransition(() => { router.push(`/jobs?${params.toString()}`); });
          }}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            !isActive
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          All Jobs
        </button>
        {isPending && (
          <div className="flex items-center text-xs text-muted-foreground ml-2">
            Loading...
          </div>
        )}
      </div>

      {/* Detailed filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search jobs..."
          defaultValue={defaultQuery}
          onChange={(e) => updateParams("q", e.target.value)}
          className="flex-1 min-w-[180px] rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          defaultValue={defaultPeriod}
          onChange={(e) => updateParams("period", e.target.value)}
          className="rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {periods.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          defaultValue={defaultPhase}
          onChange={(e) => updateParams("phase", e.target.value)}
          className="rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {phases.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          defaultValue={defaultStatus}
          onChange={(e) => updateParams("status", e.target.value)}
          className="rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All Statuses</option>
          {filteredStatuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          defaultValue={defaultCategory}
          onChange={(e) => updateParams("category", e.target.value)}
          className="rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All Categories</option>
          {jobTypes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {staff && staff.length > 0 && (
          <select
            value={defaultStaff ?? ""}
            onChange={(e) => updateParams("staff", e.target.value)}
            className="rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All Staff</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
