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

const inputClass = "block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function ProductCatalog({ products, suppliers, scopeRoles }: { products: Product[]; suppliers: Supplier[]; scopeRoles: ScopeRoleOption[] }) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const filtered = useMemo(() => {
    let list = products;
    if (!showInactive) list = list.filter((p) => p.is_active);
    if (categoryFilter) list = list.filter((p) => p.category === categoryFilter);
    if (search.length >= 2) {
      const q = search.toLowerCase();
      list = list.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.supplier.toLowerCase().includes(q)
      );
    }
    return list;
  }, [products, search, categoryFilter, showInactive]);

  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>();
    // Ensure all categories show up in order
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
      // Get all products
      const { data: allProducts } = await supabase
        .from("quote_products")
        .select("id, supplier, supplier_id");

      if (!allProducts) { toast("No products found", "error"); setSeedingSuppliers(false); return; }

      // Extract unique supplier names
      const uniqueNames = [...new Set(
        allProducts.map(p => p.supplier?.trim()).filter((s): s is string => !!s && s.length > 0)
      )];

      // Get existing suppliers
      const { data: existingSuppliers } = await supabase.from("suppliers").select("id, name");
      const existingMap = new Map((existingSuppliers ?? []).map(s => [s.name.toLowerCase().trim(), s.id]));

      // Insert missing suppliers
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

      // Backfill supplier_id on products without one
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

  return (
    <div>
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
        <button
          onClick={seedSuppliersFromProducts}
          disabled={seedingSuppliers}
          className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/10 disabled:opacity-50"
        >
          {seedingSuppliers ? "Seeding..." : "Sync Suppliers"}
        </button>
      </div>

      <p className="text-xs text-muted-foreground mb-4">{filtered.length} products</p>

      {/* Category groups */}
      {Array.from(grouped).map(([category, items]) => {
        if (!categoryFilter && items.length === 0) return null;

        return (
          <div key={category} className="mb-6">
            {/* Category header */}
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{category} ({items.length})</h3>
              <button
                onClick={() => setAddingToCategory(addingToCategory === category ? null : category)}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
              >
                <span className="text-sm leading-none">+</span> Add Product
              </button>
            </div>

            {/* Add product form */}
            {addingToCategory === category && (
              <AddProductForm
                category={category}
                suppliers={suppliers}
                scopeRoles={scopeRoles}
                onSaved={() => { setAddingToCategory(null); router.refresh(); }}
                onCancel={() => setAddingToCategory(null)}
              />
            )}

            {/* Products table */}
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
                            <span className="text-sm">{p.name}</span>
                            {p.device_type && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{p.device_type}</span>}
                            {p.scope_role ? (
                              <span className="ml-1.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400" title="Scope role">
                                {scopeRoles.find(r => r.slug === p.scope_role)?.label ?? p.scope_role}
                              </span>
                            ) : (
                              <span className="ml-1.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400" title="Untagged — will land in Miscellaneous on quotes">
                                Untagged
                              </span>
                            )}
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

      {/* Edit modal — rendered once at the catalog level, opens for the
          currently-edited product. */}
      {editingId && (() => {
        const product = products.find((p) => p.id === editingId);
        if (!product) return null;
        return (
          <EditProductModal
            product={product}
            suppliers={suppliers}
            scopeRoles={scopeRoles}
            onSave={updateProduct}
            onCancel={() => setEditingId(null)}
          />
        );
      })()}
    </div>
  );
}

/* ── Add Product Form ── */
function AddProductForm({ category, suppliers, scopeRoles, onSaved, onCancel }: {
  category: string;
  suppliers: { id: string; name: string }[];
  scopeRoles: ScopeRoleOption[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [markup, setMarkup] = useState("0.50");
  const [deviceType, setDeviceType] = useState("");
  const [scopeRole, setScopeRole] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const categoryDevices = DEVICE_TYPES.filter(d => d.category === category);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !costPrice) return;
    setSaving(true);

    const selectedSupplier = suppliers.find(s => s.id === supplierId);
    const { error } = await supabase.from("quote_products").insert({
      name: name.trim(),
      sku: sku.trim() || null,
      category,
      supplier: selectedSupplier?.name || supplierName.trim() || "Unknown",
      supplier_id: supplierId || null,
      cost_price: parseFloat(costPrice),
      markup: parseFloat(markup),
      device_type: deviceType || null,
      scope_role: scopeRole || null,
      is_default: isDefault,
      is_active: true,
    });

    if (error) toast(error.message, "error");
    else { toast("Product added"); onSaved(); }
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="mb-3 rounded-lg border border-primary/30 bg-card p-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-muted-foreground mb-1">Name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">SKU</label>
          <input value={sku} onChange={(e) => setSku(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Supplier</label>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputClass}>
            <option value="">Select supplier...</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Cost Price *</label>
          <input type="number" step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} className={inputClass} required />
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
        {categoryDevices.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Device Type</label>
            <select value={deviceType} onChange={(e) => setDeviceType(e.target.value)} className={inputClass}>
              <option value="">None (ancillary)</option>
              {categoryDevices.map(d => <option key={d.code} value={d.code}>{d.legend}</option>)}
            </select>
          </div>
        )}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-muted-foreground mb-1">Scope Role <span className="font-normal text-muted-foreground/60">(drives where this product appears in the SoW)</span></label>
          <select value={scopeRole} onChange={(e) => setScopeRole(e.target.value)} className={inputClass}>
            <option value="">(untagged)</option>
            {scopeRoles.map(r => <option key={r.slug} value={r.slug}>{r.label}</option>)}
          </select>
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="rounded border-border" />
            Default for device
          </label>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors">Cancel</button>
        <button type="submit" disabled={saving} className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {saving ? "Adding..." : "Add Product"}
        </button>
      </div>
    </form>
  );
}

/* ── Edit Product Modal ── */
function EditProductModal({ product, suppliers, scopeRoles, onSave, onCancel }: {
  product: Product;
  suppliers: { id: string; name: string }[];
  scopeRoles: ScopeRoleOption[];
  onSave: (id: string, updates: Partial<Product>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku || "");
  const [supplierId, setSupplierId] = useState(product.supplier_id || "");
  const [costPrice, setCostPrice] = useState(product.cost_price.toString());
  const [markup, setMarkup] = useState(product.markup.toString());
  const [deviceType, setDeviceType] = useState(product.device_type || "");
  const [scopeRole, setScopeRole] = useState(product.scope_role || "");
  const [isDefault, setIsDefault] = useState(product.is_default);

  const categoryDevices = DEVICE_TYPES.filter(d => d.category === product.category);
  const sellPreview = (parseFloat(costPrice || "0") * (1 + parseFloat(markup || "0.5"))).toFixed(2);

  // Track whether we're on the client so createPortal doesn't run during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Esc to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !costPrice) return;
    const selectedSupplier = suppliers.find(s => s.id === supplierId);
    onSave(product.id, {
      name: name.trim(),
      sku: sku.trim() || "",
      supplier: selectedSupplier?.name || product.supplier,
      supplier_id: supplierId || null,
      cost_price: parseFloat(costPrice),
      markup: parseFloat(markup),
      device_type: deviceType || null,
      scope_role: scopeRole || null,
      is_default: isDefault,
    } as any);
  }

  if (!mounted) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm pointer-events-none" />
      <form
        onSubmit={handleSubmit}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative w-full max-w-[640px] max-h-[92vh] overflow-y-auto rounded-xl bg-background border border-border shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{product.category}</p>
            <h2 className="text-base font-semibold text-foreground truncate">Edit product</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">SKU</label>
              <input value={sku} onChange={(e) => setSku(e.target.value)} className={inputClass} />
            </div>
          </div>

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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Supplier</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputClass}>
                <option value="">Select supplier...</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {categoryDevices.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Device type</label>
                <select value={deviceType} onChange={(e) => setDeviceType(e.target.value)} className={inputClass}>
                  <option value="">None (ancillary)</option>
                  {categoryDevices.map(d => <option key={d.code} value={d.code}>{d.legend}</option>)}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Scope role
              <span className="ml-1 font-normal text-muted-foreground/60">— drives where this product appears in the SoW</span>
            </label>
            <select value={scopeRole} onChange={(e) => setScopeRole(e.target.value)} className={inputClass}>
              <option value="">(untagged)</option>
              {scopeRoles.map(r => <option key={r.slug} value={r.slug}>{r.label}</option>)}
            </select>
          </div>

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
            onClick={onCancel}
            className="rounded-md border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-5 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Save changes
          </button>
        </div>
      </form>
    </div>
  );

  return createPortal(modal, document.body);
}
