"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

export interface ProcurementItem {
  id: string;
  product_name: string;
  sku: string | null;
  quantity: number;
  status: "pending" | "in_stock" | "order" | "ordered" | "received";
  actual_supplier_id: string | null;
  default_supplier_id: string | null;
  backorder_note: string | null;
  xero_po_id: string | null;
  xero_po_number: string | null;
  ordered_at: string | null;
  received_at: string | null;
  received_by: string | null;
  received_by_staff?: { display_name: string } | null;
}

interface Supplier {
  id: string;
  name: string;
}

function StatusBadge({ status }: { status: ProcurementItem["status"] }) {
  const conf = {
    pending: { label: "Pending", color: "bg-muted text-muted-foreground" },
    in_stock: { label: "In Stock", color: "bg-sky-500/10 text-sky-400 border border-sky-500/20" },
    order: { label: "Order", color: "bg-amber-500/10 text-amber-400 border border-amber-500/20" },
    ordered: { label: "Ordered", color: "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20" },
    received: { label: "Received", color: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" },
  }[status];
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${conf.color}`}>
      {conf.label}
    </span>
  );
}

export function JobProcurement({
  jobId,
  items,
  suppliers,
}: {
  jobId: string;
  items: ProcurementItem[];
  suppliers: Supplier[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const hasItems = items.length > 0;
  const orderCount = useMemo(() => items.filter((i) => i.status === "order").length, [items]);
  const unassignedOrderCount = useMemo(
    () => items.filter((i) => i.status === "order" && !i.actual_supplier_id).length,
    [items],
  );

  async function initFromQuote() {
    setBusy("init");
    try {
      const res = await fetch(`/api/jobs/${jobId}/procurement/init`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || json.error) {
        toast(json.error ?? "Failed to start ordering", "error");
      } else {
        toast(json.alreadyInitialised
          ? "Procurement already initialised"
          : `Created ${json.created} procurement rows from ${json.quoteRef}`);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function patchItem(id: string, update: Record<string, unknown>) {
    setBusy(id);
    try {
      const res = await fetch(`/api/procurement-items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        toast(json.error ?? "Update failed", "error");
      } else {
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function deleteItem(id: string) {
    if (!confirm("Delete this procurement line?")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/procurement-items/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || json.error) {
        toast(json.error ?? "Delete failed", "error");
      } else {
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function splitItem(id: string, currentQty: number) {
    const input = prompt(
      `Split off how many units? (Original has ${currentQty}. New row will be created with that qty; original reduced to ${currentQty} - your input)`,
      "1",
    );
    if (!input) return;
    const n = Number(input);
    if (!n || n <= 0 || n >= currentQty) {
      toast(`Invalid split quantity. Must be between 1 and ${currentQty - 1}.`, "error");
      return;
    }
    setBusy(id);
    try {
      const res = await fetch(`/api/procurement-items/${id}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ splitQuantity: n }),
      });
      const json = await res.json();
      if (!res.ok || json.error) toast(json.error ?? "Split failed", "error");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function receiveItem(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/procurement-items/${id}/receive`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || json.error) toast(json.error ?? "Receive failed", "error");
      else {
        toast("Marked as received");
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function generatePOs() {
    if (unassignedOrderCount > 0) {
      if (!confirm(`${unassignedOrderCount} ORDER row(s) have no supplier set and will be skipped. Continue?`)) {
        return;
      }
    }
    setGenerating(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/procurement/generate-pos`, { method: "POST" });
      const json = await res.json();
      if (!res.ok && !json.created) {
        toast(json.error ?? "Generation failed", "error");
        return;
      }
      const createdCount = json.created?.length ?? 0;
      const failCount = json.failures?.length ?? 0;
      if (createdCount > 0) {
        toast(
          `Created ${createdCount} draft PO${createdCount === 1 ? "" : "s"} in Xero${
            failCount ? ` (${failCount} failed)` : ""
          }`,
        );
      } else if (failCount > 0) {
        toast(`All ${failCount} PO attempt(s) failed — see console`, "error");
        console.error("PO generation failures:", json.failures);
      }
      router.refresh();
    } finally {
      setGenerating(false);
    }
  }

  if (!hasItems) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Procurement</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Generate draft purchase orders for the accepted quote&rsquo;s BOM. Populates from
              the quote, lets you split by stock vs order, pick suppliers, then pushes draft
              POs into Xero for you to review + send.
            </p>
          </div>
          <button
            onClick={initFromQuote}
            disabled={busy === "init"}
            className="shrink-0 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy === "init" ? "Loading…" : "Start Ordering"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-sm font-semibold">Procurement</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {items.length} line{items.length === 1 ? "" : "s"} · {orderCount} to order
          </p>
        </div>
        <button
          onClick={generatePOs}
          disabled={generating || orderCount === 0}
          className="shrink-0 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          title={orderCount === 0 ? "Flip some rows to ORDER first" : "Create draft POs in Xero, grouped by supplier"}
        >
          {generating ? "Generating…" : `Generate Draft POs${orderCount ? ` (${orderCount})` : ""}`}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-2 py-2 font-medium">Product</th>
              <th className="px-2 py-2 font-medium w-16 text-right">Qty</th>
              <th className="px-2 py-2 font-medium">Supplier</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-2 py-2 font-medium">Notes</th>
              <th className="px-2 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isLocked = item.status === "ordered" || item.status === "received";
              const rowBusy = busy === item.id;
              return (
                <tr key={item.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-2 py-2">
                    <div className="font-medium text-foreground">{item.product_name}</div>
                    {item.sku && <div className="font-mono text-[10px] text-muted-foreground">{item.sku}</div>}
                  </td>
                  <td className="px-2 py-2 text-right font-mono">{item.quantity}</td>
                  <td className="px-2 py-2">
                    {isLocked ? (
                      <span className="text-muted-foreground">
                        {suppliers.find((s) => s.id === item.actual_supplier_id)?.name ?? "—"}
                      </span>
                    ) : (
                      <select
                        value={item.actual_supplier_id ?? ""}
                        onChange={(e) =>
                          patchItem(item.id, { actual_supplier_id: e.target.value || null })
                        }
                        disabled={rowBusy}
                        className="rounded-md border border-border bg-input px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
                      >
                        <option value="">— Unassigned —</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {isLocked ? (
                      <div className="flex flex-col gap-0.5">
                        <StatusBadge status={item.status} />
                        {item.xero_po_number && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {item.xero_po_number}
                          </span>
                        )}
                        {item.received_at && item.received_by_staff && (
                          <span className="text-[10px] text-muted-foreground">
                            by {item.received_by_staff.display_name}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <button
                          onClick={() => patchItem(item.id, { status: "in_stock" })}
                          disabled={rowBusy}
                          className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                            item.status === "in_stock"
                              ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                              : "border border-border text-muted-foreground hover:bg-accent"
                          }`}
                        >
                          In Stock
                        </button>
                        <button
                          onClick={() => patchItem(item.id, { status: "order" })}
                          disabled={rowBusy}
                          className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                            item.status === "order"
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                              : "border border-border text-muted-foreground hover:bg-accent"
                          }`}
                        >
                          Order
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {isLocked ? (
                      <span className="text-muted-foreground">{item.backorder_note ?? ""}</span>
                    ) : (
                      <input
                        type="text"
                        defaultValue={item.backorder_note ?? ""}
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          if (val !== (item.backorder_note ?? "")) {
                            patchItem(item.id, { backorder_note: val || null });
                          }
                        }}
                        disabled={rowBusy}
                        placeholder="e.g. backordered, China direct"
                        className="w-full rounded-md border border-border bg-input px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
                      />
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      {item.status === "ordered" && (
                        <button
                          onClick={() => receiveItem(item.id)}
                          disabled={rowBusy}
                          className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                        >
                          Receive
                        </button>
                      )}
                      {!isLocked && item.quantity > 1 && (
                        <button
                          onClick={() => splitItem(item.id, item.quantity)}
                          disabled={rowBusy}
                          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          Split
                        </button>
                      )}
                      {!isLocked && (
                        <button
                          onClick={() => deleteItem(item.id)}
                          disabled={rowBusy}
                          className="text-xs text-muted-foreground hover:text-red-400 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
