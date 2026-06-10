"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface NbnOrderRow {
  id: string;
  nbn_order_id: string | null;
  order_reference: string;
  formatted_address: string | null;
  product_class: string;
  bandwidth_sku: string | null;
  state: string | null;
  sub_state: string | null;
  testing_mode: boolean;
  created_at: string;
  last_synced_at: string | null;
}

const STATE_BADGE: Record<string, string> = {
  Acknowledged: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  InProgress: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Complete: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Rejected: "bg-red-500/10 text-red-300 border-red-500/20",
  Cancelled: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

export function OrdersTable({ orders }: { orders: NbnOrderRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ id: string; data: unknown } | null>(null);

  async function act(action: string, params: Record<string, unknown>, rowId: string) {
    setBusy(rowId);
    setError(null);
    try {
      const res = await fetch("/api/nbn/rev3", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, params }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? "Failed");
      router.refresh();
      return json.result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
        No NBN orders lodged through the CRM yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left bg-muted/30 text-muted-foreground">
              <th className="px-3 py-2 font-medium">NBN Order</th>
              <th className="px-3 py-2 font-medium">Reference</th>
              <th className="px-3 py-2 font-medium">Address</th>
              <th className="px-3 py-2 font-medium">Tech</th>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-mono">
                  {o.nbn_order_id ?? "—"}
                  {o.testing_mode && <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-400">TEST</span>}
                </td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{o.order_reference}</td>
                <td className="px-3 py-2 max-w-[260px] truncate" title={o.formatted_address ?? ""}>{o.formatted_address ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground uppercase">{o.product_class}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-[10px] font-medium border ${STATE_BADGE[o.state ?? ""] ?? "bg-muted/30 text-muted-foreground border-border"}`}>
                    {o.state ?? "—"}{o.sub_state ? ` · ${o.sub_state}` : ""}
                  </span>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {o.nbn_order_id && (
                    <>
                      <button
                        className="text-primary hover:underline disabled:opacity-40"
                        disabled={busy === o.id}
                        onClick={() => void act("orders.refresh", { nbn_order_id: o.nbn_order_id }, o.id)}
                      >
                        {busy === o.id ? "…" : "Refresh"}
                      </button>
                      <button
                        className="ml-3 text-primary hover:underline disabled:opacity-40"
                        disabled={busy === o.id}
                        onClick={async () => {
                          const data = await act("orders.history", { nbn_order_id: o.nbn_order_id }, o.id);
                          if (data) setDetail({ id: o.id, data });
                        }}
                      >
                        History
                      </button>
                      {o.state !== "Complete" && o.state !== "Cancelled" && (
                        <button
                          className="ml-3 text-red-400 hover:underline disabled:opacity-40"
                          disabled={busy === o.id}
                          onClick={() => {
                            if (confirm(`Cancel NBN order ${o.nbn_order_id}? This sends a cancellation to NBN.`)) {
                              void act("orders.cancel", { nbn_order_id: o.nbn_order_id }, o.id);
                            }
                          }}
                        >
                          Cancel
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail && (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold">Order history</h4>
            <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setDetail(null)}>close</button>
          </div>
          <pre className="mt-2 max-h-72 overflow-auto rounded bg-muted/30 p-2 text-[10px]">{JSON.stringify(detail.data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
