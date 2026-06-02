"use client";

import { useState } from "react";
import Link from "next/link";

export interface ReadyEntry {
  jobId: string;
  number: number | null;
  customerName: string;
  siteName: string | null;
  quoteRef: string;
  acceptedAt: string | null;
}

export interface ActiveEntry {
  jobId: string;
  number: number | null;
  customerName: string;
  siteName: string | null;
  total: number;
  inStock: number;
  order: number;
  ordered: number;
  received: number;
  poCount: number;
}

type Tab = "needs" | "ready" | "complete";

export function ProcurementBoard({
  ready,
  needsWork,
  complete,
}: {
  ready: ReadyEntry[];
  needsWork: ActiveEntry[];
  complete: ActiveEntry[];
}) {
  // Default to the tab that actually has work in it.
  const [tab, setTab] = useState<Tab>(
    needsWork.length > 0 ? "needs" : ready.length > 0 ? "ready" : "needs",
  );

  return (
    <div className="mt-6">
      <div className="flex items-center gap-1 border-b border-border">
        <TabButton active={tab === "needs"} onClick={() => setTab("needs")}>
          Needs work ({needsWork.length})
        </TabButton>
        <TabButton active={tab === "ready"} onClick={() => setTab("ready")}>
          Ready to start ({ready.length})
        </TabButton>
        <TabButton active={tab === "complete"} onClick={() => setTab("complete")}>
          Complete ({complete.length})
        </TabButton>
      </div>

      <div className="mt-4">
        {tab === "needs" && (
          <ActiveTable
            entries={needsWork}
            empty="Nothing needs work — every started job is fully received or in stock. 🎉"
          />
        )}
        {tab === "ready" && (
          ready.length === 0 ? (
            <Empty text="No jobs waiting to start. Accept a quote and hit “Start from quote”." />
          ) : (
            <div className="rounded-lg border border-border bg-card overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left bg-muted/30 text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Job</th>
                    <th className="px-3 py-2 font-medium">Quote</th>
                    <th className="px-3 py-2 font-medium">Customer</th>
                    <th className="px-3 py-2 font-medium">Site</th>
                    <th className="px-3 py-2 font-medium text-right w-32">Accepted</th>
                  </tr>
                </thead>
                <tbody>
                  {ready.map((e) => (
                    <tr key={e.jobId} className="border-b border-border last:border-0 hover:bg-accent/30">
                      <td className="px-3 py-2 font-mono">
                        <Link href={`/procurement/${e.jobId}`} className="text-primary hover:underline">
                          CFA-{e.number ?? "?"}
                        </Link>
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{e.quoteRef}</td>
                      <td className="px-3 py-2">{e.customerName}</td>
                      <td className="px-3 py-2 text-muted-foreground">{e.siteName ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {e.acceptedAt ? new Date(e.acceptedAt).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        {tab === "complete" && (
          <ActiveTable
            entries={complete}
            empty="No completed procurement yet — finished jobs land here once every line is received or in stock."
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-xs text-muted-foreground">{text}</p>;
}

function ActiveTable({ entries, empty }: { entries: ActiveEntry[]; empty: string }) {
  if (entries.length === 0) return <Empty text={empty} />;
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left bg-muted/30 text-muted-foreground">
            <th className="px-3 py-2 font-medium">Job</th>
            <th className="px-3 py-2 font-medium">Customer · Site</th>
            <th className="px-3 py-2 font-medium text-right w-16">Lines</th>
            <th className="px-3 py-2 font-medium text-right w-20">In Stock</th>
            <th className="px-3 py-2 font-medium text-right w-20">To Order</th>
            <th className="px-3 py-2 font-medium text-right w-20">Ordered</th>
            <th className="px-3 py-2 font-medium text-right w-20">Received</th>
            <th className="px-3 py-2 font-medium text-right w-20">POs</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.jobId} className="border-b border-border last:border-0 hover:bg-accent/30">
              <td className="px-3 py-2 font-mono">
                <Link href={`/procurement/${e.jobId}`} className="text-primary hover:underline">
                  CFA-{e.number ?? "?"}
                </Link>
              </td>
              <td className="px-3 py-2">
                <div className="font-medium">{e.customerName}</div>
                {e.siteName && <div className="text-[10px] text-muted-foreground">{e.siteName}</div>}
              </td>
              <td className="px-3 py-2 text-right font-mono">{e.total}</td>
              <td className="px-3 py-2 text-right font-mono text-sky-400">{e.inStock || "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-amber-400">{e.order || "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-indigo-400">{e.ordered || "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-emerald-400">{e.received || "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-muted-foreground">{e.poCount || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
