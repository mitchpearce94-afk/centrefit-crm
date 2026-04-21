"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";

const AU_STATES = ["QLD", "NSW", "VIC", "SA", "WA", "TAS", "NT", "ACT"];

export function SitesSearch({
  defaultQuery,
  defaultState,
}: {
  defaultQuery?: string;
  defaultState?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(defaultQuery ?? "");

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (q) params.set("q", q);
      else params.delete("q");
      router.replace(`/sites?${params.toString()}`);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function setStateFilter(s: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (s) params.set("state", s);
    else params.delete("state");
    router.replace(`/sites?${params.toString()}`);
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <input
        placeholder="Search sites..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="flex-1 min-w-[180px] rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <select
        value={defaultState ?? ""}
        onChange={(e) => setStateFilter(e.target.value)}
        className="rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <option value="">All states</option>
        {AU_STATES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}
