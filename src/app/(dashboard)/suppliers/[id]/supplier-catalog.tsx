"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

// One row of this supplier's catalogue: their SKU / item name / cost for one
// of our products (products-CONTEXT.md D12). Starring an offer makes it drive
// the product's quote pricing via the DB sync trigger.
interface CatalogOffer {
  id: string;
  product_id: string;
  supplier_sku: string | null;
  supplier_item_name: string | null;
  cost_price: number;
  cost_updated_at: string | null;
  is_preferred: boolean;
  product: {
    id: string;
    name: string;
    sku: string | null;
    category: string | null;
    image_url: string | null;
    is_active: boolean;
    markup: number;
    sell_price: number;
  } | null;
}

interface SupplierInfo {
  id: string;
  name: string;
  email: string | null;
  is_active: boolean;
}

const inputClass =
  "block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function SupplierCatalog({
  supplier,
  offers,
}: {
  supplier: SupplierInfo;
  offers: CatalogOffer[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [costEdits, setCostEdits] = useState<Record<string, string>>({});
  // RFQ selection: empty = send all active (monthly refresh); ticked rows
  // scope the send to a subset.
  const [rfqSelection, setRfqSelection] = useState<Set<string>>(new Set());
  const [sendingRfq, setSendingRfq] = useState(false);

  const rows = useMemo(() => {
    let list = offers.filter((o) => o.product);
    if (!showInactive) list = list.filter((o) => o.product!.is_active);
    if (search.length >= 2) {
      const q = search.toLowerCase();
      list = list.filter(
        (o) =>
          o.supplier_sku?.toLowerCase().includes(q) ||
          o.supplier_item_name?.toLowerCase().includes(q) ||
          o.product!.name.toLowerCase().includes(q) ||
          o.product!.sku?.toLowerCase().includes(q) ||
          o.product!.category?.toLowerCase().includes(q)
      );
    }
    return [...list].sort(
      (a, b) =>
        (a.product!.category ?? "").localeCompare(b.product!.category ?? "") ||
        a.product!.name.localeCompare(b.product!.name)
    );
  }, [offers, search, showInactive]);

  const activeProductIds = useMemo(
    () => offers.filter((o) => o.product?.is_active).map((o) => o.product_id),
    [offers]
  );
  const preferredCount = offers.filter((o) => o.is_preferred && o.product?.is_active).length;

  async function saveCost(offer: CatalogOffer) {
    const raw = costEdits[offer.id];
    if (raw == null || raw.trim() === "") return;
    const val = Number(raw);
    if (!Number.isFinite(val) || val < 0) {
      toast("Invalid cost", "error");
      return;
    }
    if (val === Number(offer.cost_price)) {
      setCostEdits((m) => {
        const n = { ...m };
        delete n[offer.id];
        return n;
      });
      return;
    }
    setBusyId(offer.id);
    const { error } = await supabase
      .from("product_supplier_offers")
      .update({ cost_price: val, cost_updated_at: new Date().toISOString() })
      .eq("id", offer.id);
    setBusyId(null);
    if (error) {
      toast(error.message, "error");
      return;
    }
    setCostEdits((m) => {
      const n = { ...m };
      delete n[offer.id];
      return n;
    });
    router.refresh();
  }

  async function setPreferred(offer: CatalogOffer) {
    if (offer.is_preferred) return;
    setBusyId(offer.id);
    const { error } = await supabase
      .from("product_supplier_offers")
      .update({ is_preferred: true })
      .eq("id", offer.id);
    setBusyId(null);
    if (error) {
      toast(error.message, "error");
      return;
    }
    toast(`${supplier.name} now prices ${offer.product?.name ?? "this product"}`);
    router.refresh();
  }

  async function sendRfq() {
    const selected = rfqSelection.size > 0 ? Array.from(rfqSelection) : undefined;
    const confirmMsg = selected
      ? `Send an RFQ email to ${supplier.name} for ${selected.length} selected product${selected.length === 1 ? "" : "s"}?`
      : `Send an RFQ email to ${supplier.name} for ALL ${activeProductIds.length} active products they offer? This emails the supplier their entire list.`;
    if (!confirm(confirmMsg)) return;
    setSendingRfq(true);
    try {
      const res = await fetch(`/api/suppliers/${supplier.id}/rfq`, {
        method: "POST",
        headers: selected ? { "Content-Type": "application/json" } : undefined,
        body: selected ? JSON.stringify({ productIds: selected }) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(json.error ?? "RFQ send failed", "error");
        return;
      }
      toast(`RFQ sent to ${supplier.name} (${json.lineCount} line${json.lineCount === 1 ? "" : "s"})`);
      setRfqSelection(new Set());
    } finally {
      setSendingRfq(false);
    }
  }

  function toggleSelection(productId: string) {
    setRfqSelection((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  const visibleActiveIds = rows.filter((o) => o.product!.is_active).map((o) => o.product_id);
  const allVisibleSelected =
    visibleActiveIds.length > 0 && visibleActiveIds.every((id) => rfqSelection.has(id));

  const sendLabel =
    rfqSelection.size > 0
      ? `Send RFQ (${rfqSelection.size} selected)`
      : `Send RFQ (all ${activeProductIds.length})`;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder={`Search ${supplier.name}'s SKUs, item names, our products...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputClass} flex-1 min-w-[220px]`}
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-border"
          />
          Inactive products
        </label>
        <button
          type="button"
          onClick={sendRfq}
          disabled={sendingRfq || activeProductIds.length === 0 || !supplier.email || !supplier.is_active}
          title={
            !supplier.email
              ? `${supplier.name} has no email on file`
              : !supplier.is_active
                ? "Supplier is inactive"
                : rfqSelection.size > 0
                  ? `Email ${supplier.name} asking for refreshed pricing on the selected products`
                  : `Email ${supplier.name} asking for refreshed pricing on everything they offer`
          }
          className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors shrink-0"
        >
          {sendingRfq ? "Sending RFQ…" : sendLabel}
        </button>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        {rows.length} of {offers.length} products offered · preferred supplier on {preferredCount} ·
        cost edits save on blur; a ★ row&apos;s cost re-prices future quotes automatically
      </p>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-2 py-2 w-8 text-center">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(e) =>
                      setRfqSelection(e.target.checked ? new Set(visibleActiveIds) : new Set())
                    }
                    className="rounded border-border accent-primary"
                    title="Select all visible active products for the RFQ"
                  />
                </th>
                <th className="px-3 py-2 w-10 text-center" title="★ = this supplier prices the product on quotes and POs">★</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Product</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Their SKU</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden lg:table-cell">Their item name</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden lg:table-cell w-32">Category</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground w-28">Cost (ex-GST)</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground hidden sm:table-cell w-24">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const p = o.product!;
                const editValue = costEdits[o.id];
                const dirty = editValue !== undefined && Number(editValue) !== Number(o.cost_price);
                return (
                  <tr
                    key={o.id}
                    className={`border-b border-border last:border-0 ${!p.is_active ? "opacity-40" : ""}`}
                  >
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={rfqSelection.has(o.product_id)}
                        disabled={!p.is_active}
                        onChange={() => toggleSelection(o.product_id)}
                        className="rounded border-border accent-primary"
                        title={p.is_active ? "Include in RFQ send" : "Inactive product"}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => setPreferred(o)}
                        disabled={busyId === o.id}
                        title={
                          o.is_preferred
                            ? `Preferred — ${supplier.name} prices this product`
                            : `Make ${supplier.name} the preferred supplier for this product`
                        }
                        className={`text-sm transition-colors ${o.is_preferred ? "text-amber-400" : "text-muted-foreground/40 hover:text-amber-400"}`}
                      >
                        {o.is_preferred ? "★" : "☆"}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {p.image_url ? (
                          <img
                            src={p.image_url}
                            alt=""
                            className="h-8 w-8 rounded border border-border object-contain bg-card shrink-0"
                          />
                        ) : null}
                        <div className="min-w-0">
                          <span className="block truncate">{p.name}</span>
                          <span className="block text-[10px] font-mono text-muted-foreground">
                            {p.sku || "no SKU"}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-muted-foreground">
                      {o.supplier_sku || "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground hidden lg:table-cell truncate max-w-[280px]">
                      {o.supplier_item_name || "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground hidden lg:table-cell">
                      {p.category ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editValue ?? o.cost_price.toFixed(2)}
                        onChange={(e) => setCostEdits((m) => ({ ...m, [o.id]: e.target.value }))}
                        onBlur={() => saveCost(o)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        disabled={busyId === o.id}
                        className={`w-24 rounded-md border bg-input px-2 py-1 text-right text-xs font-mono focus:outline-none focus:ring-1 ${
                          dirty
                            ? "border-amber-500/40 ring-amber-500/30"
                            : "border-border focus:border-primary focus:ring-primary"
                        }`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-muted-foreground hidden sm:table-cell">
                      {o.cost_updated_at
                        ? new Date(o.cost_updated_at).toLocaleDateString("en-AU")
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {search
              ? "No offers matching your search."
              : `No products from ${supplier.name} yet — add offers from the product catalogue.`}
          </p>
          <Link
            href="/settings/products"
            className="mt-2 inline-block text-xs text-primary hover:text-primary/80 transition-colors"
          >
            Open product catalogue →
          </Link>
        </div>
      )}
    </div>
  );
}
