"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import type { Status, Category } from "@/lib/types";

const phases = [
  { value: "", label: "All Phases" },
  { value: "pre_work", label: "Pre-Work" },
  { value: "quoting", label: "Quoting" },
  { value: "in_progress", label: "In Progress" },
  { value: "tracking_hold", label: "Tracking & Hold" },
  { value: "completion", label: "Completion" },
];

interface StaffOption {
  id: string;
  display_name: string;
  initials: string;
  colour: string;
}

type QuickView = "today" | "week" | "active" | "all";

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

  // Derive the active quick-view from the current params.
  const activeQuick: QuickView =
    defaultPeriod === "today"
      ? "today"
      : defaultPeriod === "week"
        ? "week"
        : defaultView === "active"
          ? "active"
          : "all";

  // Extra-filter count (anything in the menu that's not at default).
  // Staff default is "my jobs" (= currentUserId) — any other staff
  // selection (including "all") counts as a divergence from default.
  const extraCount =
    (defaultQuery ? 1 : 0) +
    (defaultPhase ? 1 : 0) +
    (defaultStatus ? 1 : 0) +
    (defaultCategory ? 1 : 0) +
    (defaultStaff && defaultStaff !== currentUserId ? 1 : 0);

  const [menuOpen, setMenuOpen] = useState(extraCount > 0);

  const setQuickView = useCallback(
    (v: QuickView) => {
      const params = new URLSearchParams(searchParams.toString());
      // Wipe period + view; rebuild fresh per view
      params.delete("period");
      params.delete("view");
      if (v === "today") {
        params.set("period", "today");
        params.set("view", "active");
      } else if (v === "week") {
        params.set("period", "week");
        params.set("view", "active");
      } else if (v === "active") {
        params.set("view", "active");
      } else {
        params.set("view", "all");
      }
      startTransition(() => {
        router.push(`/jobs?${params.toString()}`);
      });
    },
    [router, searchParams, startTransition]
  );

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      // Phase change wipes specific status (statuses are scoped to phase)
      if (key === "phase") {
        params.delete("status");
      }
      startTransition(() => {
        router.push(`/jobs?${params.toString()}`);
      });
    },
    [router, searchParams, startTransition]
  );

  function clearAllExtras() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    params.delete("phase");
    params.delete("status");
    params.delete("category");
    params.delete("staff");
    startTransition(() => {
      router.push(`/jobs?${params.toString()}`);
    });
  }

  const filteredStatuses = defaultPhase
    ? statuses.filter((s) => s.phase === defaultPhase)
    : statuses;

  const quickTabs: { key: QuickView; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "This Week" },
    { key: "active", label: "Active" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="mt-4 space-y-3">
      {/* Quick-view tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-lg border border-border bg-card p-0.5">
          {quickTabs.map((t) => {
            const active = activeQuick === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setQuickView(t.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setMenuOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            menuOpen || extraCount > 0
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
          aria-expanded={menuOpen}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="7" y1="12" x2="17" y2="12" />
            <line x1="10" y1="18" x2="14" y2="18" />
          </svg>
          Filters
          {extraCount > 0 && (
            <span className="rounded-full bg-primary/20 px-1.5 py-0 text-[10px] font-semibold">
              {extraCount}
            </span>
          )}
        </button>

        {isPending && (
          <span className="text-xs text-muted-foreground">Loading…</span>
        )}
      </div>

      {/* Filters menu */}
      {menuOpen && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Filters
            </span>
            {extraCount > 0 && (
              <button
                onClick={clearAllExtras}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear all
              </button>
            )}
          </div>

          <input
            type="text"
            placeholder="Search by number, reference, or description…"
            defaultValue={defaultQuery}
            onChange={(e) => updateParam("q", e.target.value)}
            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <FilterSelect
              label="Phase"
              value={defaultPhase ?? ""}
              onChange={(v) => updateParam("phase", v)}
              options={phases.map((p) => ({ value: p.value, label: p.label }))}
            />
            <FilterSelect
              label="Status"
              value={defaultStatus ?? ""}
              onChange={(v) => updateParam("status", v)}
              options={[
                { value: "", label: "All Statuses" },
                ...filteredStatuses.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
            <FilterSelect
              label="Category"
              value={defaultCategory ?? ""}
              onChange={(v) => updateParam("category", v)}
              options={[
                { value: "", label: "All Categories" },
                ...jobTypes.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            {staff && staff.length > 0 && (
              <FilterSelect
                label="Assigned"
                value={defaultStaff ?? (currentUserId || "all")}
                onChange={(v) => updateParam("staff", v)}
                options={[
                  ...(currentUserId
                    ? [{ value: currentUserId, label: "My jobs (default)" }]
                    : []),
                  { value: "all", label: "All Staff" },
                  ...staff
                    .filter((s) => s.id !== currentUserId)
                    .map((s) => ({ value: s.id, label: s.display_name })),
                ]}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {options.map((o) => (
          <option key={o.value || "any"} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
