"use client";

import { Fragment, useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { PRODUCT_CATEGORIES, DEVICE_TYPES } from "@/lib/quote-engine";
import { RowXeroSyncButton } from "./row-xero-sync-button";

export interface ProductSubcategory {
  id: string;
  category: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  subcategory: string | null;
  supplier: string;
  supplier_id: string | null;
  cost_price: number;
  markup: number;
  sell_price: number;
  device_type: string | null;
  scope_role: string | null;
  labour_code: string | null;
  asset_type_id: string | null;
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

// One supplier's offer for a product (products-CONTEXT.md D1): their SKU,
// their item name, their cost. The preferred offer mirrors onto the product
// row via DB trigger, so flipping the star here re-prices future quotes.
export interface ProductOffer {
  id: string;
  product_id: string;
  supplier_id: string;
  supplier_sku: string | null;
  supplier_item_name: string | null;
  cost_price: number;
  cost_updated_at: string | null;
  is_preferred: boolean;
}

interface ScopeRoleOption {
  slug: string;
  label: string;
}

interface LabourTimingOption {
  code: string;
  name: string;
}

interface AssetTypeOption {
  id: string;
  name: string;
  category: string | null;
  has_serial: boolean;
  has_mac: boolean;
  has_ip: boolean;
  has_wifi: boolean;
  has_rfid: boolean;
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
  assetTypes,
  subcategories,
  offers = [],
}: {
  products: Product[];
  suppliers: Supplier[];
  scopeRoles: ScopeRoleOption[];
  labourTimings: LabourTimingOption[];
  assetTypes: AssetTypeOption[];
  subcategories: ProductSubcategory[];
  offers?: ProductOffer[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [taggingFilter, setTaggingFilter] = useState<"" | "untagged_any" | "untagged_scope" | "untagged_labour" | "untagged_asset">("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

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
  // Supplier names always come from the suppliers table via supplier_id —
  // never from the quote_products.supplier text column, which is a legacy
  // mirror the UI no longer trusts (products-CONTEXT.md D9).
  const suppliersById = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s.name])),
    [suppliers]
  );
  // Offers grouped per product, preferred first (server pre-sorts).
  const offersByProduct = useMemo(() => {
    const m = new Map<string, ProductOffer[]>();
    for (const o of offers) {
      const list = m.get(o.product_id) ?? [];
      list.push(o);
      m.set(o.product_id, list);
    }
    return m;
  }, [offers]);
  const [offersOpenId, setOffersOpenId] = useState<string | null>(null);
  // Inline asset-type tag — drives the BOM->assets import (only products mapped
  // to a trackable asset type become asset shells). Saves on change.
  async function saveAssetType(productId: string, assetTypeId: string) {
    const { error } = await supabase
      .from("quote_products")
      .update({ asset_type_id: assetTypeId || null })
      .eq("id", productId);
    if (error) toast(error.message, "error");
    else router.refresh();
  }

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
    } else if (taggingFilter === "untagged_asset") {
      list = list.filter((p) => !p.asset_type_id);
    }
    if (search.length >= 2) {
      const q = search.toLowerCase();
      // Offer-aware search (D10): a product matches on its own name/SKU, its
      // supplier's name, or ANY supplier offer's SKU / item name — so
      // searching e.g. a Seadan part number finds the product it maps to.
      list = list.filter((p) => {
        if (p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q)) return true;
        if (p.supplier_id && (suppliersById.get(p.supplier_id) ?? "").toLowerCase().includes(q)) return true;
        return (offersByProduct.get(p.id) ?? []).some(
          (o) =>
            o.supplier_sku?.toLowerCase().includes(q) ||
            o.supplier_item_name?.toLowerCase().includes(q) ||
            (suppliersById.get(o.supplier_id) ?? "").toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [products, search, categoryFilter, showInactive, taggingFilter, offersByProduct, suppliersById]);

  // When a search hit came via a supplier offer (not the product's own
  // name/SKU), surface which supplier + SKU matched so the result isn't a
  // mystery row.
  const offerMatchHints = useMemo(() => {
    const m = new Map<string, string>();
    if (search.length < 2) return m;
    const q = search.toLowerCase();
    for (const [pid, list] of offersByProduct) {
      const hit = list.find(
        (o) =>
          o.supplier_sku?.toLowerCase().includes(q) ||
          o.supplier_item_name?.toLowerCase().includes(q)
      );
      if (hit) {
        m.set(pid, `${suppliersById.get(hit.supplier_id) ?? "?"}: ${hit.supplier_sku || hit.supplier_item_name}`);
      }
    }
    return m;
  }, [search, offersByProduct, suppliersById]);

  // Tagging stats — only counts active products since inactive ones don't appear on quotes
  const taggingStats = useMemo(() => {
    const active = products.filter((p) => p.is_active);
    return {
      total: active.length,
      untaggedScope: active.filter((p) => !p.scope_role).length,
      untaggedLabour: active.filter((p) => !p.labour_code).length,
      untaggedAny: active.filter((p) => !p.scope_role || !p.labour_code).length,
      untaggedAsset: active.filter((p) => !p.asset_type_id).length,
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

  // category → (subcategory name lowercased → sort_order), for ordering the
  // sub-group headings within each infrastructure table.
  const subOrderByCat = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const s of subcategories) {
      if (!m.has(s.category)) m.set(s.category, new Map());
      m.get(s.category)!.set(s.name.toLowerCase(), s.sort_order);
    }
    return m;
  }, [subcategories]);

  // Active sub-categories for a given infrastructure, for the form dropdown.
  const activeSubsByCat = useMemo(() => {
    const m = new Map<string, ProductSubcategory[]>();
    for (const s of subcategories) {
      if (!s.is_active) continue;
      const list = m.get(s.category) ?? [];
      list.push(s);
      m.set(s.category, list);
    }
    for (const [, list] of m) list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    return m;
  }, [subcategories]);

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
      {(taggingStats.untaggedAny > 0 || taggingStats.untaggedAsset > 0) && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-400">
                Product tagging needs attention
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {taggingStats.untaggedScope} missing scope role · {taggingStats.untaggedLabour} missing labour code · {taggingStats.untaggedAsset} missing asset type. Scope/labour gaps affect the SoW + labour calc; an asset type lets the device flow into the BOM → assets import (leave cable/mounts blank).
              </p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <button onClick={() => setTaggingFilter("untagged_any")} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${taggingFilter === "untagged_any" ? "bg-amber-500 text-amber-950" : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"}`}>Show all untagged</button>
              <button onClick={() => setTaggingFilter("untagged_scope")} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${taggingFilter === "untagged_scope" ? "bg-amber-500 text-amber-950" : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"}`}>Missing scope only</button>
              <button onClick={() => setTaggingFilter("untagged_labour")} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${taggingFilter === "untagged_labour" ? "bg-amber-500 text-amber-950" : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"}`}>Missing labour only</button>
              <button onClick={() => setTaggingFilter("untagged_asset")} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${taggingFilter === "untagged_asset" ? "bg-amber-500 text-amber-950" : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"}`}>Missing asset type</button>
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
        <Link
          href="/suppliers"
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Per-supplier price lists, their SKUs, and the monthly RFQ workflow"
        >
          Supplier catalogues →
        </Link>
        <button
          onClick={() => setAddingToCategory("")}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <span className="text-base leading-none">+</span> Add Product
        </button>
      </div>

      <p className="text-xs text-muted-foreground mb-4">{filtered.length} products{taggingFilter ? ` (filtered to untagged)` : ""}</p>

      {/* Category groups */}
      {Array.from(grouped).map(([category, items]) => {
        if (!categoryFilter && items.length === 0) return null;

        // Sub-group the table by subcategory when any product in this
        // infrastructure is tagged. Untagged categories stay a flat list.
        const orderMap = subOrderByCat.get(category);
        const hasSubs = items.some((p) => p.subcategory);
        const sortedItems = hasSubs
          ? [...items].sort((a, b) => {
              const ra = a.subcategory ? (orderMap?.get(a.subcategory.toLowerCase()) ?? 500) : 9999;
              const rb = b.subcategory ? (orderMap?.get(b.subcategory.toLowerCase()) ?? 500) : 9999;
              return (
                ra - rb ||
                (a.subcategory ?? "").localeCompare(b.subcategory ?? "") ||
                a.name.localeCompare(b.name)
              );
            })
          : items;
        const subLeaders = new Set<string>();
        if (hasSubs) {
          let last: string | undefined;
          for (const p of sortedItems) {
            const sub = p.subcategory || "Uncategorised";
            if (sub !== last) {
              subLeaders.add(p.id);
              last = sub;
            }
          }
        }

        return (
          <div key={category} className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{category} ({items.length})</h3>
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
                    {sortedItems.map((p) => (
                      <Fragment key={p.id}>
                        {subLeaders.has(p.id) && (
                          <tr className="bg-muted/20">
                            <td colSpan={8} className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              {p.subcategory || "Uncategorised"}
                            </td>
                          </tr>
                        )}
                        <tr className={`border-b border-border last:border-0 ${!p.is_active ? "opacity-40" : ""}`}>
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
                          <td className="px-3 py-2 text-xs text-muted-foreground font-mono hidden md:table-cell">
                            {p.sku || "—"}
                            {offerMatchHints.has(p.id) && (
                              <span className="mt-0.5 block whitespace-nowrap font-sans text-[10px] text-primary/80" title="Your search matched this supplier's SKU / item name">
                                ↳ {offerMatchHints.get(p.id)}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground hidden lg:table-cell">
                            {(p.supplier_id && suppliersById.get(p.supplier_id)) || "—"}
                            {(offersByProduct.get(p.id)?.length ?? 0) > 1 && (
                              <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px]" title="Number of suppliers with pricing for this product">
                                +{(offersByProduct.get(p.id)!.length - 1)}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-xs font-mono">${p.cost_price.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right text-xs font-mono text-muted-foreground">{(p.markup * 100).toFixed(0)}%</td>
                          <td className="px-3 py-2 text-right text-xs font-mono">${p.sell_price.toFixed(2)}</td>
                          <td className="px-3 py-2 text-center hidden sm:table-cell">
                            {p.is_default && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">Default</span>}
                          </td>
                          <td className="px-3 py-2 text-right space-x-2">
                            <button
                              onClick={() => setOffersOpenId(offersOpenId === p.id ? null : p.id)}
                              className={`text-xs transition-colors ${offersOpenId === p.id ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                              title="Per-supplier pricing — star an offer to make it drive quotes"
                            >
                              Suppliers ({offersByProduct.get(p.id)?.length ?? 0})
                            </button>
                            <button onClick={() => setEditingId(p.id)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Edit</button>
                            <RowXeroSyncButton productId={p.id} hasSku={!!p.sku && p.sku.trim() !== ""} />
                            <button onClick={() => toggleActive(p.id, p.is_active)} className={`text-xs transition-colors ${p.is_active ? "text-muted-foreground hover:text-red-400" : "text-emerald-500 hover:text-emerald-400"}`}>
                              {p.is_active ? "Deactivate" : "Activate"}
                            </button>
                          </td>
                        </tr>
                        {offersOpenId === p.id && (
                          <tr className="border-b border-border bg-muted/20">
                            <td colSpan={8} className="px-3 py-3">
                              <OffersPanel
                                product={p}
                                offers={offersByProduct.get(p.id) ?? []}
                                suppliers={sortedSuppliers}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}


      {/* Add modal */}
      {addingToCategory !== null && (
        <ProductFormModal
          mode="create"
          category={addingToCategory}
          suppliers={sortedSuppliers}
          scopeRoles={sortedScopeRoles}
          labourTimings={sortedLabourTimings}
          assetTypes={assetTypes}
          subcategories={subcategories}
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
            offers={offersByProduct.get(product.id) ?? []}
            suppliers={sortedSuppliers}
            scopeRoles={sortedScopeRoles}
            labourTimings={sortedLabourTimings}
            assetTypes={assetTypes}
            subcategories={subcategories}
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
      assetTypes: AssetTypeOption[];
      subcategories: ProductSubcategory[];
      onScopeRoleCreated: (role: ScopeRoleOption) => void;
      onLabourTimingCreated: (timing: LabourTimingOption) => void;
      onClose: () => void;
      onSaved: () => void;
      product?: never;
      offers?: never;
      onSave?: never;
    }
  | {
      mode: "edit";
      product: Product;
      offers: ProductOffer[];
      suppliers: Supplier[];
      scopeRoles: ScopeRoleOption[];
      labourTimings: LabourTimingOption[];
      assetTypes: AssetTypeOption[];
      subcategories: ProductSubcategory[];
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
  const [category, setCategory] = useState(isEditing ? props.product.category : props.category);
  const [subcategory, setSubcategory] = useState(isEditing ? (props.product.subcategory ?? "") : "");
  const headerTitle = isEditing ? "Edit product" : "Add product";

  // Active sub-categories for the currently-selected infrastructure.
  const subOptions = props.subcategories
    .filter((s) => s.is_active && s.category === category)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  const [name, setName] = useState(isEditing ? props.product.name : "");
  const [sku, setSku] = useState(isEditing ? (props.product.sku || "") : "");
  // Create mode only — the initial supplier becomes the product's preferred
  // offer (D11). In edit mode the supplier is whoever holds the preferred
  // offer; it's managed in the Supplier pricing section, not a form field.
  const [supplierId, setSupplierId] = useState("");
  const [supplierRefSku, setSupplierRefSku] = useState("");
  const [supplierRefName, setSupplierRefName] = useState("");
  const [costPrice, setCostPrice] = useState(isEditing ? props.product.cost_price.toString() : "");
  // Preserve the stored markup exactly. Supplier flips set non-standard values
  // (e.g. 2.48) to hold sell price steady — coercing to a dropdown preset on
  // edit would silently reprice the product on save.
  const STANDARD_MARKUPS = ["0.25", "0.50", "0.75", "1.00"];
  const initialMarkup = isEditing
    ? (STANDARD_MARKUPS.find((m) => Number(m) === Number(props.product.markup)) ?? String(Number(props.product.markup)))
    : "0.50";
  const [markup, setMarkup] = useState(initialMarkup);
  const [sellPrice, setSellPrice] = useState(isEditing ? props.product.sell_price.toString() : "");
  const [deviceType, setDeviceType] = useState(isEditing ? (props.product.device_type || "") : "");
  const [scopeRole, setScopeRole] = useState(isEditing ? (props.product.scope_role || "") : "");
  const [labourCode, setLabourCode] = useState(isEditing ? (props.product.labour_code || "") : "");
  const [assetTypeId, setAssetTypeId] = useState(isEditing ? (props.product.asset_type_id || "") : "");
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
  // Effective supplier: in edit mode it's the preferred offer's supplier
  // (live — starring a different offer in the panel below re-derives this);
  // in create mode it's the picked initial supplier.
  const effectiveSupplierId = isEditing
    ? (props.offers.find((o) => o.is_preferred)?.supplier_id ?? props.product.supplier_id ?? "")
    : supplierId;
  // CentreFit-supplied products (direct/China imports) take actual COGS + sell
  // price directly and the markup is derived; everything else keeps presets.
  const isCentrefit = (props.suppliers.find((s) => s.id === effectiveSupplierId)?.name ?? "").trim().toLowerCase() === "centrefit";
  // Non-CentreFit edit mode: cost belongs to the preferred offer, so the
  // preview reads the live mirrored value, not a form field.
  const effectiveCost = isEditing && !isCentrefit ? props.product.cost_price : parseFloat(costPrice || "0");
  const sellPreview = (effectiveCost * (1 + parseFloat(markup || "0.5"))).toFixed(2);
  const cfCost = parseFloat(costPrice || "0");
  const cfSell = parseFloat(sellPrice || "0");
  const cfProfit = cfSell - cfCost;
  const cfMarkup = cfCost > 0 && cfSell > 0 ? Math.round((cfSell / cfCost - 1) * 1e6) / 1e6 : 0;

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
    if (!name.trim()) return;
    if (!isEditing && !supplierId) {
      toast("Pick the supplier this product comes from — it becomes the preferred pricing offer", "error");
      return;
    }
    if ((!isEditing || isCentrefit) && !costPrice) {
      toast("Enter the cost price", "error");
      return;
    }
    if (isCentrefit && cfSell <= 0) {
      toast("Enter the sell price for this CentreFit product", "error");
      return;
    }
    if (!category) {
      toast("Pick a category (infrastructure) for this product", "error");
      return;
    }
    if (!scopeRole) {
      toast("Pick a scope role (use 'None / consumable' for accessories or items with no SoW representation)", "error");
      return;
    }
    if (!labourCode) {
      toast("Pick a labour code (use 'None / no separate labour' for items that don't add labour minutes)", "error");
      return;
    }

    const qty = parseInt(defaultQuantity);
    // No supplier/supplier text in the payload (D9/D11): supplier_id is set
    // on create only, the text column is derived by DB trigger, and in edit
    // mode supplier + cost belong to the offers, not the product form.
    const payload = {
      name: name.trim(),
      sku: sku.trim() || (isEditing ? "" : null),
      markup: isCentrefit ? cfMarkup : parseFloat(markup),
      device_type: deviceType || null,
      scope_role: scopeRole || null,
      labour_code: labourCode || null,
      asset_type_id: assetTypeId || null,
      image_url: imageUrl || null,
      requires_cable_run: requiresCableRun,
      description: description.trim() || null,
      default_quantity: isNaN(qty) || qty < 1 ? 1 : qty,
      internal_notes: internalNotes.trim() || null,
      is_default: isDefault,
      subcategory: subcategory || null,
    };

    if (isEditing) {
      const updates: Partial<Product> = { ...payload, category } as Partial<Product>;
      // CentreFit direct entry writes actual COGS onto the product (the
      // trigger mirrors it to the CentreFit offer). Other suppliers' costs
      // are edited in the Supplier pricing section, never here.
      if (isCentrefit) updates.cost_price = parseFloat(costPrice);
      props.onSave(props.product.id, updates);
      return;
    }

    setSaving(true);
    const { data: created, error } = await supabase
      .from("quote_products")
      .insert({
        ...payload,
        category,
        supplier_id: supplierId,
        cost_price: parseFloat(costPrice),
        is_active: true,
      })
      .select("id")
      .single();
    if (error || !created) {
      setSaving(false);
      toast(error?.message ?? "Insert failed", "error");
      return;
    }
    // The DB trigger just created the preferred offer using our catalogue
    // SKU/name as placeholders — overwrite with the supplier's own SKU/item
    // name if they were provided.
    if (supplierRefSku.trim() || supplierRefName.trim()) {
      const { error: offerErr } = await supabase
        .from("product_supplier_offers")
        .update({
          supplier_sku: supplierRefSku.trim() || null,
          supplier_item_name: supplierRefName.trim() || null,
        })
        .eq("product_id", created.id)
        .eq("supplier_id", supplierId);
      if (offerErr) toast(`Product added, but saving the supplier's SKU failed: ${offerErr.message}`, "error");
    }
    setSaving(false);
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
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{category || "Select category"}</p>
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
          {/* Category + Sub-category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Category (infrastructure)</label>
              <select
                value={category}
                onChange={(e) => { setCategory(e.target.value); setSubcategory(""); }}
                className={inputClass}
              >
                <option value="">— Select category —</option>
                {PRODUCT_CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                {/* Surface any legacy category not in the constant so edits don't lose it */}
                {category && !PRODUCT_CATEGORIES.includes(category) && (
                  <option value={category}>{category}</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Sub-category</label>
              <select
                value={subcategory}
                onChange={(e) => setSubcategory(e.target.value)}
                disabled={!category}
                className={inputClass + (category ? "" : " opacity-50")}
              >
                <option value="">— None —</option>
                {subOptions.map((s) => (<option key={s.id} value={s.name}>{s.name}</option>))}
                {/* Keep a previously-set value visible even if it was since removed */}
                {subcategory && !subOptions.some((s) => s.name === subcategory) && (
                  <option value={subcategory}>{subcategory}</option>
                )}
              </select>
            </div>
          </div>

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

          {/* Supplier (create only — becomes the preferred offer) + Default
              qty. CentreFit switches the pricing row to direct cost + sell. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {!isEditing && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Supplier <span className="text-destructive">*</span>
                  <span className="ml-1 font-normal text-muted-foreground/60">— becomes the preferred pricing offer</span>
                </label>
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required className={inputClass}>
                  <option value="">Select supplier...</option>
                  {props.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
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

          {/* Create mode: the supplier's own SKU / item name for the initial
              offer (D11). Hidden for CentreFit — direct imports have no
              external part number beyond our own SKU. */}
          {!isEditing && supplierId && !isCentrefit && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Supplier&apos;s SKU
                  <span className="ml-1 font-normal text-muted-foreground/60">— their part number, searchable later</span>
                </label>
                <input value={supplierRefSku} onChange={(e) => setSupplierRefSku(e.target.value)} className={inputClass} placeholder="optional" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Supplier&apos;s item name</label>
                <input value={supplierRefName} onChange={(e) => setSupplierRefName(e.target.value)} className={inputClass} placeholder="optional" />
              </div>
            </div>
          )}

          {/* Edit mode: supplier pricing lives on the offers, right here in
              the form — star an offer to change who prices this product. */}
          {isEditing && (
            <div className="rounded-md border border-border bg-muted/20 px-3 py-3">
              <OffersPanel
                product={props.product}
                offers={props.offers}
                suppliers={props.suppliers}
              />
            </div>
          )}

          {/* Cost / markup / sell. CentreFit (direct import) products take
              actual COGS + sell price; markup is derived and stored. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {isEditing && !isCentrefit ? (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Cost price
                  <span className="ml-1 font-normal text-muted-foreground/60">— from the ★ offer above</span>
                </label>
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-mono text-foreground">${props.product.cost_price.toFixed(2)}</div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">{isCentrefit ? "Actual cost of goods *" : "Cost price *"}</label>
                <input type="number" step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} required className={inputClass} />
              </div>
            )}
            {isCentrefit ? (
              <>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Sell price *</label>
                  <input type="number" step="0.01" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} required className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Margin</label>
                  <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-mono text-foreground">
                    {cfCost > 0 && cfSell > 0 ? `$${cfProfit.toFixed(2)} (${(cfMarkup * 100).toFixed(0)}%)` : "—"}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Markup</label>
                  <select value={markup} onChange={(e) => setMarkup(e.target.value)} className={inputClass}>
                    {!STANDARD_MARKUPS.includes(initialMarkup) && (
                      <option value={initialMarkup}>Current ({(Number(initialMarkup) * 100).toFixed(0)}%)</option>
                    )}
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
              </>
            )}
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

          {/* Asset type — maps this product to the asset register for the
              BOM → assets import. Optional; leave blank for cable/mounts. */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Asset type
              <span className="ml-1 font-normal text-muted-foreground/60">— if installed as a tracked device, becomes this asset on BOM → assets import</span>
            </label>
            <select value={assetTypeId} onChange={(e) => setAssetTypeId(e.target.value)} className={inputClass}>
              <option value="">None — not a tracked asset (cable, mounts, consumables)</option>
              {props.assetTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

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

/* ── Per-product supplier offers (products-CONTEXT.md D1/D2) ──
   Star = preferred: a DB trigger demotes siblings and mirrors that offer's
   supplier + cost onto the product row, which is what quotes/POs read. */
function OffersPanel({
  product,
  offers,
  suppliers,
}: {
  product: { id: string; name: string; supplier_id: string | null };
  offers: ProductOffer[];
  suppliers: Supplier[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [costEdit, setCostEdit] = useState<Record<string, string>>({});
  // Add/edit share one stacked form below the table (never a row of inputs
  // inside it — that forced sideways scrolling on phones). editTarget null =
  // adding a new offer; otherwise editing that offer's SKU/name/cost.
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProductOffer | null>(null);
  const [formSupplierId, setFormSupplierId] = useState("");
  const [formSku, setFormSku] = useState("");
  const [formName, setFormName] = useState("");
  const [formCost, setFormCost] = useState("");

  function openAdd() {
    setEditTarget(null);
    setFormSupplierId(""); setFormSku(""); setFormName(""); setFormCost("");
    setFormOpen(true);
  }

  function openEdit(offer: ProductOffer) {
    setEditTarget(offer);
    setFormSupplierId(offer.supplier_id);
    setFormSku(offer.supplier_sku ?? "");
    setFormName(offer.supplier_item_name ?? "");
    setFormCost(offer.cost_price.toFixed(2));
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditTarget(null);
  }

  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? "—";
  const takenSupplierIds = new Set(offers.map((o) => o.supplier_id));
  const availableSuppliers = suppliers.filter((s) => !takenSupplierIds.has(s.id));

  async function setPreferred(offer: ProductOffer) {
    if (offer.is_preferred) return;
    setBusyId(offer.id);
    const { error } = await supabase
      .from("product_supplier_offers")
      .update({ is_preferred: true })
      .eq("id", offer.id);
    setBusyId(null);
    if (error) { toast(error.message, "error"); return; }
    toast(`${supplierName(offer.supplier_id)} now prices ${product.name}`);
    router.refresh();
  }

  async function saveCost(offer: ProductOffer) {
    const raw = costEdit[offer.id];
    if (raw == null || raw.trim() === "") return;
    const val = Number(raw);
    if (!Number.isFinite(val) || val < 0) { toast("Invalid cost", "error"); return; }
    setBusyId(offer.id);
    const { error } = await supabase
      .from("product_supplier_offers")
      .update({ cost_price: val, cost_updated_at: new Date().toISOString() })
      .eq("id", offer.id);
    setBusyId(null);
    if (error) { toast(error.message, "error"); return; }
    setCostEdit((m) => { const n = { ...m }; delete n[offer.id]; return n; });
    router.refresh();
  }

  async function removeOffer(offer: ProductOffer) {
    if (offer.is_preferred) { toast("Make another offer preferred first", "error"); return; }
    setBusyId(offer.id);
    const { error } = await supabase.from("product_supplier_offers").delete().eq("id", offer.id);
    setBusyId(null);
    if (error) { toast(error.message, "error"); return; }
    router.refresh();
  }

  async function saveOfferForm() {
    const val = Number(formCost);
    if (!Number.isFinite(val) || val < 0) { toast("Invalid cost", "error"); return; }

    if (editTarget) {
      if (!formSupplierId) { toast("Pick a supplier", "error"); return; }
      setBusyId(editTarget.id);
      const costChanged = Math.abs(val - editTarget.cost_price) > 0.001;
      // Changing supplier_id on the preferred offer is safe — the DB sync
      // trigger mirrors the new supplier onto the product row.
      const { error } = await supabase
        .from("product_supplier_offers")
        .update({
          supplier_id: formSupplierId,
          supplier_sku: formSku.trim() || null,
          supplier_item_name: formName.trim() || null,
          cost_price: val,
          ...(costChanged ? { cost_updated_at: new Date().toISOString() } : {}),
        })
        .eq("id", editTarget.id);
      setBusyId(null);
      if (error) { toast(error.message, "error"); return; }
      toast(`${supplierName(formSupplierId)} offer updated`);
    } else {
      if (!formSupplierId) { toast("Pick a supplier", "error"); return; }
      setBusyId("new");
      const { error } = await supabase.from("product_supplier_offers").insert({
        product_id: product.id,
        supplier_id: formSupplierId,
        supplier_sku: formSku.trim() || null,
        supplier_item_name: formName.trim() || null,
        cost_price: val,
        cost_updated_at: new Date().toISOString(),
        is_preferred: false,
      });
      setBusyId(null);
      if (error) { toast(error.message, "error"); return; }
    }
    closeForm();
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Supplier pricing — star drives quotes &amp; POs
        </span>
        {!formOpen && availableSuppliers.length > 0 && (
          <button
            type="button"
            onClick={openAdd}
            className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
          >
            + Add supplier offer
          </button>
        )}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="py-1 pr-2 w-8"></th>
            <th className="py-1 pr-3">Supplier</th>
            <th className="py-1 pr-3">Their SKU</th>
            <th className="py-1 pr-3 hidden md:table-cell">Their item name</th>
            <th className="py-1 pr-3 text-right">Cost</th>
            <th className="py-1 pr-3 hidden sm:table-cell">Updated</th>
            <th className="py-1 text-right"></th>
          </tr>
        </thead>
        <tbody>
          {offers.map((o) => (
            <tr key={o.id} className="border-t border-border/60">
              <td className="py-1.5 pr-2">
                <button
                  type="button"
                  onClick={() => setPreferred(o)}
                  disabled={busyId === o.id}
                  title={o.is_preferred ? "Preferred — this offer prices quotes and POs" : "Make preferred"}
                  className={`text-sm transition-colors ${o.is_preferred ? "text-amber-400" : "text-muted-foreground/40 hover:text-amber-400"}`}
                >
                  {o.is_preferred ? "★" : "☆"}
                </button>
              </td>
              <td className="py-1.5 pr-3 font-medium">{supplierName(o.supplier_id)}</td>
              <td className="py-1.5 pr-3 font-mono text-muted-foreground">{o.supplier_sku || "—"}</td>
              <td className="py-1.5 pr-3 text-muted-foreground hidden md:table-cell truncate max-w-[280px]">{o.supplier_item_name || "—"}</td>
              <td className="py-1.5 pr-3 text-right font-mono">
                <input
                  value={costEdit[o.id] ?? o.cost_price.toFixed(2)}
                  onChange={(e) => setCostEdit((m) => ({ ...m, [o.id]: e.target.value }))}
                  onBlur={() => saveCost(o)}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  className="w-20 rounded border border-border bg-input px-1.5 py-0.5 text-right font-mono text-xs focus:border-primary focus:outline-none"
                />
              </td>
              <td className="py-1.5 pr-3 text-muted-foreground hidden sm:table-cell">
                {o.cost_updated_at ? new Date(o.cost_updated_at).toLocaleDateString("en-AU") : "—"}
              </td>
              <td className="py-1.5 text-right whitespace-nowrap space-x-2">
                <button
                  type="button"
                  onClick={() => openEdit(o)}
                  disabled={busyId === o.id}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Edit
                </button>
                {!o.is_preferred && (
                  <button
                    type="button"
                    onClick={() => removeOffer(o)}
                    disabled={busyId === o.id}
                    className="text-[11px] text-muted-foreground hover:text-red-400 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Stacked add/edit form — lives BELOW the table so it stacks cleanly
          on phones instead of widening the table into a sideways scroll. */}
      {formOpen && (
        <div className="rounded-md border border-primary/30 bg-muted/20 p-3 space-y-2">
          <p className="text-[11px] font-semibold text-foreground">
            {editTarget ? `Edit ${supplierName(editTarget.supplier_id)} offer` : "Add supplier offer"}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Supplier</label>
              {/* Editable in both modes. Suppliers that already have another
                  offer on this product are excluded (one offer per supplier). */}
              <select value={formSupplierId} onChange={(e) => setFormSupplierId(e.target.value)} className="w-full rounded border border-border bg-input px-2 py-1.5 text-xs focus:border-primary focus:outline-none">
                <option value="">Pick a supplier…</option>
                {suppliers
                  .filter((s) => !takenSupplierIds.has(s.id) || s.id === editTarget?.supplier_id)
                  .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Cost (ex GST)</label>
              <input value={formCost} onChange={(e) => setFormCost(e.target.value)} inputMode="decimal" placeholder="0.00" className="w-full rounded border border-border bg-input px-2 py-1.5 text-right font-mono text-xs focus:border-primary focus:outline-none" />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Their SKU</label>
              <input value={formSku} onChange={(e) => setFormSku(e.target.value)} placeholder="supplier's SKU" className="w-full rounded border border-border bg-input px-2 py-1.5 font-mono text-xs focus:border-primary focus:outline-none" />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Their item name</label>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="supplier's item name" className="w-full rounded border border-border bg-input px-2 py-1.5 text-xs focus:border-primary focus:outline-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={closeForm} className="rounded border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Cancel</button>
            <button
              type="button"
              onClick={saveOfferForm}
              disabled={busyId === "new" || (editTarget != null && busyId === editTarget.id)}
              className="rounded bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {busyId != null ? "Saving…" : editTarget ? "Save changes" : "Add offer"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
