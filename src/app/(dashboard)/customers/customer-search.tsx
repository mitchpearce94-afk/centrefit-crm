"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

const customerTypes = [
  { value: "", label: "All Types" },
  { value: "commercial", label: "Commercial" },
  { value: "residential", label: "Residential" },
  { value: "government", label: "Government" },
  { value: "internal", label: "Internal" },
];

export function CustomerSearch({
  defaultQuery,
  defaultType,
}: {
  defaultQuery?: string;
  defaultType?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      startTransition(() => {
        router.push(`/customers?${params.toString()}`);
      });
    },
    [router, searchParams, startTransition]
  );

  return (
    <div className="mt-4 flex gap-3">
      <input
        type="text"
        placeholder="Search customers..."
        defaultValue={defaultQuery}
        onChange={(e) => updateParams("q", e.target.value)}
        className="flex-1 rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <select
        defaultValue={defaultType}
        onChange={(e) => updateParams("type", e.target.value)}
        className="rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {customerTypes.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
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
