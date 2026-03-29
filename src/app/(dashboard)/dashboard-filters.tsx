"use client";

import { useRouter, useSearchParams } from "next/navigation";

const inputClass = "rounded-md border border-border bg-input px-3 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none";

export function DashboardFilters({
  staffList,
  categories,
  currentStaff,
  currentCategory,
}: {
  staffList: { id: string; display_name: string }[];
  categories: { id: string; name: string }[];
  currentStaff?: string;
  currentCategory?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/?${params.toString()}`);
  }

  function clearAll() {
    router.push("/");
  }

  const hasFilters = currentStaff || currentCategory;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <select
        value={currentStaff ?? ""}
        onChange={(e) => setFilter("staff", e.target.value)}
        className={inputClass}
      >
        <option value="">All Staff</option>
        {staffList.map((s) => (
          <option key={s.id} value={s.id}>{s.display_name}</option>
        ))}
      </select>
      <select
        value={currentCategory ?? ""}
        onChange={(e) => setFilter("category", e.target.value)}
        className={inputClass}
      >
        <option value="">All Business Units</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {hasFilters && (
        <button
          onClick={clearAll}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
