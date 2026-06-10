"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export interface ServiceRow {
  productId: string;
  serviceRef: string | null;
  productType: string | null;
}

interface Summary {
  customerRef: string | null;
  formattedAddress: string | null;
  technology: string | null;
  speedTier: string | null;
  state: string | null;
  endUserType: string | null;
}

const CONCURRENCY = 8;

export function ServicesTable({ rows, badge }: { rows: ServiceRow[]; badge: string }) {
  const [summaries, setSummaries] = useState<Record<string, Summary | "error">>({});
  const [filter, setFilter] = useState("");
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current || rows.length === 0) return;
    startedRef.current = true;
    let cancelled = false;

    const queue = [...rows];
    const worker = async () => {
      while (queue.length > 0 && !cancelled) {
        const row = queue.shift()!;
        try {
          const res = await fetch(`/api/nbn/product-summary?id=${encodeURIComponent(row.productId)}`);
          const data = await res.json();
          if (cancelled) return;
          setSummaries((s) => ({
            ...s,
            [row.productId]: res.ok && data.summary ? (data.summary as Summary) : "error",
          }));
        } catch {
          if (!cancelled) setSummaries((s) => ({ ...s, [row.productId]: "error" }));
        }
      }
    };
    for (let i = 0; i < CONCURRENCY; i++) void worker();
    return () => { cancelled = true; };
  }, [rows]);

  const loaded = Object.keys(summaries).length;
  const q = filter.trim().toLowerCase();
  const visible = q
    ? rows.filter((r) => {
        const s = summaries[r.productId];
        const hay = [
          r.serviceRef,
          r.productId,
          ...(s && s !== "error" ? [s.customerRef, s.formattedAddress, s.technology, s.speedTier] : []),
        ].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      })
    : rows;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by address, customer ref, AVC…"
          className="w-full max-w-sm rounded-md border border-border bg-card px-3 py-1.5 text-xs outline-none focus:border-primary/50"
        />
        {loaded < rows.length && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            Loading details… {loaded}/{rows.length}
          </span>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left bg-muted/30 text-muted-foreground">
              <th className="px-3 py-2 font-medium">Service Ref</th>
              <th className="px-3 py-2 font-medium">Customer Ref</th>
              <th className="px-3 py-2 font-medium">Address</th>
              <th className="px-3 py-2 font-medium">Technology</th>
              <th className="px-3 py-2 font-medium">Speed Tier</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const s = summaries[r.productId];
              const pending = s === undefined;
              const failed = s === "error";
              const sum = !pending && !failed ? (s as Summary) : null;
              const serviceRef = r.serviceRef ?? r.productId;
              const dim = pending ? "text-muted-foreground/50" : "text-muted-foreground";
              return (
                <tr key={r.productId} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono">
                    <Link href={`/nbn/services/${encodeURIComponent(serviceRef)}`} className="text-primary hover:underline">
                      {serviceRef}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono">{sum?.customerRef ?? (pending ? "…" : "—")}</td>
                  <td className={`px-3 py-2 max-w-[300px] truncate ${pending ? "text-muted-foreground/50" : ""}`} title={sum?.formattedAddress ?? undefined}>
                    {sum?.formattedAddress ?? (pending ? "Loading…" : failed ? "Lookup failed" : "—")}
                  </td>
                  <td className={`px-3 py-2 ${dim}`}>{sum?.technology ?? (pending ? "…" : "—")}</td>
                  <td className={`px-3 py-2 ${dim}`}>{sum?.speedTier ?? (pending ? "…" : "—")}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-medium border ${badge}`}>
                      {sum?.state ?? r.productType ?? "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 && (
          <div className="p-6 text-center text-xs text-muted-foreground">No services match “{filter}”.</div>
        )}
      </div>
    </div>
  );
}
