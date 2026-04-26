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
  template_id: string | null;
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

interface RuleTemplate {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
}

const inputClass = "block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

// ── Human-readable labels ──

function deviceLabel(code: string | null): string {
  if (!code) return "any device";
  const specials: Record<string, string> = {
    _cameras: "cameras (any type)",
    _pirs: "PIR sensors (any type)",
    _speakers: "speakers (any type)",
    _cabinets: "server cabinets (any size)",
  };
  if (specials[code]) return specials[code];
  const dt = DEVICE_TYPES.find(d => d.code === code);
  return dt ? dt.legend : code;
}

function conditionText(rule: DbRule): string {
  const device = deviceLabel(rule.trigger_code);
  switch (rule.trigger_condition) {
    case "always":
      return `When **${device}** are on the plan`;
    case "greater_than":
      return `When more than **${rule.trigger_value}** ${device}`;
    case "greater_than_or_equal":
      return `When **${rule.trigger_value}+** ${device}`;
    case "equals":
      return `When exactly **${rule.trigger_value}** ${device}`;
    case "range":
      return `When **${rule.trigger_min}–${rule.trigger_max}** ${device}`;
    case "site_conditional":
      return `When ${device} and site has ${rule.trigger_site_field}`;
    case "site_boolean":
      return `When site has **${rule.trigger_site_field}** enabled`;
    case "compound":
      return `When combined **${device}** count triggers`;
    default:
      return `When ${device} detected`;
  }
}

function quantityText(rule: DbRule, products: ProductOption[]): string {
  const product = products.find(p => p.id === rule.auto_add_product_id);
  const productName = product ? product.name : "unknown product";
  switch (rule.quantity_mode) {
    case "fixed":
      return `add **${rule.quantity_value || 1}x** ${productName}`;
    case "match_trigger":
      return `add **1 per device** — ${productName}`;
    case "match_site_field":
      return `add **1 per ${rule.quantity_site_field || "site field"}** — ${productName}`;
    case "per_n":
      return `add **1 per ${rule.quantity_divisor || 1} devices** — ${productName}`;
    case "formula":
      return `add (formula) — ${productName}`;
    case "custom":
      return `add (custom) — ${productName}`;
    default:
      return `add ${productName}`;
  }
}

function RuleSentence({ rule, products }: { rule: DbRule; products: ProductOption[] }) {
  const condition = conditionText(rule);
  const qty = quantityText(rule, products);
  // Render markdown-style **bold** as <strong>
  const render = (text: string) => {
    const parts = text.split(/\*\*(.*?)\*\*/g);
    return parts.map((part, i) => i % 2 === 1 ? <strong key={i} className="text-foreground">{part}</strong> : <span key={i}>{part}</span>);
  };
  return (
    <p className="text-sm text-muted-foreground">
      {render(condition)} → {render(qty)}
    </p>
  );
}

// ── Friendly form labels ──

const TRIGGER_CONDITIONS = [
  { value: "always", label: "Any are on the plan", help: "Triggers when at least 1 is placed" },
  { value: "greater_than", label: "More than a specific count", help: "e.g. more than 8 cameras" },
  { value: "greater_than_or_equal", label: "At least a specific count", help: "e.g. 9 or more cameras" },
  { value: "equals", label: "Exactly a specific count", help: "e.g. exactly 4 speakers" },
  { value: "range", label: "Between a range", help: "e.g. between 5 and 12 cameras" },
  { value: "site_conditional", label: "Based on a site setting", help: "Advanced: uses site info fields" },
  { value: "site_boolean", label: "Site toggle is on", help: "Advanced: e.g. separate studio zone" },
  { value: "compound", label: "Combined device count", help: "Advanced: sums multiple device types" },
];

const QUANTITY_MODES = [
  { value: "fixed", label: "Add a fixed number", help: "e.g. always add 1x NVR" },
  { value: "match_trigger", label: "1 for each device", help: "e.g. 1 bracket per camera" },
  { value: "match_site_field", label: "Match a site info field", help: "e.g. match TV count" },
  { value: "per_n", label: "1 for every N devices", help: "e.g. 1 NVR per 8 cameras" },
  { value: "formula", label: "Custom formula", help: "Advanced: custom calculation" },
  { value: "custom", label: "Custom key", help: "Advanced: special logic" },
];

export function RulesManager({
  dbRules,
  products,
  templates,
}: {
  dbRules: DbRule[];
  products: ProductOption[];
  templates: RuleTemplate[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<DbRule | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);

  // Active template tab — defaults to default template, then first
  const initialTemplateId =
    templates.find((t) => t.is_default)?.id ??
    templates[0]?.id ??
    null;
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(initialTemplateId);

  async function seedRulesFromEngine() {
    if (!confirm("Re-seed both Snap Fitness and Total Fusion templates from the code-defined ruleset? This wipes all existing dependency rules and replaces them.")) return;
    setSeeding(true);
    try {
      const { data: fullProducts } = await supabase.from("quote_products").select("*").eq("is_active", true);
      if (!fullProducts || fullProducts.length === 0) {
        toast("No products found — seed products first", "error");
        setSeeding(false);
        return;
      }
      const snapTemplate = templates.find((t) => t.slug === "snap_fitness");
      const basicTemplate = templates.find((t) => t.slug === "total_fusion") ?? templates.find((t) => t.slug === "basic");
      const snapRules = snapTemplate ? getSnapFitnessRules(fullProducts).map((r) => ({ ...r, _templateId: snapTemplate.id })) : [];
      const basicRules = basicTemplate ? getBasicRules(fullProducts).map((r) => ({ ...r, _templateId: basicTemplate.id })) : [];
      const allRules = [...snapRules, ...basicRules];
      await supabase.from("quote_dependency_rules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      const rows = allRules
        .filter((r) => r.auto_add_product_id)
        .map((rule, i) => ({
          preset: rule.preset, template_id: rule._templateId,
          description: rule.description, is_active: rule.is_active,
          trigger_code: rule.trigger_code, trigger_condition: rule.trigger_condition,
          trigger_value: rule.trigger_value ?? null, trigger_min: rule.trigger_min ?? null, trigger_max: rule.trigger_max ?? null,
          trigger_site_field: rule.trigger_site_field ?? null, trigger_site_value: rule.trigger_site_value ?? null, trigger_site_op: rule.trigger_site_op ?? null,
          quantity_mode: rule.quantity_mode, quantity_value: rule.quantity_value ?? null,
          quantity_site_field: rule.quantity_site_field ?? null, quantity_multiplier: rule.quantity_multiplier ?? null,
          quantity_divisor: rule.quantity_divisor ?? null, quantity_formula: rule.quantity_formula ?? null,
          quantity_custom_key: rule.quantity_custom_key ?? null, auto_add_product_id: rule.auto_add_product_id ?? null,
          sort_order: i,
        }));
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const { error } = await supabase.from("quote_dependency_rules").insert(batch);
        if (error) { toast(`Error at batch ${i}: ${error.message}`, "error"); break; }
        inserted += batch.length;
      }
      toast(`Seeded ${inserted} rules across templates (${allRules.length - rows.length} skipped — product not found)`);
      router.refresh();
    } catch (err: any) {
      toast(err.message, "error");
    }
    setSeeding(false);
  }

  const filtered = useMemo(() => {
    let list = dbRules;
    if (activeTemplateId) list = list.filter((r) => r.template_id === activeTemplateId);
    if (search.length >= 2) {
      const q = search.toLowerCase();
      list = list.filter(r => r.description.toLowerCase().includes(q) || (r.trigger_code ?? "").toLowerCase().includes(q));
    }
    return list;
  }, [dbRules, search, activeTemplateId]);

  const activeTemplate = templates.find((t) => t.id === activeTemplateId) ?? null;

  async function setDefaultTemplate(id: string) {
    await supabase.from("quote_rule_templates").update({ is_default: false }).neq("id", id);
    const { error } = await supabase.from("quote_rule_templates").update({ is_default: true }).eq("id", id);
    if (error) toast(error.message, "error");
    else { toast("Default template updated"); router.refresh(); }
  }

  async function deleteTemplate(id: string) {
    const ruleCount = dbRules.filter((r) => r.template_id === id).length;
    const msg = ruleCount > 0
      ? `Delete this template? Its ${ruleCount} rules will also be deleted (cascade). Quotes already using it keep their existing BOM but will fall back to the default template if edited.`
      : "Delete this template?";
    if (!confirm(msg)) return;
    const { error } = await supabase.from("quote_rule_templates").delete().eq("id", id);
    if (error) toast(error.message, "error");
    else {
      toast("Template deleted");
      setActiveTemplateId(templates.find((t) => t.id !== id && t.is_default)?.id ?? templates.find((t) => t.id !== id)?.id ?? null);
      router.refresh();
    }
  }

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

  return (
    <div>
      {/* Template tabs */}
      <div className="mb-4">
        <div className="flex items-center gap-2 flex-wrap border-b border-border pb-2 mb-3">
          {templates.map((tpl) => {
            const ruleCount = dbRules.filter((r) => r.template_id === tpl.id).length;
            const isActive = activeTemplateId === tpl.id;
            return (
              <button
                key={tpl.id}
                onClick={() => setActiveTemplateId(tpl.id)}
                className={`group inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {tpl.name}
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-muted-foreground">
                  {ruleCount}
                </span>
                {tpl.is_default && (
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
                    Default
                  </span>
                )}
              </button>
            );
          })}
          <button
            onClick={() => setShowTemplateForm(true)}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors"
          >
            <span className="text-base leading-none">+</span> New template
          </button>
        </div>

        {showTemplateForm && (
          <TemplateForm
            template={null}
            onSaved={() => { setShowTemplateForm(false); router.refresh(); }}
            onCancel={() => setShowTemplateForm(false)}
          />
        )}

        {activeTemplate && (
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3 rounded-lg border border-border bg-card p-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{activeTemplate.name}</p>
              {activeTemplate.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{activeTemplate.description}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {!activeTemplate.is_default && (
                <button
                  onClick={() => setDefaultTemplate(activeTemplate.id)}
                  className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  Set as default
                </button>
              )}
              <button
                onClick={() => setShowTemplateForm(true)}
                className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                Rename / edit
              </button>
              <button
                onClick={() => deleteTemplate(activeTemplate.id)}
                className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        )}

        {showTemplateForm && activeTemplate && (
          <TemplateForm
            template={activeTemplate}
            onSaved={() => { setShowTemplateForm(false); router.refresh(); }}
            onCancel={() => setShowTemplateForm(false)}
          />
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input type="text" placeholder="Search rules..." value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputClass} flex-1 min-w-[200px]`} />
        <button
          onClick={() => { setEditingRule(null); setShowForm(true); }}
          disabled={!activeTemplateId}
          className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
        >
          <span className="text-lg leading-none">+</span> Add Rule
        </button>
        <button onClick={seedRulesFromEngine} disabled={seeding}
          className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/10 disabled:opacity-50">
          {seeding ? "Seeding..." : "Re-seed from code"}
        </button>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        <span className="font-medium text-foreground tabular-nums">{filtered.length}</span> rule{filtered.length === 1 ? "" : "s"} in <span className="text-foreground">{activeTemplate?.name ?? "—"}</span> — these automatically add products to quotes when devices are detected on a plan.
      </p>

      {/* Rule form */}
      {showForm && activeTemplateId && (
        <RuleForm
          rule={editingRule}
          products={products}
          templateId={activeTemplateId}
          templateSlug={activeTemplate?.slug ?? ""}
          onSaved={() => { setShowForm(false); setEditingRule(null); router.refresh(); }}
          onCancel={() => { setShowForm(false); setEditingRule(null); }}
        />
      )}

      {/* Rules grouped by trigger device */}
      {Array.from(grouped).map(([triggerCode, rules]) => (
        <div key={triggerCode} className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{deviceLabel(triggerCode)}</h3>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{rules.length}</span>
          </div>
          <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
            {rules.map(rule => (
              <div key={rule.id} className={`px-4 py-3 flex items-start justify-between gap-4 ${!rule.is_active ? "opacity-40" : ""}`}>
                <div className="flex-1 min-w-0">
                  <RuleSentence rule={rule} products={products} />
                  <p className="text-[10px] text-muted-foreground/60 mt-1">{rule.description}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => toggleActive(rule.id, rule.is_active)}
                    className={`px-2 py-1 rounded text-xs transition-colors ${rule.is_active ? "bg-muted text-muted-foreground hover:bg-amber-500/10 hover:text-amber-400" : "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"}`}>
                    {rule.is_active ? "Disable" : "Enable"}
                  </button>
                  <button onClick={() => { setEditingRule(rule); setShowForm(true); }} className="px-2 py-1 rounded text-xs bg-muted text-muted-foreground hover:text-foreground transition-colors">Edit</button>
                  <button onClick={() => deleteRule(rule.id)} className="px-2 py-1 rounded text-xs bg-muted text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {filtered.length === 0 && !showForm && (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">No rules yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Rules automatically add products to quotes when certain devices are on a plan.</p>
          <button onClick={() => { setEditingRule(null); setShowForm(true); }} className="mt-3 text-sm text-primary hover:text-primary/80 transition-colors">Add the first rule</button>
        </div>
      )}
    </div>
  );
}

/* ── Rule Form ── */
function RuleForm({ rule, products, templateId, templateSlug, onSaved, onCancel }: {
  rule: DbRule | null;
  products: ProductOption[];
  templateId: string;
  templateSlug: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const isEditing = !!rule;
  const [saving, setSaving] = useState(false);

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
      template_id: templateId,
      preset: templateSlug,
      description: description.trim(), trigger_code: triggerCode, trigger_condition: triggerCondition,
      trigger_value: triggerValue ? parseInt(triggerValue) : null,
      trigger_min: triggerMin ? parseInt(triggerMin) : null, trigger_max: triggerMax ? parseInt(triggerMax) : null,
      quantity_mode: quantityMode, quantity_value: quantityValue ? parseInt(quantityValue) : null,
      quantity_divisor: quantityDivisor ? parseInt(quantityDivisor) : null, quantity_formula: quantityFormula || null,
      auto_add_product_id: productId || null, sort_order: parseInt(sortOrder) || 0, is_active: true,
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

  const selectedCondition = TRIGGER_CONDITIONS.find(c => c.value === triggerCondition);
  const selectedQtyMode = QUANTITY_MODES.find(m => m.value === quantityMode);

  return (
    <form onSubmit={handleSubmit} className="mb-5 rounded-lg border border-primary/30 bg-card p-5 space-y-5">
      <h3 className="text-sm font-semibold text-foreground">{isEditing ? "Edit Rule" : "New Rule"}</h3>

      {/* What does this rule do? */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">What does this rule do?</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} placeholder="e.g. Add an NVR when cameras are placed on the plan" required />
        <p className="text-[10px] text-muted-foreground mt-1">A short description so anyone can understand what this rule does.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* LEFT: When does it trigger? */}
        <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">When...</p>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Which device triggers this rule?</label>
            <select value={triggerCode} onChange={(e) => setTriggerCode(e.target.value)} className={inputClass} required>
              <option value="">Pick a device...</option>
              <optgroup label="Individual Devices">
                {DEVICE_TYPES.map(d => <option key={d.code} value={d.code}>{d.legend}</option>)}
              </optgroup>
              <optgroup label="Device Groups">
                <option value="_cameras">All cameras combined</option>
                <option value="_pirs">All PIR sensors combined</option>
                <option value="_speakers">All speakers combined</option>
                <option value="_cabinets">All server cabinets combined</option>
              </optgroup>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">When should it trigger?</label>
            <select value={triggerCondition} onChange={(e) => setTriggerCondition(e.target.value)} className={inputClass}>
              {TRIGGER_CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            {selectedCondition && <p className="text-[10px] text-muted-foreground mt-1">{selectedCondition.help}</p>}
          </div>

          {["greater_than", "greater_than_or_equal", "equals"].includes(triggerCondition) && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">How many?</label>
              <input type="number" value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} className={inputClass} placeholder="e.g. 8" />
            </div>
          )}

          {triggerCondition === "range" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">From</label>
                <input type="number" value={triggerMin} onChange={(e) => setTriggerMin(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">To</label>
                <input type="number" value={triggerMax} onChange={(e) => setTriggerMax(e.target.value)} className={inputClass} />
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: What does it add? */}
        <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Then add...</p>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Which product gets added?</label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputClass}>
              <option value="">Pick a product...</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">How many to add?</label>
            <select value={quantityMode} onChange={(e) => setQuantityMode(e.target.value)} className={inputClass}>
              {QUANTITY_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            {selectedQtyMode && <p className="text-[10px] text-muted-foreground mt-1">{selectedQtyMode.help}</p>}
          </div>

          {quantityMode === "fixed" && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Quantity</label>
              <input type="number" value={quantityValue} onChange={(e) => setQuantityValue(e.target.value)} className={inputClass} placeholder="1" />
            </div>
          )}

          {quantityMode === "per_n" && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">For every how many devices?</label>
              <input type="number" value={quantityDivisor} onChange={(e) => setQuantityDivisor(e.target.value)} className={inputClass} placeholder="e.g. 8 (1 per 8 cameras)" />
            </div>
          )}

          {quantityMode === "formula" && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Formula</label>
              <input value={quantityFormula} onChange={(e) => setQuantityFormula(e.target.value)} className={inputClass} placeholder="e.g. ceil(cardio + tvs / 8)" />
            </div>
          )}
        </div>
      </div>

      {/* Advanced / meta */}
      <details className="text-xs">
        <summary className="text-muted-foreground cursor-pointer hover:text-foreground transition-colors">Advanced options</summary>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Sort order</label>
            <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className={inputClass} />
          </div>
        </div>
      </details>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors">Cancel</button>
        <button type="submit" disabled={saving} className="rounded-md bg-primary px-5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {saving ? "Saving..." : isEditing ? "Update Rule" : "Create Rule"}
        </button>
      </div>
    </form>
  );
}

/* ── Template Form ── */
function TemplateForm({ template, onSaved, onCancel }: {
  template: RuleTemplate | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const isEditing = !!template;
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");

  function slugify(s: string): string {
    return s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast("Name is required", "error");
      return;
    }
    setSaving(true);
    if (isEditing && template) {
      const { error } = await supabase
        .from("quote_rule_templates")
        .update({ name: name.trim(), description: description.trim() || null })
        .eq("id", template.id);
      if (error) { toast(error.message, "error"); setSaving(false); return; }
      toast("Template updated");
    } else {
      const slug = slugify(name);
      const { error } = await supabase
        .from("quote_rule_templates")
        .insert({ name: name.trim(), slug, description: description.trim() || null, is_active: true });
      if (error) { toast(error.message, "error"); setSaving(false); return; }
      toast("Template created");
    }
    onSaved();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-4 rounded-lg border border-primary/30 bg-card p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{isEditing ? `Edit template — ${template!.name}` : "New rule template"}</p>
        <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Each quote picks one template at creation. Only that template's rules build the BOM.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={inputClass}
            placeholder="e.g. Anytime Fitness"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Short description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
            placeholder="What's different about this build?"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : isEditing ? "Update template" : "Create template"}
        </button>
      </div>
    </form>
  );
}
