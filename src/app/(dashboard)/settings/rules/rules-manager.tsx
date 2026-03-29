"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { DEVICE_TYPES, getSnapFitnessRules, getBasicRules } from "@/lib/quote-engine";
import type { DependencyRule } from "@/lib/quote-engine";

interface DbRule {
  id: string;
  preset: string;
  description: string;
  is_active: boolean;
  trigger_code: string | null;
  trigger_condition: string;
  trigger_value: number | null;
  trigger_min: number | null;
  trigger_max: number | null;
  trigger_site_field: string | null;
  trigger_site_value: number | null;
  trigger_site_op: string | null;
  quantity_mode: string;
  quantity_value: number | null;
  quantity_site_field: string | null;
  quantity_multiplier: number | null;
  quantity_divisor: number | null;
  quantity_formula: string | null;
  quantity_custom_key: string | null;
  auto_add_product_id: string | null;
  sort_order: number;
}

interface ProductOption {
  id: string;
  name: string;
  sku: string;
  category: string;
}

const inputClass = "block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

const TRIGGER_CONDITIONS = [
  { value: "always", label: "Always (any count > 0)" },
  { value: "greater_than", label: "Greater Than" },
  { value: "greater_than_or_equal", label: "Greater Than or Equal" },
  { value: "equals", label: "Equals" },
  { value: "range", label: "Range (min-max)" },
  { value: "site_conditional", label: "Site Conditional" },
  { value: "site_boolean", label: "Site Boolean" },
  { value: "compound", label: "Compound (sum of codes)" },
];

const QUANTITY_MODES = [
  { value: "fixed", label: "Fixed Quantity" },
  { value: "match_trigger", label: "Match Trigger Count" },
  { value: "match_site_field", label: "Match Site Field" },
  { value: "per_n", label: "Per N (ceil divide)" },
  { value: "formula", label: "Formula" },
  { value: "custom", label: "Custom Key" },
];

export function RulesManager({ dbRules, products }: { dbRules: DbRule[]; products: ProductOption[] }) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<DbRule | null>(null);
  const [presetFilter, setPresetFilter] = useState("");
  const [seeding, setSeeding] = useState(false);

  async function seedRulesFromEngine() {
    setSeeding(true);
    try {
      // Load full product data (need cost/sell for the engine)
      const { data: fullProducts } = await supabase
        .from("quote_products")
        .select("*")
        .eq("is_active", true);

      if (!fullProducts || fullProducts.length === 0) {
        toast("No products found — seed products first", "error");
        setSeeding(false);
        return;
      }

      // Generate rules from the code engine
      const snapRules = getSnapFitnessRules(fullProducts);
      const basicRules = getBasicRules(fullProducts);
      const allRules = [...snapRules, ...basicRules];

      // Clear existing rules
      await supabase.from("quote_dependency_rules").delete().neq("id", "00000000-0000-0000-0000-000000000000");

      // Map to DB rows
      const rows = allRules
        .filter((r: DependencyRule) => r.auto_add_product_id) // skip rules where product wasn't found
        .map((rule: DependencyRule, i: number) => ({
          preset: rule.preset,
          description: rule.description,
          is_active: rule.is_active,
          trigger_code: rule.trigger_code,
          trigger_condition: rule.trigger_condition,
          trigger_value: rule.trigger_value ?? null,
          trigger_min: rule.trigger_min ?? null,
          trigger_max: rule.trigger_max ?? null,
          trigger_site_field: rule.trigger_site_field ?? null,
          trigger_site_value: rule.trigger_site_value ?? null,
          trigger_site_op: rule.trigger_site_op ?? null,
          quantity_mode: rule.quantity_mode,
          quantity_value: rule.quantity_value ?? null,
          quantity_site_field: rule.quantity_site_field ?? null,
          quantity_multiplier: rule.quantity_multiplier ?? null,
          quantity_divisor: rule.quantity_divisor ?? null,
          quantity_formula: rule.quantity_formula ?? null,
          quantity_custom_key: rule.quantity_custom_key ?? null,
          auto_add_product_id: rule.auto_add_product_id ?? null,
          sort_order: i,
        }));

      // Insert in batches
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const { error } = await supabase.from("quote_dependency_rules").insert(batch);
        if (error) {
          toast(`Error at batch ${i}: ${error.message}`, "error");
          break;
        }
        inserted += batch.length;
      }

      toast(`Seeded ${inserted} rules (${allRules.length - rows.length} skipped — product not found)`);
      router.refresh();
    } catch (err: any) {
      toast(err.message, "error");
    }
    setSeeding(false);
  }

  const presets = useMemo(() => {
    const set = new Set(dbRules.map(r => r.preset));
    return Array.from(set).sort();
  }, [dbRules]);

  const filtered = useMemo(() => {
    let list = dbRules;
    if (presetFilter) list = list.filter(r => r.preset === presetFilter);
    if (search.length >= 2) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        r.description.toLowerCase().includes(q) ||
        (r.trigger_code ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [dbRules, search, presetFilter]);

  // Group by trigger code
  const grouped = useMemo(() => {
    const map = new Map<string, DbRule[]>();
    for (const rule of filtered) {
      const key = rule.trigger_code || "global";
      const list = map.get(key) ?? [];
      list.push(rule);
      map.set(key, list);
    }
    return map;
  }, [filtered]);

  async function toggleActive(id: string, current: boolean) {
    const { error } = await supabase.from("quote_dependency_rules").update({ is_active: !current }).eq("id", id);
    if (error) toast(error.message, "error");
    else { toast(!current ? "Rule activated" : "Rule deactivated"); router.refresh(); }
  }

  async function deleteRule(id: string) {
    const { error } = await supabase.from("quote_dependency_rules").delete().eq("id", id);
    if (error) toast(error.message, "error");
    else { toast("Rule deleted"); router.refresh(); }
  }

  function openEdit(rule: DbRule) {
    setEditingRule(rule);
    setShowForm(true);
  }

  function openNew() {
    setEditingRule(null);
    setShowForm(true);
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input type="text" placeholder="Search rules..." value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputClass} flex-1 min-w-[200px]`} />
        <select value={presetFilter} onChange={(e) => setPresetFilter(e.target.value)} className={inputClass + " w-auto"}>
          <option value="">All Presets</option>
          {presets.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button onClick={openNew} className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10">
          <span className="text-lg leading-none">+</span> Add Rule
        </button>
        <button
          onClick={seedRulesFromEngine}
          disabled={seeding}
          className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/10 disabled:opacity-50"
        >
          {seeding ? "Seeding..." : "Seed from Quote Engine"}
        </button>
      </div>

      <p className="text-xs text-muted-foreground mb-4">{filtered.length} rules</p>

      {/* Rule form */}
      {showForm && (
        <RuleForm
          rule={editingRule}
          products={products}
          onSaved={() => { setShowForm(false); setEditingRule(null); router.refresh(); }}
          onCancel={() => { setShowForm(false); setEditingRule(null); }}
        />
      )}

      {/* Rules grouped by trigger */}
      {Array.from(grouped).map(([triggerCode, rules]) => {
        const dt = DEVICE_TYPES.find(d => d.code === triggerCode);
        const label = dt ? dt.legend : triggerCode;

        return (
          <div key={triggerCode} className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</h3>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{rules.length}</span>
            </div>
            <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
              {rules.map(rule => (
                <div key={rule.id} className={`px-4 py-3 flex items-start justify-between gap-4 ${!rule.is_active ? "opacity-40" : ""}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{rule.description}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{rule.trigger_condition}</span>
                      {rule.trigger_value != null && (
                        <span className="text-[10px] text-muted-foreground">value: {rule.trigger_value}</span>
                      )}
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{rule.quantity_mode}</span>
                      {rule.quantity_value != null && (
                        <span className="text-[10px] text-muted-foreground">qty: {rule.quantity_value}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground">{rule.preset}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => toggleActive(rule.id, rule.is_active)} className={`text-xs transition-colors ${rule.is_active ? "text-muted-foreground hover:text-amber-400" : "text-emerald-500 hover:text-emerald-400"}`}>
                      {rule.is_active ? "Disable" : "Enable"}
                    </button>
                    <button onClick={() => openEdit(rule)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Edit</button>
                    <button onClick={() => deleteRule(rule.id)} className="text-xs text-muted-foreground hover:text-red-400 transition-colors">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && !showForm && (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">No rules in database yet.</p>
          <p className="text-xs text-muted-foreground mt-1">70+ Snap Fitness rules are loaded from code. Add custom rules here to override or extend them.</p>
          <button onClick={openNew} className="mt-3 text-sm text-primary hover:text-primary/80 transition-colors">Add the first rule</button>
        </div>
      )}
    </div>
  );
}

/* ── Rule Form ── */
function RuleForm({ rule, products, onSaved, onCancel }: {
  rule: DbRule | null;
  products: ProductOption[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const isEditing = !!rule;
  const [saving, setSaving] = useState(false);

  const [preset, setPreset] = useState(rule?.preset || "snap_fitness");
  const [description, setDescription] = useState(rule?.description || "");
  const [triggerCode, setTriggerCode] = useState(rule?.trigger_code || "");
  const [triggerCondition, setTriggerCondition] = useState(rule?.trigger_condition || "always");
  const [triggerValue, setTriggerValue] = useState(rule?.trigger_value?.toString() || "");
  const [triggerMin, setTriggerMin] = useState(rule?.trigger_min?.toString() || "");
  const [triggerMax, setTriggerMax] = useState(rule?.trigger_max?.toString() || "");
  const [quantityMode, setQuantityMode] = useState(rule?.quantity_mode || "fixed");
  const [quantityValue, setQuantityValue] = useState(rule?.quantity_value?.toString() || "1");
  const [quantityDivisor, setQuantityDivisor] = useState(rule?.quantity_divisor?.toString() || "");
  const [quantityFormula, setQuantityFormula] = useState(rule?.quantity_formula || "");
  const [productId, setProductId] = useState(rule?.auto_add_product_id || "");
  const [sortOrder, setSortOrder] = useState(rule?.sort_order?.toString() || "0");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim() || !triggerCode) return;
    setSaving(true);

    const payload = {
      preset,
      description: description.trim(),
      trigger_code: triggerCode,
      trigger_condition: triggerCondition,
      trigger_value: triggerValue ? parseInt(triggerValue) : null,
      trigger_min: triggerMin ? parseInt(triggerMin) : null,
      trigger_max: triggerMax ? parseInt(triggerMax) : null,
      quantity_mode: quantityMode,
      quantity_value: quantityValue ? parseInt(quantityValue) : null,
      quantity_divisor: quantityDivisor ? parseInt(quantityDivisor) : null,
      quantity_formula: quantityFormula || null,
      auto_add_product_id: productId || null,
      sort_order: parseInt(sortOrder) || 0,
      is_active: true,
    };

    if (isEditing && rule) {
      const { error } = await supabase.from("quote_dependency_rules").update(payload).eq("id", rule.id);
      if (error) { toast(error.message, "error"); setSaving(false); return; }
      toast("Rule updated");
    } else {
      const { error } = await supabase.from("quote_dependency_rules").insert(payload);
      if (error) { toast(error.message, "error"); setSaving(false); return; }
      toast("Rule created");
    }
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="mb-5 rounded-lg border border-primary/30 bg-card p-4 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="col-span-2 md:col-span-3">
          <label className="block text-xs font-medium text-muted-foreground mb-1">Description *</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} placeholder="e.g. Add NVR when cameras detected" required />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Preset</label>
          <input value={preset} onChange={(e) => setPreset(e.target.value)} className={inputClass} />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Trigger Device *</label>
          <select value={triggerCode} onChange={(e) => setTriggerCode(e.target.value)} className={inputClass} required>
            <option value="">Select device...</option>
            {DEVICE_TYPES.map(d => <option key={d.code} value={d.code}>{d.legend}</option>)}
            <option value="_cameras">Sum: All Cameras</option>
            <option value="_pirs">Sum: All PIRs</option>
            <option value="_speakers">Sum: All Speakers</option>
            <option value="_cabinets">Sum: All Cabinets</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Condition</label>
          <select value={triggerCondition} onChange={(e) => setTriggerCondition(e.target.value)} className={inputClass}>
            {TRIGGER_CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        {["greater_than", "greater_than_or_equal", "equals"].includes(triggerCondition) && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Trigger Value</label>
            <input type="number" value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} className={inputClass} />
          </div>
        )}

        {triggerCondition === "range" && (
          <>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Min</label>
              <input type="number" value={triggerMin} onChange={(e) => setTriggerMin(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Max</label>
              <input type="number" value={triggerMax} onChange={(e) => setTriggerMax(e.target.value)} className={inputClass} />
            </div>
          </>
        )}

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Quantity Mode</label>
          <select value={quantityMode} onChange={(e) => setQuantityMode(e.target.value)} className={inputClass}>
            {QUANTITY_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>

        {["fixed", "per_n"].includes(quantityMode) && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{quantityMode === "per_n" ? "Divisor" : "Quantity"}</label>
            <input type="number" value={quantityMode === "per_n" ? quantityDivisor : quantityValue} onChange={(e) => quantityMode === "per_n" ? setQuantityDivisor(e.target.value) : setQuantityValue(e.target.value)} className={inputClass} />
          </div>
        )}

        {quantityMode === "formula" && (
          <div className="col-span-2">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Formula</label>
            <input value={quantityFormula} onChange={(e) => setQuantityFormula(e.target.value)} className={inputClass} placeholder="e.g. ceil(cardio + tvs / 8)" />
          </div>
        )}

        <div className="col-span-2 md:col-span-3">
          <label className="block text-xs font-medium text-muted-foreground mb-1">Product to Auto-Add</label>
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputClass}>
            <option value="">Select product...</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name} {p.sku ? `(${p.sku})` : ""} — {p.category}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Sort Order</label>
          <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className={inputClass} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors">Cancel</button>
        <button type="submit" disabled={saving} className="rounded-md bg-primary px-5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {saving ? "Saving..." : isEditing ? "Update Rule" : "Create Rule"}
        </button>
      </div>
    </form>
  );
}
