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

export function JobFilters({
  statuses,
  categories,
  defaultQuery,
  defaultPhase,
  defaultStatus,
  defaultCategory,
}: {
  statuses: Status[];
  categories: Category[];
  defaultQuery?: string;
  defaultPhase?: string;
  defaultStatus?: string;
  defaultCategory?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const jobTypes = categories.filter((c) => c.type === "job_type");

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      // Clear status filter when phase changes
      if (key === "phase") {
        params.delete("status");
      }
      startTransition(() => {
        router.push(`/jobs?${params.toString()}`);
      });
    },
    [router, searchParams, startTransition]
  );

  const filteredStatuses = defaultPhase
    ? statuses.filter((s) => s.phase === defaultPhase)
    : statuses;

  return (
    <div className="mt-4 flex flex-wrap gap-3">
      <input
        type="text"
        placeholder="Search jobs..."
        defaultValue={defaultQuery}
        onChange={(e) => updateParams("q", e.target.value)}
        className="flex-1 min-w-[180px] rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
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
      {isPending && (
        <div className="flex items-center text-xs text-muted-foreground">
          Loading...
        </div>
      )}
    </div>
  );
}
