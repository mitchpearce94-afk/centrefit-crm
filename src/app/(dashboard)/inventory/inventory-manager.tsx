"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Inventory — live stock on hand for the products we choose to track
 * (docs/inventory-CONTEXT.md). Quantities only ever change through the
 * ledger: procurement "In Stock" clicks decrement via the DB trigger, and
 * everything else goes through the Adjust modal with a reason.
 */

export interface InventoryItemRow {
  id: string;
  product_id: string;
  qty_on_hand: number | string;
  reorder_point: number | string | null;
  reorder_qty: number | string | null;
  location: string | null;
  notes: string | null;
  alert_staff_id: string | null;
  low_stock_alerted_at: string | null;
  last_counted_at: string | null;
  updated_at: string;
  product: { id: string; name: string; sku: string | null; category: string; image_url: string | null } | null;
  alert_staff: { display_name: string } | null;
}
export interface MovementRow {
  id: string;
  inventory_item_id: string;
  delta: number | string;
  qty_after: number | string;
  reason: string;
  job_id: string | null;
  note: string | null;
  created_at: string;
  staff: { display_name: string; initials: string } | null;
  job: { number: string } | null;
}
export interface ProductOpt {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  image_url: string | null;
}
export interface StaffOpt {
  id: string;
  display_name: string;
}

const REASON_LABEL: Record<string, string> = {
  opening: "Opening balance",
  receive: "Stock received",
  job_allocation: "Used on job",
  job_release: "Released from job",
  adjustment: "Adjustment",
  count: "Stock take",
  return: "Returned from job",
};

type StockStatus = "out" | "low" | "ok" | "untracked";
function stockStatus(item: InventoryItemRow): StockStatus {
  const qty = Number(item.qty_on_hand);
  if (qty <= 0) return "out";
  if (item.reorder_point != null && qty <= Number(item.reorder_point)) return "low";
  return item.reorder_point == null ? "untracked" : "ok";
}

const inputClass =
  "block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function InventoryManager({
  items,
  movements,
  products,
  staff,
  canManage,
  focusItemId,
  initialQuery,
}: {
  items: InventoryItemRow[];
  movements: MovementRow[];
  products: ProductOpt[];
  staff: StaffOpt[];
  canManage: boolean;
  focusItemId: string | null;
  initialQuery: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [adding, setAdding] = useState(false);
  const [adjusting, setAdjusting] = useState<InventoryItemRow | null>(null);
  const [editing, setEditing] = useState<InventoryItemRow | null>(null);
  // ?item=<id> (from a low-stock notification) opens that item's history.
  const [history, setHistory] = useState<InventoryItemRow | null>(() =>
    focusItemId ? items.find((i) => i.id === focusItemId) ?? null : null,
  );

  const counts = useMemo(() => {
    let low = 0;
    let out = 0;
    for (const it of items) {
      const s = stockStatus(it);
      if (s === "low") low++;
      if (s === "out") out++;
    }
    return { tracked: items.length, low, out };
  }, [items]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items
      .filter((it) => (filter === "attention" ? ["low", "out"].includes(stockStatus(it)) : true))
      .filter((it) =>
        !needle ||
        [it.product?.name, it.product?.sku, it.product?.category, it.location].some((v) => v && v.toLowerCase().includes(needle)),
      )
      .sort((a, b) => {
        const rank = (s: StockStatus) => (s === "out" ? 0 : s === "low" ? 1 : 2);
        const d = rank(stockStatus(a)) - rank(stockStatus(b));
        return d !== 0 ? d : (a.product?.name ?? "").localeCompare(b.product?.name ?? "");
      });
  }, [items, q, filter]);

  const lastMovementByItem = useMemo(() => {
    const m = new Map<string, MovementRow>();
    for (const mv of movements) if (!m.has(mv.inventory_item_id)) m.set(mv.inventory_item_id, mv);
    return m;
  }, [movements]);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Inventory</h1>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
            Stock on hand for tracked products. Marking a line <span className="text-foreground">In Stock</span> on procurement takes it from here.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            + Track a product
          </button>
        )}
      </div>

      {/* Metrics */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <button type="button" onClick={() => setFilter("all")} className={`surface-card card-hover p-4 sm:p-5 text-left ${filter === "all" ? "ring-1 ring-primary/40" : ""}`}>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Tracked</p>
          <p className="num-display num-gradient mt-2 text-2xl font-semibold">{counts.tracked}</p>
        </button>
        <button type="button" onClick={() => setFilter("attention")} className={`surface-card card-hover p-4 sm:p-5 text-left ${counts.low > 0 ? "border-amber-500/30 bg-amber-500/5" : ""} ${filter === "attention" ? "ring-1 ring-primary/40" : ""}`}>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Low</p>
          <p className={`num-display mt-2 text-2xl font-semibold ${counts.low > 0 ? "text-amber-400" : "num-gradient"}`}>{counts.low}</p>
        </button>
        <button type="button" onClick={() => setFilter("attention")} className={`surface-card card-hover p-4 sm:p-5 text-left ${counts.out > 0 ? "border-destructive/30 bg-destructive/5" : ""} ${filter === "attention" ? "ring-1 ring-primary/40" : ""}`}>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Out</p>
          <p className={`num-display mt-2 text-2xl font-semibold ${counts.out > 0 ? "text-destructive" : "num-gradient"}`}>{counts.out}</p>
        </button>
      </div>

      {/* Search */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search product, SKU, category or location…"
          className={`${inputClass} max-w-md`}
        />
        {filter === "attention" && (
          <button type="button" onClick={() => setFilter("all")} className="text-xs text-muted-foreground hover:text-foreground">
            Showing low + out only · show all
          </button>
        )}
      </div>

      {/* List */}
      <div className="surface-card mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Product</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider text-right">On hand</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider text-right hidden sm:table-cell">Reorder at</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider hidden md:table-cell">Location</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider hidden lg:table-cell">Last movement</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground text-sm">
                  {items.length === 0
                    ? canManage
                      ? "Nothing tracked yet. Hit “Track a product” to add your first stock item."
                      : "Nothing tracked yet."
                    : filter === "attention"
                    ? "Nothing low or out — good."
                    : "No items match your search."}
                </td>
              </tr>
            )}
            {visible.map((it) => {
              const status = stockStatus(it);
              const qty = Number(it.qty_on_hand);
              const last = lastMovementByItem.get(it.id);
              const focused = focusItemId === it.id;
              return (
                <tr key={it.id} className={`transition-colors hover:bg-accent/40 ${focused ? "bg-primary/5" : ""}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      {it.product?.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.product.image_url} alt="" className="h-9 w-9 rounded-md object-cover border border-border shrink-0 bg-muted" />
                      ) : (
                        <div className="h-9 w-9 rounded-md border border-border bg-muted shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{it.product?.name ?? "Unknown product"}</p>
                        <p className="text-[11px] text-muted-foreground font-mono truncate">
                          {it.product?.sku ?? "—"}
                          <span className="font-sans"> · {it.product?.category}</span>
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex flex-col items-end">
                      <span className={`font-mono text-base font-semibold ${status === "out" ? "text-destructive" : status === "low" ? "text-amber-400" : "text-foreground"}`}>{qty}</span>
                      {status === "out" && <span className="text-[10px] uppercase tracking-wide text-destructive font-medium">Out</span>}
                      {status === "low" && <span className="text-[10px] uppercase tracking-wide text-amber-400 font-medium">Low</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm text-muted-foreground hidden sm:table-cell">
                    {it.reorder_point == null ? <span title="No alert set">—</span> : Number(it.reorder_point)}
                    {it.reorder_qty != null && <span className="text-[10px] font-sans"> · order {Number(it.reorder_qty)}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell">{it.location ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">
                    {last ? (
                      <span>
                        <span className={Number(last.delta) < 0 ? "text-destructive" : "text-emerald-400"}>{Number(last.delta) > 0 ? "+" : ""}{Number(last.delta)}</span>{" "}
                        {REASON_LABEL[last.reason] ?? last.reason}
                        {last.job?.number ? ` · ${last.job.number}` : ""} · {fmtDate(last.created_at)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      {canManage && (
                        <button type="button" onClick={() => setAdjusting(it)} className="rounded-md bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/25 transition-colors">
                          Adjust
                        </button>
                      )}
                      <button type="button" onClick={() => setHistory(it)} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                        History
                      </button>
                      {canManage && (
                        <button type="button" onClick={() => setEditing(it)} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title="Reorder point, location, alerts">
                          Settings
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

      {adding && <AddItemModal products={products} tracked={new Set(items.map((i) => i.product_id))} staff={staff} onClose={() => setAdding(false)} />}
      {adjusting && <AdjustModal item={adjusting} onClose={() => setAdjusting(null)} />}
      {editing && <SettingsModal item={editing} staff={staff} onClose={() => setEditing(null)} />}
      {history && <HistoryDrawer item={history} movements={movements.filter((m) => m.inventory_item_id === history.id)} onClose={() => setHistory(null)} />}
    </div>
  );
}

/* ── Shared modal shell (scroll lives on the layer, bottom-sheet on phones) ── */
function Modal({ title, subtitle, onClose, children, wide }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" />
      <div className="absolute inset-0 overflow-y-auto" onClick={onClose}>
        <div className="flex min-h-full items-end sm:items-center justify-center p-3 sm:p-4">
          <div onClick={(e) => e.stopPropagation()} className={`relative w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-2xl border border-border bg-card shadow-2xl`}>
            <div className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">{title}</h2>
                  {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
                </div>
                <button type="button" onClick={onClose} className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground hover:border-foreground transition-colors" aria-label="Close">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
                </button>
              </div>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ItemHeader({ item }: { item: InventoryItemRow }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-muted/20 p-3">
      {item.product?.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.product.image_url} alt="" className="h-10 w-10 rounded-md object-cover border border-border bg-muted" />
      ) : (
        <div className="h-10 w-10 rounded-md border border-border bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{item.product?.name}</p>
        <p className="text-[11px] font-mono text-muted-foreground">{item.product?.sku ?? "—"}</p>
      </div>
      <div className="text-right">
        <p className="font-mono text-lg font-semibold">{Number(item.qty_on_hand)}</p>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">on hand</p>
      </div>
    </div>
  );
}

/* ── Track a product ── */
function AddItemModal({ products, tracked, staff, onClose }: { products: ProductOpt[]; tracked: Set<string>; staff: StaffOpt[]; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("0");
  const [reorderPoint, setReorderPoint] = useState("");
  const [reorderQty, setReorderQty] = useState("");
  const [location, setLocation] = useState("");
  const [alertStaffId, setAlertStaffId] = useState("");
  const [saving, setSaving] = useState(false);

  const candidates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products
      .filter((p) => !tracked.has(p.id))
      .filter((p) => !needle || [p.name, p.sku, p.category].some((v) => v && v.toLowerCase().includes(needle)))
      .slice(0, 40);
  }, [products, tracked, search]);
  const chosen = products.find((p) => p.id === productId) ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) {
      toast("Pick a product first", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: productId,
          qty_on_hand: Number(qty || 0),
          reorder_point: reorderPoint.trim() === "" ? null : Number(reorderPoint),
          reorder_qty: reorderQty.trim() === "" ? null : Number(reorderQty),
          location: location.trim() || null,
          alert_staff_id: alertStaffId || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't add item");
      toast(`${chosen?.sku ?? chosen?.name} is now tracked`, "success");
      onClose();
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't add item", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Track a product" subtitle="Pick a catalogue product, enter what's on the shelf now, and set the point you want to be told to reorder at." onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {!chosen ? (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Product</label>
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, SKU or category…" className={inputClass} />
            <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {candidates.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">No untracked products match.</p>}
              {candidates.map((p) => (
                <button key={p.id} type="button" onClick={() => setProductId(p.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent transition-colors">
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt="" className="h-8 w-8 rounded object-cover border border-border bg-muted shrink-0" />
                  ) : (
                    <div className="h-8 w-8 rounded border border-border bg-muted shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm truncate">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">{p.sku ?? "—"} <span className="font-sans">· {p.category}</span></p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-md border border-border bg-muted/20 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{chosen.name}</p>
              <p className="text-[11px] font-mono text-muted-foreground">{chosen.sku ?? "—"}</p>
            </div>
            <button type="button" onClick={() => setProductId("")} className="text-xs text-muted-foreground hover:text-foreground">Change</button>
          </div>
        )}

        {chosen && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">On the shelf now</span>
                <input type="number" inputMode="decimal" min={0} step="1" value={qty} onChange={(e) => setQty(e.target.value)} className={`${inputClass} mt-1`} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Reorder at (alert)</span>
                <input type="number" inputMode="decimal" min={0} step="1" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} placeholder="none" className={`${inputClass} mt-1`} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Usual order qty</span>
                <input type="number" inputMode="decimal" min={1} step="1" value={reorderQty} onChange={(e) => setReorderQty(e.target.value)} placeholder="optional" className={`${inputClass} mt-1`} />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Location</span>
                <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Shed, shelf B2" className={`${inputClass} mt-1`} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Also alert</span>
                <select value={alertStaffId} onChange={(e) => setAlertStaffId(e.target.value)} className={`${inputClass} mt-1`}>
                  <option value="">Admins only (default)</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>{s.display_name}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground">Low-stock alerts always go to admins. Pick someone here to add them.</p>
          </>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-border">
          <button type="button" onClick={onClose} className="w-full sm:w-auto rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors">Cancel</button>
          <button type="submit" disabled={saving || !chosen} className="w-full sm:w-auto rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {saving ? "Saving…" : "Start tracking"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Adjust stock ── */
function AdjustModal({ item, onClose }: { item: InventoryItemRow; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [mode, setMode] = useState<"receive" | "adjustment" | "count" | "return">("receive");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const current = Number(item.qty_on_hand);

  const parsed = Number(amount);
  const preview = (() => {
    if (amount.trim() === "" || !Number.isFinite(parsed)) return null;
    if (mode === "count") return parsed;
    if (mode === "adjustment") return current + parsed; // signed
    return current + Math.abs(parsed);
  })();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (amount.trim() === "" || !Number.isFinite(parsed)) {
      toast("Enter a quantity", "error");
      return;
    }
    setSaving(true);
    try {
      const payload =
        mode === "count"
          ? { set_to: parsed, reason: "count", note: note.trim() || null }
          : { delta: mode === "adjustment" ? parsed : Math.abs(parsed), reason: mode, note: note.trim() || null };
      const res = await fetch(`/api/inventory/${item.id}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Adjustment failed");
      toast(json.unchanged ? "No change — count already matched" : `${item.product?.sku ?? item.product?.name}: ${json.qty_on_hand} on hand`, "success");
      onClose();
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Adjustment failed", "error");
    } finally {
      setSaving(false);
    }
  }

  const modes: { id: typeof mode; label: string; hint: string }[] = [
    { id: "receive", label: "Received", hint: "Stock arrived — adds to on hand" },
    { id: "count", label: "Stock take", hint: "Set to what you actually counted" },
    { id: "return", label: "Returned", hint: "Came back from a job — adds" },
    { id: "adjustment", label: "Adjust ±", hint: "Correction, damaged, lost — use a minus for down" },
  ];

  return (
    <Modal title="Adjust stock" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ItemHeader item={item} />
        <div className="grid grid-cols-2 gap-1.5">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`rounded-md border px-3 py-2 text-left transition-colors ${mode === m.id ? "border-primary bg-primary/10" : "border-border hover:bg-accent"}`}
            >
              <p className="text-sm font-medium">{m.label}</p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{m.hint}</p>
            </button>
          ))}
        </div>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">{mode === "count" ? "Counted quantity" : mode === "adjustment" ? "Change (use − to reduce)" : "Quantity"}</span>
          <input autoFocus type="number" inputMode="decimal" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass} mt-1 text-lg font-mono`} />
        </label>
        {preview != null && (
          <p className={`text-xs ${preview < 0 ? "text-destructive" : "text-muted-foreground"}`}>
            {current} → <span className="font-mono font-semibold text-foreground">{preview}</span> on hand
            {preview < 0 ? " — can't go below zero" : ""}
          </p>
        )}
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional — e.g. Seadan order 4471" className={`${inputClass} mt-1`} />
        </label>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-border">
          <button type="button" onClick={onClose} className="w-full sm:w-auto rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors">Cancel</button>
          <button type="submit" disabled={saving || preview == null || preview < 0} className="w-full sm:w-auto rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Item settings (reorder point etc.) ── */
function SettingsModal({ item, staff, onClose }: { item: InventoryItemRow; staff: StaffOpt[]; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [reorderPoint, setReorderPoint] = useState(item.reorder_point == null ? "" : String(Number(item.reorder_point)));
  const [reorderQty, setReorderQty] = useState(item.reorder_qty == null ? "" : String(Number(item.reorder_qty)));
  const [location, setLocation] = useState(item.location ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [alertStaffId, setAlertStaffId] = useState(item.alert_staff_id ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmUntrack, setConfirmUntrack] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/inventory/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reorder_point: reorderPoint.trim() === "" ? null : Number(reorderPoint),
          reorder_qty: reorderQty.trim() === "" ? null : Number(reorderQty),
          location: location.trim() || null,
          notes: notes.trim() || null,
          alert_staff_id: alertStaffId || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      toast("Settings saved", "success");
      onClose();
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function untrack() {
    setSaving(true);
    try {
      const res = await fetch(`/api/inventory/${item.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't remove");
      toast("No longer tracked", "success");
      onClose();
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't remove", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Stock settings" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ItemHeader item={item} />
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Reorder at (alert)</span>
            <input type="number" inputMode="decimal" min={0} step="1" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} placeholder="none" className={`${inputClass} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Usual order qty</span>
            <input type="number" inputMode="decimal" min={1} step="1" value={reorderQty} onChange={(e) => setReorderQty(e.target.value)} placeholder="optional" className={`${inputClass} mt-1`} />
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Location</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Shed, shelf B2" className={`${inputClass} mt-1`} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Also alert</span>
          <select value={alertStaffId} onChange={(e) => setAlertStaffId(e.target.value)} className={`${inputClass} mt-1`}>
            <option value="">Admins only (default)</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.display_name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Notes</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputClass} mt-1 resize-y`} />
        </label>
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t border-border">
          {confirmUntrack ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-destructive">Remove from inventory and delete its history?</span>
              <button type="button" onClick={untrack} disabled={saving} className="rounded-md bg-destructive px-3 py-1.5 font-semibold text-white hover:bg-destructive/90">Yes, remove</button>
              <button type="button" onClick={() => setConfirmUntrack(false)} className="text-muted-foreground hover:text-foreground">Keep</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmUntrack(true)} className="text-xs text-muted-foreground hover:text-destructive text-left">Stop tracking this product</button>
          )}
          <div className="flex flex-col-reverse sm:flex-row gap-2">
            <button type="button" onClick={onClose} className="w-full sm:w-auto rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="w-full sm:w-auto rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ── Movement history ── */
function HistoryDrawer({ item, movements, onClose }: { item: InventoryItemRow; movements: MovementRow[]; onClose: () => void }) {
  return (
    <Modal title="Stock history" subtitle={`${item.product?.sku ?? ""} ${item.product?.name ?? ""}`.trim()} onClose={onClose} wide>
      <ItemHeader item={item} />
      {(item.location || item.notes || item.alert_staff) && (
        <p className="text-xs text-muted-foreground">
          {item.location && <span>Location: <span className="text-foreground">{item.location}</span></span>}
          {item.alert_staff && <span>{item.location ? " · " : ""}Also alerts <span className="text-foreground">{item.alert_staff.display_name}</span></span>}
          {item.notes && <span className="block mt-1">{item.notes}</span>}
        </p>
      )}
      <div className="max-h-[55dvh] overflow-y-auto rounded-md border border-border divide-y divide-border">
        {movements.length === 0 && <p className="px-3 py-8 text-center text-xs text-muted-foreground">No movements recorded yet.</p>}
        {movements.map((m) => {
          const delta = Number(m.delta);
          return (
            <div key={m.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
              <span className={`font-mono font-semibold w-14 shrink-0 text-right ${delta < 0 ? "text-destructive" : "text-emerald-400"}`}>{delta > 0 ? "+" : ""}{delta}</span>
              <div className="min-w-0 flex-1">
                <p className="text-foreground">
                  {REASON_LABEL[m.reason] ?? m.reason}
                  {m.job_id && m.job?.number && (
                    <>
                      {" · "}
                      <Link href={`/jobs/${m.job_id}`} className="font-mono text-primary hover:underline">{m.job.number}</Link>
                    </>
                  )}
                </p>
                {m.note && <p className="text-xs text-muted-foreground mt-0.5">{m.note}</p>}
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {fmtDate(m.created_at)}{m.staff ? ` · ${m.staff.display_name}` : ""} · {Number(m.qty_after)} after
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">Showing the most recent movements loaded with the page.</p>
    </Modal>
  );
}
