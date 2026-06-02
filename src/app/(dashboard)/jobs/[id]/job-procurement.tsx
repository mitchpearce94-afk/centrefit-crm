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
  product?: { category: string | null } | null;
  line?: { cost_price: number | null } | null;
}

interface Supplier {
  id: string;
  name: string;
}

// Triage order for the Active tab: untriaged first, then what's queued to
// order, then shed stock, then already-ordered (waiting on delivery).
const STATUS_ORDER: Record<ProcurementItem["status"], number> = {
  pending: 0,
  order: 1,
  in_stock: 2,
  ordered: 3,
  received: 4,
};

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
  const [tab, setTab] = useState<"active" | "received">("active");
  const [splitTarget, setSplitTarget] = useState<ProcurementItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProcurementItem | null>(null);
  // Ad-hoc parts picker (service jobs with no quote BOM).
  const [addOpen, setAddOpen] = useState(false);
  const [catalog, setCatalog] = useState<{ id: string; name: string; sku: string; supplierId: string | null }[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Map<string, number>>(new Map());
  const [addBusy, setAddBusy] = useState(false);

  const supplierName = useMemo(() => {
    const m = new Map(suppliers.map((s) => [s.id, s.name]));
    return (id: string | null) => (id ? m.get(id) ?? "—" : "—");
  }, [suppliers]);

  const hasItems = items.length > 0;
  const orderCount = useMemo(() => items.filter((i) => i.status === "order").length, [items]);
  const unassignedOrderCount = useMemo(
    () => items.filter((i) => i.status === "order" && !i.actual_supplier_id).length,
    [items],
  );
  const zeroPricedOrderCount = useMemo(
    () => items.filter((i) => i.status === "order" && Number(i.line?.cost_price ?? 0) <= 0).length,
    [items],
  );
  const inStockCount = useMemo(() => items.filter((i) => i.status === "in_stock").length, [items]);
  const supplierOrderCount = useMemo(
    () => items.filter((i) => i.status === "order" || i.status === "ordered").length,
    [items],
  );

  const activeItems = useMemo(
    () =>
      items
        .filter((i) => i.status !== "received")
        .sort(
          (a, b) =>
            STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
            a.product_name.localeCompare(b.product_name),
        ),
    [items],
  );
  const receivedItems = useMemo(
    () =>
      items
        .filter((i) => i.status === "received")
        .sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? "")),
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

  async function resetPO(item: ProcurementItem) {
    if (!item.xero_po_id) return;
    const label = item.xero_po_number ?? "this PO";
    if (
      !confirm(
        `Reset ${label}? This deletes the draft PO in Xero and puts its lines back to ORDER so you can re-triage and regenerate. Only works if it hasn't been billed.`,
      )
    ) {
      return;
    }
    setBusy(item.id);
    try {
      const res = await fetch(`/api/jobs/${jobId}/procurement/cancel-po`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xeroPoId: item.xero_po_id }),
      });
      const json = await res.json();
      if (!res.ok || json.error) toast(json.error ?? "Reset failed", "error");
      else {
        toast(`${label} deleted — ${json.reverted} line(s) back to Order`);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function generatePOs() {
    const warnings: string[] = [];
    if (unassignedOrderCount > 0) {
      warnings.push(`${unassignedOrderCount} ORDER row(s) have no supplier set and will be skipped.`);
    }
    if (zeroPricedOrderCount > 0) {
      warnings.push(`${zeroPricedOrderCount} ORDER row(s) have no cost price — they'll go to Xero at $0 for you to fix before authorising.`);
    }
    if (warnings.length > 0 && !confirm(`${warnings.join("\n\n")}\n\nContinue?`)) {
      return;
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

  // ── Warehouse Pick List (IN STOCK rows — what to pull from the shed) ──
  function openPickList() {
    const rows = items.filter((i) => i.status === "in_stock");
    if (rows.length === 0) {
      toast("No items flagged In Stock to pick", "error");
      return;
    }
    const byCat = new Map<string, ProcurementItem[]>();
    for (const it of rows) {
      const cat = it.product?.category || "Uncategorised";
      const list = byCat.get(cat) ?? [];
      list.push(it);
      byCat.set(cat, list);
    }
    const sortedCats = [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let body = "";
    for (const [cat, catItems] of sortedCats) {
      body += `<tr><td colspan="4" style="padding:12px 8px 6px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;border-bottom:2px solid #e2e8f0">${cat}</td></tr>`;
      for (const it of catItems.sort((a, b) => a.product_name.localeCompare(b.product_name))) {
        body += `<tr>
          <td style="padding:8px;text-align:center;width:40px"><div style="width:18px;height:18px;border:2px solid #94a3b8;border-radius:3px;margin:0 auto"></div></td>
          <td style="padding:8px;font-weight:500">${it.product_name}</td>
          <td style="padding:8px;font-family:monospace;color:#64748b;font-size:12px">${it.sku || "—"}</td>
          <td style="padding:8px;text-align:center;font-weight:700;font-size:16px">${it.quantity}</td>
        </tr>`;
      }
    }
    printWindow(
      "Warehouse Pick List",
      `<h1 style="font-size:22px;font-weight:700;margin:0">Warehouse Pick List</h1>
       <p style="color:#94a3b8;margin:2px 0 24px;font-size:12px">${rows.length} line item${rows.length === 1 ? "" : "s"} flagged In Stock</p>
       <table style="width:100%;border-collapse:collapse;font-size:13px">
         <thead><tr style="border-bottom:2px solid #0f172a">
           <th style="padding:8px;width:40px"></th>
           <th style="padding:8px;text-align:left">Product</th>
           <th style="padding:8px;text-align:left">SKU</th>
           <th style="padding:8px;text-align:center;width:60px">Qty</th>
         </tr></thead>
         <tbody>${body}</tbody>
       </table>
       <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between">
         <div><p style="font-size:11px;color:#94a3b8">Picked by: ___________________________</p></div>
         <div><p style="font-size:11px;color:#94a3b8">Date: _______________</p></div>
       </div>`,
    );
  }

  // ── Supplier Orders (ORDER + ORDERED rows grouped by actual supplier) ──
  function openSupplierOrders() {
    const rows = items.filter((i) => i.status === "order" || i.status === "ordered");
    if (rows.length === 0) {
      toast("No items queued to order", "error");
      return;
    }
    const bySupplier = new Map<string, ProcurementItem[]>();
    for (const it of rows) {
      const sup = supplierName(it.actual_supplier_id) || "No Supplier Assigned";
      const list = bySupplier.get(sup) ?? [];
      list.push(it);
      bySupplier.set(sup, list);
    }
    const sorted = [...bySupplier.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let sections = "";
    for (const [supplier, supItems] of sorted) {
      let rowsHtml = "";
      for (const it of supItems) {
        rowsHtml += `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:8px;font-weight:500">${it.product_name}${
            it.status === "ordered" && it.xero_po_number
              ? ` <span style="font-size:10px;color:#6366f1;font-family:monospace">${it.xero_po_number}</span>`
              : ""
          }</td>
          <td style="padding:8px;font-family:monospace;color:#64748b;font-size:12px">${it.sku || "—"}</td>
          <td style="padding:8px;text-align:right;font-weight:600">${it.quantity}</td>
        </tr>`;
      }
      sections += `
        <div style="margin-bottom:28px;page-break-inside:avoid">
          <h2 style="font-size:15px;font-weight:700;margin:0;border-bottom:2px solid #0f172a;padding-bottom:6px">${supplier}</h2>
          <table style="width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed">
            <colgroup><col /><col style="width:180px" /><col style="width:60px" /></colgroup>
            <thead><tr style="border-bottom:1px solid #e2e8f0">
              <th style="padding:8px;text-align:left">Product</th>
              <th style="padding:8px;text-align:left">SKU</th>
              <th style="padding:8px;text-align:right">Qty</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>`;
    }
    printWindow(
      "Supplier Orders",
      `<h1 style="font-size:22px;font-weight:700;margin:0">Supplier Purchase Orders</h1>
       <p style="color:#94a3b8;margin:2px 0 24px;font-size:12px">${sorted.length} supplier${sorted.length !== 1 ? "s" : ""}</p>
       ${sections}`,
    );
  }

  function printWindow(title: string, body: string) {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head>
      <title>${title}</title>
      <style>
        @page { size: A4; margin: 15mm; }
        body { font-family: 'Segoe UI', system-ui, sans-serif; padding: 32px; color: #1a1a1a; }
        @media print { body { padding: 0; } }
        table { border-spacing: 0; }
        tr:nth-child(even) { background: #f8fafc; }
      </style>
    </head><body>${body}</body></html>`);
    w.document.close();
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

  const rowsToShow = tab === "active" ? activeItems : receivedItems;

  return (
    <>
    {addPartsModal}
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold">Procurement</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {items.length} line{items.length === 1 ? "" : "s"} · {orderCount} to order
            {receivedItems.length > 0 && ` · ${receivedItems.length} received`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            onClick={openAddParts}
            className="rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            + Add parts
          </button>
          <button
            onClick={openPickList}
            disabled={inStockCount === 0}
            title={inStockCount === 0 ? "Flag rows In Stock to build a pick list" : "Print the warehouse pick list (In Stock rows)"}
            className="rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40"
          >
            Pick List{inStockCount ? ` (${inStockCount})` : ""}
          </button>
          <button
            onClick={openSupplierOrders}
            disabled={supplierOrderCount === 0}
            title={supplierOrderCount === 0 ? "No rows queued to order" : "Print supplier order sheets grouped by supplier"}
            className="rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40"
          >
            Supplier Orders
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

      {/* Tabs */}
      <div className="mb-3 flex items-center gap-1 border-b border-border">
        <button
          onClick={() => setTab("active")}
          className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === "active"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Active ({activeItems.length})
        </button>
        <button
          onClick={() => setTab("received")}
          className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === "received"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Received ({receivedItems.length})
        </button>
      </div>

      {rowsToShow.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {tab === "active" ? "Everything's been received — nothing active." : "Nothing received yet."}
        </p>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-2 py-2 font-medium">Product</th>
              <th className="px-2 py-2 font-medium w-20 text-right">Qty</th>
              <th className="px-2 py-2 font-medium">Supplier</th>
              <th className="px-2 py-2 font-medium">Status</th>
              {tab === "active" && <th className="px-2 py-2 font-medium">Notes</th>}
              <th className="px-2 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rowsToShow.map((item) => {
              const isLocked = item.status === "ordered" || item.status === "received";
              const rowBusy = busy === item.id;
              const noCost =
                item.status === "order" && Number(item.line?.cost_price ?? 0) <= 0;
              return (
                <tr key={item.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-2 py-2">
                    <div className="font-medium text-foreground">{item.product_name}</div>
                    {item.sku && <div className="font-mono text-[10px] text-muted-foreground">{item.sku}</div>}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {isLocked ? (
                      <span className="font-mono">{item.quantity}</span>
                    ) : (
                      <input
                        type="number"
                        min={1}
                        step={1}
                        defaultValue={item.quantity}
                        disabled={rowBusy}
                        onBlur={(e) => {
                          const v = Math.floor(Number(e.target.value));
                          if (v >= 1 && v !== item.quantity) patchItem(item.id, { quantity: v });
                          else e.target.value = String(item.quantity);
                        }}
                        className="w-16 rounded-md border border-border bg-input px-2 py-1 text-right font-mono text-xs text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
                      />
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {isLocked ? (
                      <span className="text-muted-foreground">
                        {supplierName(item.actual_supplier_id)}
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
                            {" · "}
                            {new Date(item.received_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
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
                        {noCost && (
                          <span className="text-[10px] text-amber-400" title="No cost price — PO will go to Xero at $0">
                            ⚠ no cost price
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  {tab === "active" && (
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
                  )}
                  <td className="px-2 py-2 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      {item.status === "ordered" && (
                        <>
                          <button
                            onClick={() => receiveItem(item.id)}
                            disabled={rowBusy}
                            className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                          >
                            Receive
                          </button>
                          <button
                            onClick={() => resetPO(item)}
                            disabled={rowBusy}
                            className="text-xs text-muted-foreground hover:text-red-400 disabled:opacity-50"
                            title="Delete the draft PO in Xero and revert these lines to Order"
                          >
                            Reset PO
                          </button>
                        </>
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
      )}
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
