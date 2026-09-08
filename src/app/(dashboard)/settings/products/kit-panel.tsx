"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

export interface KitContentRow {
  id: string;
  kit_product_id: string;
  component_product_id: string;
  quantity: number | string;
}

interface ProductLite {
  id: string;
  name: string;
  sku: string | null;
  category: string;
}

/**
 * "This product ships with…" — components a kit already includes. The BOM
 * engine nets these off rule/device lines so a kit never double-counts its
 * own contents (e.g. the K6000 kit already has its MW730B enclosure).
 */
export function KitPanel({
  product,
  contents,
  products,
}: {
  product: { id: string; name: string };
  contents: KitContentRow[];
  products: ProductLite[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [componentId, setComponentId] = useState("");
  const [qty, setQty] = useState("1");

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const candidates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const taken = new Set(contents.map((c) => c.component_product_id));
    return products
      .filter((p) => p.id !== product.id && !taken.has(p.id))
      .filter((p) => needle.length >= 2 && [p.name, p.sku, p.category].some((v) => v && v.toLowerCase().includes(needle)))
      .slice(0, 12);
  }, [products, contents, search, product.id]);

  async function save() {
    if (!componentId) {
      toast("Pick the component", "error");
      return;
    }
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      toast("Quantity must be greater than 0", "error");
      return;
    }
    setBusy("new");
    try {
      const res = await fetch(`/api/products/${product.id}/kit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ component_product_id: componentId, quantity: q }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      toast("Kit contents saved");
      setAdding(false);
      setSearch("");
      setComponentId("");
      setQty("1");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: KitContentRow) {
    setBusy(row.id);
    try {
      const res = await fetch(`/api/products/${product.id}/kit`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ component_product_id: row.component_product_id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Remove failed");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Remove failed", "error");
    } finally {
      setBusy(null);
    }
  }

  const chosen = componentId ? productById.get(componentId) : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Kit contents — what&apos;s already in the box
        </span>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="text-xs text-primary hover:underline">
            + Add component
          </button>
        )}
      </div>
      {contents.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground">
          Not a kit. If this product ships with other catalogue items (an enclosure, a PSU…), list them here so the quote never adds them twice.
        </p>
      )}
      {contents.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {contents.map((c) => {
            const p = productById.get(c.component_product_id);
            return (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="font-mono text-xs w-10 shrink-0 text-right">{Number(c.quantity)}×</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-mono text-xs text-muted-foreground">{p?.sku ?? "—"}</span>{" "}
                  {p?.name ?? "Unknown product"}
                </span>
                <button
                  type="button"
                  disabled={busy === c.id}
                  onClick={() => remove(c)}
                  className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {adding && (
        <div className="rounded-md border border-border bg-background p-3 space-y-2">
          {!chosen ? (
            <>
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search the component by name or SKU…"
                className="block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {candidates.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border">
                  {candidates.map((p) => (
                    <button key={p.id} type="button" onClick={() => setComponentId(p.id)} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent">
                      <span className="font-mono text-xs text-muted-foreground">{p.sku ?? "—"}</span> {p.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-mono text-xs text-muted-foreground">{chosen.sku ?? "—"}</span> {chosen.name}
              </span>
              <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                Qty
                <input
                  type="number"
                  min={1}
                  step="1"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="w-16 rounded-md border border-border bg-input px-2 py-1 text-sm text-foreground"
                />
              </label>
              <button type="button" onClick={() => setComponentId("")} className="text-xs text-muted-foreground hover:text-foreground">
                Change
              </button>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setAdding(false); setSearch(""); setComponentId(""); }}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!chosen || busy === "new"}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy === "new" ? "Saving…" : "Add to kit"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
