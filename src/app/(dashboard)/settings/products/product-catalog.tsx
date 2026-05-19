"use client";

import { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { PRODUCT_CATEGORIES, DEVICE_TYPES } from "@/lib/quote-engine";
import { RowXeroSyncButton } from "./row-xero-sync-button";

interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  supplier: string;
  supplier_id: string | null;
  cost_price: number;
  markup: number;
  sell_price: number;
  device_type: string | null;
  scope_role: string | null;
  labour_code: string | null;
  description: string | null;
  default_quantity: number;
  internal_notes: string | null;
  image_url: string | null;
  requires_cable_run: boolean;
  is_default: boolean;
  is_active: boolean;
}

interface Supplier {
  id: string;
  name: string;
}

interface ScopeRoleOption {
  slug: string;
  label: string;
}

interface LabourTimingOption {
  code: string;
  name: string;
}

const inputClass = "block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function ProductCatalog({
  products,
  suppliers,
  scopeRoles,
  labourTimings,
}: {
  products: Product[];
  suppliers: Supplier[];
  scopeRoles: ScopeRoleOption[];
  labourTimings: LabourTimingOption[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [taggingFilter, setTaggingFilter] = useState<"" | "untagged_any" | "untagged_scope" | "untagged_labour">("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [groupMode, setGroupMode] = useState<"category" | "supplier">("category");
  const [sendingRfqSupplierId, setSendingRfqSupplierId] = useState<string | null>(null);
  // Per-supplier RFQ selection. Empty set = "send all active" (legacy behaviour).
  // Map: supplier_id → Set of selected product ids.
  const [rfqSelections, setRfqSelections] = useState<Map<string, Set<string>>>(new Map());
  const [costEdits, setCostEdits] = useState<Record<string, string>>({});

  // Local copies of picker options so inline-create flows can extend them
  // immediately without waiting for a router.refresh round trip.
  const [scopeRolesLocal, setScopeRolesLocal] = useState(scopeRoles);
  const [labourTimingsLocal, setLabourTimingsLocal] = useState(labourTimings);
  useEffect(() => { setScopeRolesLocal(scopeRoles); }, [scopeRoles]);
  useEffect(() => { setLabourTimingsLocal(labourTimings); }, [labourTimings]);

  // Defensive client-side sort so the picker is always alphabetical
  // regardless of what the server returns.
  const sortedScopeRoles = useMemo(
    () => [...scopeRolesLocal].sort((a, b) => a.label.localeCompare(b.label)),
    [scopeRolesLocal]
  );
  const sortedLabourTimings = useMemo(
    () => [...labourTimingsLocal].sort((a, b) => a.name.localeCompare(b.name)),
    [labourTimingsLocal]
  );
  const sortedSuppliers = useMemo(
    () => [...suppliers].sort((a, b) => a.name.localeCompare(b.name)),
    [suppliers]
  );

  const filtered = useMemo(() => {
    let list = products;
    if (!showInactive) list = list.filter((p) => p.is_active);
    if (categoryFilter) list = list.filter((p) => p.category === categoryFilter);
    if (taggingFilter === "untagged_any") {
      list = list.filter((p) => !p.scope_role || !p.labour_code);
    } else if (taggingFilter === "untagged_scope") {
      list = list.filter((p) => !p.scope_role);
    } else if (taggingFilter === "untagged_labour") {
      list = list.filter((p) => !p.labour_code);
    }
    if (search.length >= 2) {
      const q = search.toLowerCase();
      list = list.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.supplier.toLowerCase().includes(q)
      );
    }
    return list;
  }, [products, search, categoryFilter, showInactive, taggingFilter]);

  // Tagging stats — only counts active products since inactive ones don't appear on quotes
  const taggingStats = useMemo(() => {
    const active = products.filter((p) => p.is_active);
    return {
      total: active.length,
      untaggedScope: active.filter((p) => !p.scope_role).length,
      untaggedLabour: active.filter((p) => !p.labour_code).length,
      untaggedAny: active.filter((p) => !p.scope_role || !p.labour_code).length,
    };
  }, [products]);

  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const cat of PRODUCT_CATEGORIES) {
      map.set(cat, []);
    }
    for (const p of filtered) {
      const list = map.get(p.category) ?? [];
      list.push(p);
      map.set(p.category, list);
    }
    return map;
  }, [filtered]);

  const supplierGrouped = useMemo(() => {
    type Group = { supplierId: string | null; supplierName: string; items: Product[] };
    const map = new Map<string, Group>();
    for (const p of filtered) {
      const key = p.supplier_id ?? "__unassigned__";
      const existing = map.get(key);
      if (existing) {
        existing.items.push(p);
      } else {
        map.set(key, {
          supplierId: p.supplier_id,
          supplierName: p.supplier?.trim() || "— Unassigned —",
          items: [p],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.supplierId === null) return 1;
      if (b.supplierId === null) return -1;
      return a.supplierName.localeCompare(b.supplierName);
    });
  }, [filtered]);

  async function sendSupplierRfq(supplierId: string, supplierName: string) {
    const selected = rfqSelections.get(supplierId);
    const productIds = selected && selected.size > 0 ? Array.from(selected) : undefined;
    setSendingRfqSupplierId(supplierId);
    try {
      const res = await fetch(`/api/suppliers/${supplierId}/rfq`, {
        method: "POST",
        headers: productIds ? { "Content-Type": "application/json" } : undefined,
        body: productIds ? JSON.stringify({ productIds }) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(json.error ?? "RFQ send failed", "error");
        return;
      }
      toast(`RFQ sent to ${supplierName} (${json.lineCount} line${json.lineCount === 1 ? "" : "s"})`);
      // Clear the selection for that supplier after a successful send.
      setRfqSelections((prev) => {
        const next = new Map(prev);
        next.delete(supplierId);
        return next;
      });
    } finally {
      setSendingRfqSupplierId(null);
    }
  }

  function toggleRfqSelection(supplierId: string, productId: string) {
    setRfqSelections((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(supplierId) ?? []);
      if (set.has(productId)) set.delete(productId);
      else set.add(productId);
      if (set.size === 0) next.delete(supplierId);
      else next.set(supplierId, set);
      return next;
    });
  }

  function setRfqSelectAll(supplierId: string, productIds: string[], on: boolean) {
    setRfqSelections((prev) => {
      const next = new Map(prev);
      if (on) next.set(supplierId, new Set(productIds));
      else next.delete(supplierId);
      return next;
    });
  }

  async function saveCostInline(productId: string) {
    const raw = costEdits[productId];
    if (raw === undefined) return;
    const parsed = Number(raw);
    if (Number.isNaN(parsed) || parsed < 0) {
      toast("Invalid cost", "error");
      return;
    }
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    if (parsed === Number(product.cost_price)) {
      // No actual change — drop the edit and don't fire a request.
      setCostEdits((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
      return;
    }
    const newSell = Number((parsed * (1 + Number(product.markup ?? 0))).toFixed(2));
    const { error } = await supabase
      .from("quote_products")
      .update({ cost_price: parsed, sell_price: newSell, cost_updated_at: new Date().toISOString() })
      .eq("id", productId);
    if (error) {
      toast(error.message, "error");
      return;
    }
    setCostEdits((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    router.refresh();
  }

  async function updateProduct(id: string, updates: Partial<Product>) {
    const { error } = await supabase.from("quote_products").update(updates).eq("id", id);
    if (error) {
      toast(error.message, "error");
    } else {
      toast("Product updated");
      setEditingId(null);
      router.refresh();
    }
  }

  async function toggleActive(id: string, currentActive: boolean) {
    await updateProduct(id, { is_active: !currentActive });
  }

  const [seedingSuppliers, setSeedingSuppliers] = useState(false);

  async function seedSuppliersFromProducts() {
    setSeedingSuppliers(true);
    try {
      const { data: allProducts } = await supabase
        .from("quote_products")
        .select("id, supplier, supplier_id");

      if (!allProducts) { toast("No products found", "error"); setSeedingSuppliers(false); return; }

      const uniqueNames = [...new Set(
        allProducts.map(p => p.supplier?.trim()).filter((s): s is string => !!s && s.length > 0)
      )];

      const { data: existingSuppliers } = await supabase.from("suppliers").select("id, name");
      const existingMap = new Map((existingSuppliers ?? []).map(s => [s.name.toLowerCase().trim(), s.id]));

      const toInsert = uniqueNames.filter(name => !existingMap.has(name.toLowerCase().trim()));
      let created = 0;

      if (toInsert.length > 0) {
        const { data: newSuppliers, error } = await supabase
          .from("suppliers")
          .insert(toInsert.map(name => ({ name, is_active: true })))
          .select("id, name");

        if (error) { toast(error.message, "error"); setSeedingSuppliers(false); return; }
        created = newSuppliers?.length ?? 0;
        for (const s of newSuppliers ?? []) {
          existingMap.set(s.name.toLowerCase().trim(), s.id);
        }
      }

      let linked = 0;
      for (const product of allProducts) {
        if (product.supplier_id) continue;
        const supplierName = product.supplier?.trim();
        if (!supplierName) continue;
        const supplierId = existingMap.get(supplierName.toLowerCase().trim());
        if (!supplierId) continue;
        const { error } = await supabase.from("quote_products").update({ supplier_id: supplierId }).eq("id", product.id);
        if (!error) linked++;
      }

      toast(`${created} suppliers created, ${linked} products linked`);
      router.refresh();
    } catch (err: any) {
      toast(err.message, "error");
    }
    setSeedingSuppliers(false);
  }

  async function handleScopeRoleCreated(role: ScopeRoleOption) {
    setScopeRolesLocal((prev) => [...prev, role]);
    router.refresh();
  }

  async function handleLabourTimingCreated(timing: LabourTimingOption) {
    setLabourTimingsLocal((prev) => [...prev, timing]);
    router.refresh();
  }

  return (
    <div>
      {/* Tagging audit banner — shown when there are untagged products */}
      {taggingStats.untaggedAny > 0 && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-400">
                {taggingStats.untaggedAny} active product{taggingStats.untaggedAny === 1 ? "" : "s"} need{taggingStats.untaggedAny === 1 ? "s" : ""} tagging
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {taggingStats.untaggedScope} missing scope role · {taggingStats.untaggedLabour} missing labour code. Untagged products fall into "Additional items" on the SoW and skip labour calculation.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <button onClick={() => setTaggingFilter("untagged_any")} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${taggingFilter === "untagged_any" ? "bg-amber-500 text-amber-950" : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"}`}>Show all untagged</button>
              <button onClick={() => setTaggingFilter("untagged_scope")} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${taggingFilter === "untagged_scope" ? "bg-amber-500 text-amber-950" : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"}`}>Missing scope only</button>
              <button onClick={() => setTaggingFilter("untagged_labour")} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${taggingFilter === "untagged_labour" ? "bg-amber-500 text-amber-950" : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"}`}>Missing labour only</button>
              {taggingFilter && (
                <button onClick={() => setTaggingFilter("")} className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">Clear</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputClass} flex-1 min-w-[200px]`}
        />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={inputClass + " w-auto"}>
          <option value="">All Categories</option>
          {PRODUCT_CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <button
            type="button"
            onClick={() => setShowInactive(!showInactive)}
            className={`relative h-5 w-9 rounded-full transition-colors ${showInactive ? "bg-primary" : "bg-muted"}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${showInactive ? "left-[18px]" : "left-0.5"}`} />
          </button>
          Show inactive
        </label>
        <div className="flex items-center rounded-md border border-border p-0.5">
          <button
            type="button"
            onClick={() => setGroupMode("category")}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              groupMode === "category"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            By Infrastructure
          </button>
          <button
            type="button"
            onClick={() => setGroupMode("supplier")}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              groupMode === "supplier"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            By Supplier
          </button>
        </div>
        <button
          onClick={seedSuppliersFromProducts}
          disabled={seedingSuppliers}
          className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/10 disabled:opacity-50"
        >
          {seedingSuppliers ? "Seeding..." : "Sync Suppliers"}
        </button>
      </div>

      <p className="text-xs text-muted-foreground mb-4">{filtered.length} products{taggingFilter ? ` (filtered to untagged)` : ""}</p>

      {/* Category groups */}
      {groupMode === "category" && Array.from(grouped).map(([category, items]) => {
        if (!categoryFilter && items.length === 0) return null;

        return (
          <div key={category} className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{category} ({items.length})</h3>
              <button
                onClick={() => setAddingToCategory(category)}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
              >
                <span className="text-sm leading-none">+</span> Add Product
              </button>
            </div>

            {items.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Product</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden md:table-cell">SKU</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden lg:table-cell">Supplier</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Cost</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Markup</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Sell</th>
                      <th className="px-3 py-2 text-center font-medium text-muted-foreground hidden sm:table-cell">Default</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground w-24"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p) => (
                        <tr key={p.id} className={`border-b border-border last:border-0 ${!p.is_active ? "opacity-40" : ""}`}>
                          <td className="px-3 py-2">
                            <div className="flex items-start gap-2">
                              {p.image_url ? (
                                <img src={p.image_url} alt="" className="h-9 w-9 rounded border border-border object-contain bg-card shrink-0" />
                              ) : (
                                <div className="h-9 w-9 rounded border border-dashed border-border bg-card shrink-0 flex items-center justify-center text-[9px] text-muted-foreground/40">no img</div>
                              )}
                              <div className="min-w-0">
                            <span className="text-sm">{p.name}</span>
                            {p.device_type && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{p.device_type}</span>}
                            {p.scope_role ? (
                              <span className="ml-1.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400" title="Scope role — drives SoW placement">
                                {scopeRolesLocal.find(r => r.slug === p.scope_role)?.label ?? p.scope_role}
                              </span>
                            ) : (
                              <span className="ml-1.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400" title="Missing scope role — will land in Miscellaneous on quotes">
                                ⚠ no scope
                              </span>
                            )}
                            {p.labour_code ? (
                              <span className="ml-1.5 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400" title="Labour code — drives labour calculation">
                                {labourTimingsLocal.find(t => t.code === p.labour_code)?.name ?? p.labour_code}
                              </span>
                            ) : (
                              <span className="ml-1.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400" title="Missing labour code — won't add labour minutes on quotes">
                                ⚠ no labour
                              </span>
                            )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground font-mono hidden md:table-cell">{p.sku || "—"}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground hidden lg:table-cell">{p.supplier}</td>
                          <td className="px-3 py-2 text-right text-xs font-mono">${p.cost_price.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right text-xs font-mono text-muted-foreground">{(p.markup * 100).toFixed(0)}%</td>
                          <td className="px-3 py-2 text-right text-xs font-mono">${p.sell_price.toFixed(2)}</td>
                          <td className="px-3 py-2 text-center hidden sm:table-cell">
                            {p.is_default && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">Default</span>}
                          </td>
                          <td className="px-3 py-2 text-right space-x-2">
                            <button onClick={() => setEditingId(p.id)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Edit</button>
                            <RowXeroSyncButton productId={p.id} hasSku={!!p.sku && p.sku.trim() !== ""} />
                            <button onClick={() => toggleActive(p.id, p.is_active)} className={`text-xs transition-colors ${p.is_active ? "text-muted-foreground hover:text-red-400" : "text-emerald-500 hover:text-emerald-400"}`}>
                              {p.is_active ? "Deactivate" : "Activate"}
                            </button>
                          </td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {/* Supplier groups */}
      {groupMode === "supplier" && (
        <>
          <div className="mb-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Monthly RFQ workflow: hit <strong className="text-foreground">Send RFQ</strong> per supplier to email every active product. Tick rows to send a hand-picked subset instead — the button label updates with the count. Bulk-update cost prices inline as replies come in; sell prices auto-recalc from each product&apos;s markup.
          </div>
          {supplierGrouped.map((group) => {
            const groupKey = group.supplierId ?? "__unassigned__";
            const sending = sendingRfqSupplierId === group.supplierId;
            const supplierId = group.supplierId;
            const activeProductIds = group.items.filter((p) => p.is_active).map((p) => p.id);
            const selectedSet = (supplierId && rfqSelections.get(supplierId)) || new Set<string>();
            const selectedCount = selectedSet.size;
            const allSelected = selectedCount > 0 && selectedCount === activeProductIds.length;
            const sendLabel = selectedCount > 0
              ? `Send RFQ (${selectedCount} selected)`
              : `Send RFQ (all ${activeProductIds.length})`;
            return (
              <div key={groupKey} className="mb-6">
                <div className="flex items-center justify-between mb-2 gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.supplierName} ({group.items.length})
                  </h3>
                  {supplierId && (
                    <div className="flex items-center gap-2">
                      {selectedCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setRfqSelectAll(supplierId, activeProductIds, false)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Clear
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => sendSupplierRfq(supplierId, group.supplierName)}
                        disabled={sending || activeProductIds.length === 0}
                        className="rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
                        title={selectedCount > 0
                          ? `Email ${group.supplierName} asking for refreshed pricing on the ${selectedCount} selected product${selectedCount === 1 ? "" : "s"}`
                          : `Email ${group.supplierName} asking for refreshed pricing on every active product we have from them`}
                      >
                        {sending ? "Sending RFQ…" : sendLabel}
                      </button>
                    </div>
                  )}
                </div>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        {supplierId && (
                          <th className="px-2 py-2 w-8 text-center">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              onChange={(e) => setRfqSelectAll(supplierId, activeProductIds, e.target.checked)}
                              className="rounded border-border accent-primary"
                              title="Select all active products in this supplier group"
                            />
                          </th>
                        )}
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Product</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden md:table-cell">SKU</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden lg:table-cell">Category</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground w-32">Cost (ex-GST)</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Markup</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Sell</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground w-20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((p) => {
                        const editValue = costEdits[p.id];
                        const dirty = editValue !== undefined && Number(editValue) !== Number(p.cost_price);
                        const isChecked = supplierId ? selectedSet.has(p.id) : false;
                        return (
                          <tr key={p.id} className={`border-b border-border last:border-0 ${!p.is_active ? "opacity-40" : ""}`}>
                            {supplierId && (
                              <td className="px-2 py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={!p.is_active}
                                  onChange={() => toggleRfqSelection(supplierId, p.id)}
                                  className="rounded border-border accent-primary"
                                  title={p.is_active ? "Include in RFQ send" : "Inactive product — activate to include"}
                                />
                              </td>
                            )}
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                {p.image_url ? (
                                  <img src={p.image_url} alt="" className="h-8 w-8 rounded border border-border object-contain bg-card shrink-0" />
                                ) : null}
                                <span>{p.name}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground font-mono hidden md:table-cell">{p.sku || "—"}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground hidden lg:table-cell">{p.category}</td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={editValue ?? p.cost_price.toFixed(2)}
                                onChange={(e) =>
                                  setCostEdits((prev) => ({ ...prev, [p.id]: e.target.value }))
                                }
                                onBlur={() => saveCostInline(p.id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    (e.target as HTMLInputElement).blur();
                                  }
                                }}
                                className={`w-24 rounded-md border bg-input px-2 py-1 text-right text-xs font-mono focus:outline-none focus:ring-1 ${
                                  dirty
                                    ? "border-amber-500/40 ring-amber-500/30"
                                    : "border-border focus:border-primary focus:ring-primary"
                                }`}
                              />
                            </td>
                            <td className="px-3 py-2 text-right text-xs font-mono text-muted-foreground">{(p.markup * 100).toFixed(0)}%</td>
                            <td className="px-3 py-2 text-right text-xs font-mono">${p.sell_price.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right">
                              <button
                                onClick={() => setEditingId(p.id)}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Add modal */}
      {addingToCategory && (
        <ProductFormModal
          mode="create"
          category={addingToCategory}
          suppliers={sortedSuppliers}
          scopeRoles={sortedScopeRoles}
          labourTimings={sortedLabourTimings}
          onScopeRoleCreated={handleScopeRoleCreated}
          onLabourTimingCreated={handleLabourTimingCreated}
          onClose={() => setAddingToCategory(null)}
          onSaved={() => { setAddingToCategory(null); router.refresh(); }}
        />
      )}

      {/* Edit modal */}
      {editingId && (() => {
        const product = products.find((p) => p.id === editingId);
        if (!product) return null;
        return (
          <ProductFormModal
            mode="edit"
            product={product}
            suppliers={sortedSuppliers}
            scopeRoles={sortedScopeRoles}
            labourTimings={sortedLabourTimings}
            onScopeRoleCreated={handleScopeRoleCreated}
            onLabourTimingCreated={handleLabourTimingCreated}
            onClose={() => setEditingId(null)}
            onSave={updateProduct}
          />
        );
      })()}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   ProductFormModal — single component for both create + edit.
   - mode="create": needs `category` + `onSaved`
   - mode="edit":   needs `product`  + `onSave`
   ───────────────────────────────────────────────────────────────────────── */
type ProductFormModalProps =
  | {
      mode: "create";
      category: string;
      suppliers: Supplier[];
      scopeRoles: ScopeRoleOption[];
      labourTimings: LabourTimingOption[];
      onScopeRoleCreated: (role: ScopeRoleOption) => void;
      onLabourTimingCreated: (timing: LabourTimingOption) => void;
      onClose: () => void;
      onSaved: () => void;
      product?: never;
      onSave?: never;
    }
  | {
      mode: "edit";
      product: Product;
      suppliers: Supplier[];
      scopeRoles: ScopeRoleOption[];
      labourTimings: LabourTimingOption[];
      onScopeRoleCreated: (role: ScopeRoleOption) => void;
      onLabourTimingCreated: (timing: LabourTimingOption) => void;
      onClose: () => void;
      onSave: (id: string, updates: Partial<Product>) => void;
      category?: never;
      onSaved?: never;
    };

function ProductFormModal(props: ProductFormModalProps) {
  const supabase = createClient();
  const { toast } = useToast();
  const isEditing = props.mode === "edit";
  const category = isEditing ? props.product.category : props.category;
  const headerTitle = isEditing ? "Edit product" : "Add product";

  const [name, setName] = useState(isEditing ? props.product.name : "");
  const [sku, setSku] = useState(isEditing ? (props.product.sku || "") : "");
  const [supplierId, setSupplierId] = useState(isEditing ? (props.product.supplier_id || "") : "");
  const [costPrice, setCostPrice] = useState(isEditing ? props.product.cost_price.toString() : "");
  const [markup, setMarkup] = useState(isEditing ? props.product.markup.toString() : "0.50");
  const [deviceType, setDeviceType] = useState(isEditing ? (props.product.device_type || "") : "");
  const [scopeRole, setScopeRole] = useState(isEditing ? (props.product.scope_role || "") : "");
  const [labourCode, setLabourCode] = useState(isEditing ? (props.product.labour_code || "") : "");
  const [description, setDescription] = useState(isEditing ? (props.product.description || "") : "");
  const [defaultQuantity, setDefaultQuantity] = useState(isEditing ? props.product.default_quantity.toString() : "1");
  const [internalNotes, setInternalNotes] = useState(isEditing ? (props.product.internal_notes || "") : "");
  const [isDefault, setIsDefault] = useState(isEditing ? props.product.is_default : false);
  const [imageUrl, setImageUrl] = useState(isEditing ? (props.product.image_url || "") : "");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [requiresCableRun, setRequiresCableRun] = useState(isEditing ? props.product.requires_cable_run : false);
  const [saving, setSaving] = useState(false);

  const [showNewScopeRole, setShowNewScopeRole] = useState(false);
  const [showNewLabourCode, setShowNewLabourCode] = useState(false);

  async function handleImageUpload(file: File | null) {
    if (!file) return;
    setUploadingImage(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const key = `${(isEditing ? props.product.id : crypto.randomUUID())}.${ext}`;
      const { error } = await supabase.storage.from('product-images').upload(key, file, { upsert: true, contentType: file.type });
      if (error) { toast(error.message, "error"); return; }
      const { data } = supabase.storage.from('product-images').getPublicUrl(key);
      setImageUrl(data.publicUrl);
      toast('Image uploaded');
    } finally {
      setUploadingImage(false);
    }
  }

  const categoryDevices = DEVICE_TYPES.filter(d => d.category === category);
  const sellPreview = (parseFloat(costPrice || "0") * (1 + parseFloat(markup || "0.5"))).toFixed(2);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") props.onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !costPrice) return;
    if (!scopeRole) {
      toast("Pick a scope role (use 'None / consumable' for accessories or items with no SoW representation)", "error");
      return;
    }
    if (!labourCode) {
      toast("Pick a labour code (use 'None / no separate labour' for items that don't add labour minutes)", "error");
      return;
    }

    const qty = parseInt(defaultQuantity);
    const selectedSupplier = props.suppliers.find(s => s.id === supplierId);
    const payload = {
      name: name.trim(),
      sku: sku.trim() || (isEditing ? "" : null),
      supplier: selectedSupplier?.name || (isEditing ? props.product.supplier : "Unknown"),
      supplier_id: supplierId || null,
      cost_price: parseFloat(costPrice),
      markup: parseFloat(markup),
      device_type: deviceType || null,
      scope_role: scopeRole || null,
      labour_code: labourCode || null,
      image_url: imageUrl || null,
      requires_cable_run: requiresCableRun,
      description: description.trim() || null,
      default_quantity: isNaN(qty) || qty < 1 ? 1 : qty,
      internal_notes: internalNotes.trim() || null,
      is_default: isDefault,
    };

    if (isEditing) {
      props.onSave(props.product.id, payload as Partial<Product>);
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("quote_products").insert({
      ...payload,
      category,
      is_active: true,
    });
    setSaving(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    toast("Product added");
    props.onSaved();
  }

  if (!mounted) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm pointer-events-none" />
      <form
        onSubmit={handleSubmit}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative w-full max-w-[680px] max-h-[92dvh] overflow-y-auto rounded-xl bg-background border border-border shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{category}</p>
            <h2 className="text-base font-semibold text-foreground truncate">{headerTitle}</h2>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Image + Name + SKU */}
          <div className="flex gap-3">
            {/* Image thumbnail + upload */}
            <div className="shrink-0">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Image</label>
              <label className={`relative block h-[68px] w-[68px] rounded-md border ${imageUrl ? "border-border" : "border-dashed border-border"} bg-card cursor-pointer hover:border-primary transition-colors overflow-hidden`}>
                {imageUrl ? (
                  <img src={imageUrl} alt="" className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground/60 text-center px-1">
                    {uploadingImage ? "..." : "+ image"}
                  </div>
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => handleImageUpload(e.target.files?.[0] ?? null)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </label>
              {imageUrl && (
                <button type="button" onClick={() => setImageUrl("")} className="mt-1 block w-full text-[9px] text-muted-foreground hover:text-destructive transition-colors">Remove</button>
              )}
            </div>
            {/* Name + SKU */}
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-muted-foreground mb-1">Name *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus={!isEditing} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">SKU</label>
                <input value={sku} onChange={(e) => setSku(e.target.value)} className={inputClass} />
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Description
              <span className="ml-1 font-normal text-muted-foreground/60">— shown on the quote line / SoW</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className={`${inputClass} resize-none`}
              placeholder="e.g. 4MP IP turret with IR + microphone"
            />
          </div>

          {/* Cost / markup / sell */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Cost price *</label>
              <input type="number" step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} required className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Markup</label>
              <select value={markup} onChange={(e) => setMarkup(e.target.value)} className={inputClass}>
                <option value="0.25">25%</option>
                <option value="0.50">50%</option>
                <option value="0.75">75%</option>
                <option value="1.00">100%</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Sell price</label>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-mono text-foreground">${sellPreview}</div>
            </div>
          </div>

          {/* Supplier + Default qty */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Supplier</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputClass}>
                <option value="">Select supplier...</option>
                {props.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Default quantity
                <span className="ml-1 font-normal text-muted-foreground/60">— pre-fills BOM line qty</span>
              </label>
              <input
                type="number"
                min={1}
                value={defaultQuantity}
                onChange={(e) => setDefaultQuantity(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          {/* Device type (only for categories with device options) */}
          {categoryDevices.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Device type</label>
              <select value={deviceType} onChange={(e) => setDeviceType(e.target.value)} className={inputClass}>
                <option value="">None (ancillary)</option>
                {categoryDevices.map(d => <option key={d.code} value={d.code}>{d.legend}</option>)}
              </select>
            </div>
          )}

          {/* Scope role with inline create */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Scope role <span className="text-destructive">*</span>
                <span className="ml-1 font-normal text-muted-foreground/60">— drives where this product appears in the SoW</span>
              </label>
              <button
                type="button"
                onClick={() => setShowNewScopeRole((v) => !v)}
                className="text-[11px] text-primary hover:text-primary/80 transition-colors"
              >
                {showNewScopeRole ? "Cancel" : "+ New"}
              </button>
            </div>
            <select value={scopeRole} onChange={(e) => setScopeRole(e.target.value)} required className={inputClass}>
              <option value="">— pick one —</option>
              {props.scopeRoles.map(r => <option key={r.slug} value={r.slug}>{r.label}</option>)}
            </select>
            {showNewScopeRole && (
              <NewScopeRoleInline
                onCreated={(role) => {
                  props.onScopeRoleCreated(role);
                  setScopeRole(role.slug);
                  setShowNewScopeRole(false);
                }}
                onCancel={() => setShowNewScopeRole(false)}
              />
            )}
          </div>

          {/* Labour code with inline create */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Labour code <span className="text-destructive">*</span>
                <span className="ml-1 font-normal text-muted-foreground/60">— links to labour timings for fit-off minutes</span>
              </label>
              <button
                type="button"
                onClick={() => setShowNewLabourCode((v) => !v)}
                className="text-[11px] text-primary hover:text-primary/80 transition-colors"
              >
                {showNewLabourCode ? "Cancel" : "+ New"}
              </button>
            </div>
            <select value={labourCode} onChange={(e) => setLabourCode(e.target.value)} required className={inputClass}>
              <option value="">— pick one —</option>
              {props.labourTimings.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
            </select>
            {showNewLabourCode && (
              <NewLabourTimingInline
                onCreated={(timing) => {
                  props.onLabourTimingCreated(timing);
                  setLabourCode(timing.code);
                  setShowNewLabourCode(false);
                }}
                onCancel={() => setShowNewLabourCode(false)}
              />
            )}
          </div>

          {/* Cable run flag */}
          <label className="flex items-start gap-2 text-xs cursor-pointer select-none rounded-md border border-border bg-card px-3 py-2.5">
            <input
              type="checkbox"
              checked={requiresCableRun}
              onChange={(e) => setRequiresCableRun(e.target.checked)}
              className="mt-0.5 rounded border-border accent-primary"
            />
            <span>
              <span className="font-medium text-foreground">Needs a cable run</span>
              <span className="block text-muted-foreground/80 mt-0.5">Tick when this product is physically wired back to the head-end (cameras, PIRs, speakers, WAPs, etc.). Each unit on a quote contributes 1 run to the rough-in cable pulling labour line.</span>
            </span>
          </label>

          {/* Internal notes */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Internal notes
              <span className="ml-1 font-normal text-muted-foreground/60">— staff-only (not shown to customers)</span>
            </label>
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={2}
              className={`${inputClass} resize-none`}
              placeholder="e.g. Stock issue with Anson Q1 — allow 2 weeks lead time"
            />
          </div>

          {/* Default toggle */}
          <label className="flex items-center gap-2 text-xs cursor-pointer pt-1 select-none">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded border-border accent-primary"
            />
            <span>Default product for this device type</span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4 bg-muted/30">
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-md border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary px-5 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : isEditing ? "Save changes" : "Add product"}
          </button>
        </div>
      </form>
    </div>
  );

  return createPortal(modal, document.body);
}

/* ── Inline create: Scope Role ── */
function NewScopeRoleInline({
  onCreated,
  onCancel,
}: {
  onCreated: (role: ScopeRoleOption) => void;
  onCancel: () => void;
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  function onLabelChange(v: string) {
    setLabel(v);
    if (!slugDirty) setSlug(slugify(v));
  }

  async function submit() {
    const finalLabel = label.trim();
    const finalSlug = (slug.trim() || slugify(finalLabel));
    if (!finalLabel || !finalSlug) {
      toast("Label is required", "error");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("quote_scope_roles")
      .insert({ label: finalLabel, slug: finalSlug, sort_order: 100 });
    setBusy(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    toast("Scope role created");
    onCreated({ slug: finalSlug, label: finalLabel });
  }

  return (
    <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input
          autoFocus
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder="Label (e.g. Smart Lock)"
          className={inputClass}
        />
        <input
          value={slug}
          onChange={(e) => { setSlug(e.target.value); setSlugDirty(true); }}
          placeholder="auto-derived slug"
          className={`${inputClass} font-mono text-xs`}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !label.trim()}
          className="text-[11px] font-semibold text-primary hover:text-primary/80 disabled:opacity-50 transition-colors"
        >
          {busy ? "Creating…" : "Create role"}
        </button>
      </div>
    </div>
  );
}

/* ── Inline create: Labour Timing ── */
function NewLabourTimingInline({
  onCreated,
  onCancel,
}: {
  onCreated: (timing: LabourTimingOption) => void;
  onCancel: () => void;
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeDirty, setCodeDirty] = useState(false);
  const [minutes, setMinutes] = useState("30");
  const [busy, setBusy] = useState(false);

  function onNameChange(v: string) {
    setName(v);
    if (!codeDirty) setCode(slugify(v));
  }

  async function submit() {
    const finalName = name.trim();
    const finalCode = (code.trim() || slugify(finalName));
    const mins = parseInt(minutes);
    if (!finalName || !finalCode) {
      toast("Name is required", "error");
      return;
    }
    if (isNaN(mins) || mins < 1 || mins > 999) {
      toast("Minutes must be 1–999", "error");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("labour_timings")
      .insert({ name: finalName, code: finalCode, minutes_per: mins, category: "fit_off", sort_order: 100 });
    setBusy(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    toast("Labour timing created");
    onCreated({ code: finalCode, name: finalName });
  }

  return (
    <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Name (e.g. Boom gate)"
          className={`${inputClass} sm:col-span-1`}
        />
        <input
          value={code}
          onChange={(e) => { setCode(e.target.value); setCodeDirty(true); }}
          placeholder="auto-derived code"
          className={`${inputClass} font-mono text-xs`}
        />
        <input
          type="number"
          min={1}
          max={999}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          placeholder="minutes"
          className={inputClass}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !name.trim()}
          className="text-[11px] font-semibold text-primary hover:text-primary/80 disabled:opacity-50 transition-colors"
        >
          {busy ? "Creating…" : "Create timing"}
        </button>
      </div>
    </div>
  );
}
