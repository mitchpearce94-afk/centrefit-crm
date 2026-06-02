"use client";

import { useState, useMemo, useEffect } from "react";
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
  const [splitTarget, setSplitTarget] = useState<ProcurementItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProcurementItem | null>(null);
  // Ad-hoc parts picker (service jobs with no quote BOM).
  const [addOpen, setAddOpen] = useState(false);
  const [catalog, setCatalog] = useState<{ id: string; name: string; sku: string; supplierId: string | null }[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Map<string, number>>(new Map());
  const [addBusy, setAddBusy] = useState(false);

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

  async function confirmDelete(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/procurement-items/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || json.error) {
        toast(json.error ?? "Delete failed", "error");
      } else {
        setDeleteTarget(null);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function confirmSplit(id: string, splitQty: number) {
    setBusy(id);
    try {
      const res = await fetch(`/api/procurement-items/${id}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ splitQuantity: splitQty }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        toast(json.error ?? "Split failed", "error");
      } else {
        setSplitTarget(null);
        router.refresh();
      }
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

  async function openAddParts() {
    setPicked(new Map());
    setSearch("");
    setAddOpen(true);
    if (catalog.length === 0) {
      setCatalogLoading(true);
      try {
        const res = await fetch(`/api/jobs/${jobId}/procurement/add-items`);
        const json = await res.json();
        if (res.ok) setCatalog(json.products ?? []);
        else toast(json.error ?? "Couldn't load products", "error");
      } finally {
        setCatalogLoading(false);
      }
    }
  }

  function setPickedQty(productId: string, qty: number) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(productId);
      else next.set(productId, qty);
      return next;
    });
  }

  async function submitAddParts() {
    const itemsToAdd = [...picked.entries()].map(([productId, quantity]) => ({ productId, quantity }));
    if (itemsToAdd.length === 0) {
      toast("Pick at least one part", "error");
      return;
    }
    setAddBusy(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/procurement/add-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: itemsToAdd }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Failed to add parts", "error");
        return;
      }
      toast(`Added ${json.created} part${json.created === 1 ? "" : "s"} to order`);
      setAddOpen(false);
      router.refresh();
    } finally {
      setAddBusy(false);
    }
  }

  const filteredCatalog = (() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? catalog.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      : catalog;
    return base.slice(0, 40);
  })();

  const addPartsModal = addOpen ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !addBusy && setAddOpen(false)}>
      <div className="w-full max-w-lg rounded-lg border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Add parts to order</h3>
          <button onClick={() => setAddOpen(false)} disabled={addBusy} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>
        <div className="p-4 space-y-3">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search parts by name or SKU…"
            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
            {catalogLoading ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">Loading catalogue…</p>
            ) : filteredCatalog.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">No matching parts.</p>
            ) : (
              filteredCatalog.map((p) => {
                const qty = picked.get(p.id) ?? 0;
                return (
                  <div key={p.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{p.name}</div>
                      {p.sku && <div className="font-mono text-[10px] text-muted-foreground">{p.sku}</div>}
                    </div>
                    {qty > 0 ? (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setPickedQty(p.id, qty - 1)} className="h-6 w-6 rounded border border-border text-muted-foreground hover:bg-accent">−</button>
                        <span className="w-6 text-center font-mono text-xs">{qty}</span>
                        <button onClick={() => setPickedQty(p.id, qty + 1)} className="h-6 w-6 rounded border border-border text-muted-foreground hover:bg-accent">+</button>
                      </div>
                    ) : (
                      <button onClick={() => setPickedQty(p.id, 1)} className="rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20">Add</button>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground">{picked.size} part{picked.size === 1 ? "" : "s"} selected</span>
            <div className="flex gap-2">
              <button onClick={() => setAddOpen(false)} disabled={addBusy} className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
              <button onClick={submitAddParts} disabled={addBusy || picked.size === 0} className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {addBusy ? "Adding…" : "Add to order"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  if (!hasItems) {
    return (
      <>
        {addPartsModal}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold">Procurement</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Generate draft purchase orders from the accepted quote&rsquo;s BOM — or add parts
                ad-hoc for a service job. Split by stock vs order, pick suppliers, then push draft
                POs into Xero for you to review + send.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <button
                onClick={initFromQuote}
                disabled={busy === "init"}
                className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy === "init" ? "Loading…" : "Start from quote"}
              </button>
              <button
                onClick={openAddParts}
                className="rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                + Add parts ad-hoc
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
    {addPartsModal}
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-sm font-semibold">Procurement</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {items.length} line{items.length === 1 ? "" : "s"} · {orderCount} to order
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={openAddParts}
            className="rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            + Add parts
          </button>
          <button
            onClick={generatePOs}
            disabled={generating || orderCount === 0}
            className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            title={orderCount === 0 ? "Flip some rows to ORDER first" : "Create draft POs in Xero, grouped by supplier"}
          >
            {generating ? "Generating…" : `Generate Draft POs${orderCount ? ` (${orderCount})` : ""}`}
          </button>
        </div>
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
                          onClick={() => setSplitTarget(item)}
                          disabled={rowBusy}
                          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          Split
                        </button>
                      )}
                      {!isLocked && (
                        <button
                          onClick={() => setDeleteTarget(item)}
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
      {splitTarget && (
        <SplitModal
          item={splitTarget}
          busy={busy === splitTarget.id}
          onCancel={() => setSplitTarget(null)}
          onConfirm={(qty) => confirmSplit(splitTarget.id, qty)}
        />
      )}
      {deleteTarget && (
        <ConfirmDeleteModal
          item={deleteTarget}
          busy={busy === deleteTarget.id}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => confirmDelete(deleteTarget.id)}
        />
      )}
    </div>
    </>
  );
}

function ConfirmDeleteModal({
  item,
  busy,
  onCancel,
  onConfirm,
}: {
  item: ProcurementItem;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
      if (e.key === "Enter" && !busy) onConfirm();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel, onConfirm]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-background shadow-xl">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">Delete procurement line?</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            This can't be undone, but you can always re-init procurement from the quote.
          </p>
        </div>

        <div className="px-5 py-4">
          <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
            <div className="font-medium">{item.product_name}</div>
            {item.sku && (
              <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{item.sku}</div>
            )}
            <div className="mt-1 flex items-center justify-between text-muted-foreground">
              <span>Quantity</span>
              <span className="font-mono text-foreground">{item.quantity}</span>
            </div>
          </div>
        </div>

        <div className="border-t border-border px-5 py-3 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-red-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SplitModal({
  item,
  busy,
  onCancel,
  onConfirm,
}: {
  item: ProcurementItem;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (qty: number) => void;
}) {
  const maxSplit = item.quantity - 1;
  const [value, setValue] = useState<string>("1");
  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= maxSplit;
  const remaining = valid ? item.quantity - parsed : item.quantity;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
      if (e.key === "Enter" && valid && !busy) onConfirm(parsed);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel, onConfirm, parsed, valid]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-background shadow-xl">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">Split line</h2>
          <p className="mt-1 text-xs text-muted-foreground truncate">
            {item.product_name}
            {item.sku && <span className="ml-1 font-mono">({item.sku})</span>}
          </p>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Current quantity: <span className="font-mono text-foreground">{item.quantity}</span>
          </div>

          <label className="block">
            <span className="text-xs text-muted-foreground">Split off how many?</span>
            <input
              type="number"
              min={1}
              max={maxSplit}
              step={1}
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              disabled={busy}
              className="mt-1 block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
            <span className="mt-1 block text-[10px] text-muted-foreground">
              Must be between 1 and {maxSplit}.
            </span>
          </label>

          {valid && (
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Original becomes</span>
                <span className="font-mono">{remaining}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">New row</span>
                <span className="font-mono">{parsed}</span>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border px-5 py-3 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => valid && onConfirm(parsed)}
            disabled={!valid || busy}
            className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Splitting…" : "Split"}
          </button>
        </div>
      </div>
    </div>
  );
}
