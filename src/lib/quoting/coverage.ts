/**
 * Coverage report + gaps inbox data (docs/quoting-v2-CONTEXT.md D3, D6).
 *
 * Coverage = the things that make a quote silently incomplete, found at the
 * source (device types with no product, untagged products, rules and kit
 * parts that can't fire, $0-cost parts the engine adds).
 *
 * Gaps = what people add BY HAND after the engine ran — manual lines on plan
 * quotes and procurement items added after the quote — grouped so a hand-add
 * that keeps happening can be turned into a kit part with one click.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { evalKitFormula } from "@/lib/quote-engine/kits";
import type { CoverageData } from "@/app/(dashboard)/settings/rules/coverage-report";

const SINCE = "2026-03-01";
// Trigger terms that aren't device types: site fields and the engine's virtual codes.
const SITE_FIELDS = new Set(["site_sqm", "door_count", "external_camera_count", "concrete_mount_black", "concrete_mount_white", "cardio_count", "tv_count", "ceiling_tv_count", "wall_tv_mount_count", "ceiling_tv_mount_count", "separate_studio_zone", "mag_lock_glass"]);
const VIRTUAL_CODES = new Set(["reed_switch_all", "switch_ports", "speaker_roof", "speaker_wall"]);
const PAGE = 1000; // PostgREST max-rows

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

async function fetchAll<T>(make: () => { range: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> }): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

interface ProductRow { id: string; name: string; sku: string | null; category: string | null; device_type: string | null; is_default: boolean | null; is_active: boolean | null; scope_role: string | null; labour_code: string | null; cost_price: number | null; is_kit: boolean | null; discontinued_at: string | null; requires_cable_run: boolean | null }

/** The labour code a device-typed product should carry (labour_timings codes).
 *  A mismatch here is how the K6000 panel ended up charging PIR-wall labour
 *  and a cable run (Mitchell, 23 Sep). */
const EXPECTED_LABOUR: Record<string, string> = {
  camera_black: "camera_plaster", camera_white: "camera_plaster",
  pir_360_roof: "pir_360_roof", pir_wall: "pir_wall", reed_switch: "reed_switch",
  duress_button: "duress_button", duress_intercom: "duress_intercom", rex_button: "rex_button", light_siren: "light_siren",
  wap: "wap", speaker_roof_black: "speaker_roof", speaker_roof_white: "speaker_roof", speaker_wall_black: "speaker_wall", speaker_wall_white: "speaker_wall",
  tailgate_system: "tailgate_system", card_reader: "card_reader", door_strike: "door_lock", mag_lock: "door_lock",
  integration_cable: "integration_cable", alarm_keypad: "alarm_keypad", rf_receiver: "rf_receiver", data_point: "data_point", coax_point: "coax_point",
  intercom_master: "intercom_master", intercom_slave: "intercom_slave", volume_control: "volume_control",
  // head-end gear: labour is the fixed wiring-in / build / commission lines, not per-unit fit-off
  alarm_panel: "none", nvr: "none", cabinet_9ru: "none", cabinet_27ru: "none", cabinet_32ru: "none", cabinet_42ru: "none",
};
const HEAD_END = new Set(["alarm_panel", "nvr", "cabinet_9ru", "cabinet_27ru", "cabinet_32ru", "cabinet_42ru"]);
/** Scope role a device-typed product should carry where it's unambiguous.
 *  The pendant tagged duress_button is why the scope lumped buttons and
 *  pendants together (Mitchell, 23 Sep). */
const EXPECTED_SCOPE: Record<string, string> = {
  duress_button: "duress_button", duress_pendant: "duress_pendant", duress_intercom: "duress_intercom", rf_receiver: "rf_receiver",
  alarm_panel: "alarm_panel", pir_360_roof: "motion_sensor", pir_wall: "motion_sensor", reed_switch: "reed_switch", mag_lock: "mag_lock",
  cabinet_9ru: "cabinet", cabinet_27ru: "cabinet", cabinet_32ru: "cabinet", cabinet_42ru: "cabinet",
};
interface RuleRow { id: string; description: string | null; template_id: string | null; is_universal: boolean | null; is_active: boolean | null; auto_add_product_id: string | null; trigger_code: string | null; trigger_condition: string | null }
interface KitRow { id: string; kit_product_id: string; component_product_id: string; qty_mode: string; qty_formula: string | null; status: string }
interface QuoteRow { id: string; job_id: string | null; quote_mode: string | null; device_counts: Record<string, number> | null; status: string | null }
interface LineRow { quote_id: string; product_id: string | null; auto_added: boolean | null; device_type_code: string | null; kit_parent_product_id: string | null }
interface ProcRow { job_id: string; product_id: string | null; quote_line_item_id: string | null }

export interface GapAdd {
  product: { id: string; name: string; sku: string | null };
  quotes: number;
  viaManual: number;
  viaProcurement: number;
  ruleAdds: boolean;
  alongside: { product: { id: string; name: string; sku: string | null }; n: number; alreadyComponent: boolean }[];
}
export interface GapsData { adds: GapAdd[]; oneOffs: number; quotesScanned: number; since: string }

export async function loadCoverageAndGaps(supabase: AnyClient): Promise<{ coverage: CoverageData; gaps: GapsData }> {
  const [dtRes, prodRes, ruleRes, tplRes, defRes, kitRes, supRes] = await Promise.all([
    supabase.from("quote_device_types").select("code, legend, has_hardware").eq("is_active", true).order("sort_order"),
    supabase.from("quote_products").select("id, name, sku, category, device_type, is_default, is_active, scope_role, labour_code, cost_price, is_kit, discontinued_at, requires_cable_run").order("name"),
    supabase.from("quote_dependency_rules").select("id, description, template_id, is_universal, is_active, auto_add_product_id, trigger_code, trigger_condition"),
    supabase.from("quote_rule_templates").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("quote_template_device_defaults").select("template_id, device_type, product_id"),
    supabase.from("product_kit_components").select("id, kit_product_id, component_product_id, qty_mode, qty_formula, status"),
    supabase.from("quote_template_device_supply").select("template_id, device_type, supplied_by"),
  ]);
  const deviceTypes = (dtRes.data ?? []) as { code: string; legend: string; has_hardware: boolean }[];
  const products = (prodRes.data ?? []) as ProductRow[];
  const rules = (ruleRes.data ?? []) as RuleRow[];
  const templates = (tplRes.data ?? []) as { id: string; name: string }[];
  const defaults = (defRes.data ?? []) as { template_id: string; device_type: string; product_id: string | null }[];
  const kits = (kitRes.data ?? []) as KitRow[];
  const supply = (supRes.data ?? []) as { template_id: string; device_type: string; supplied_by: string }[];

  const quotes = await fetchAll<QuoteRow>(() => supabase.from("quotes").select("id, job_id, quote_mode, device_counts, status").gte("created_at", SINCE).order("created_at"));
  const quoteIds = quotes.map((q) => q.id);
  const lines = quoteIds.length ? await fetchAll<LineRow>(() => supabase.from("quote_line_items").select("quote_id, product_id, auto_added, device_type_code, kit_parent_product_id").in("quote_id", quoteIds).order("id")) : [];
  const jobIds = Array.from(new Set(quotes.map((q) => q.job_id).filter((j): j is string => !!j)));
  const proc = jobIds.length ? await fetchAll<ProcRow>(() => supabase.from("job_procurement_items").select("job_id, product_id, quote_line_item_id").in("job_id", jobIds).not("product_id", "is", null).order("id")) : [];

  const pById = new Map(products.map((p) => [p.id, p]));
  const active = (id: string | null | undefined) => { const p = id ? pById.get(id) : undefined; return !!p && p.is_active !== false; };
  const tplName = new Map(templates.map((t) => [t.id, t.name]));
  const dtCodes = new Set(deviceTypes.map((d) => d.code));
  const activeRules = rules.filter((r) => r.is_active !== false);
  const approvedKits = kits.filter((k) => k.status === "approved");

  // ---- Coverage ----
  const productByDevice = new Map<string, ProductRow[]>();
  for (const p of products) if (p.device_type && p.is_active !== false) productByDevice.set(p.device_type, [...(productByDevice.get(p.device_type) ?? []), p]);
  const defaultCovers = new Set(defaults.filter((d) => active(d.product_id)).map((d) => d.device_type));
  const countedOn = new Map<string, number>();
  for (const q of quotes) for (const [code, n] of Object.entries(q.device_counts ?? {})) if (Number(n) > 0) countedOn.set(code, (countedOn.get(code) ?? 0) + 1);
  const deviceTypesNoProduct = deviceTypes
    .filter((d) => d.has_hardware && !productByDevice.has(d.code) && !defaultCovers.has(d.code))
    .map((d) => ({ code: d.code, legend: d.legend, count_quotes: countedOn.get(d.code) ?? 0 }));

  const ruleProducts = new Set(activeRules.map((r) => r.auto_add_product_id).filter(Boolean) as string[]);
  const kitComponentsOf = new Set(approvedKits.map((k) => k.component_product_id));
  const defaultProducts = new Set(defaults.map((d) => d.product_id).filter(Boolean) as string[]);
  const reachable = (p: ProductRow) => !!p.device_type || !!p.is_default || ruleProducts.has(p.id) || kitComponentsOf.has(p.id) || defaultProducts.has(p.id);
  const productsMissingTags = products
    .filter((p) => p.is_active !== false && reachable(p))
    .map((p) => { const missing: string[] = []; if (!p.scope_role) missing.push("scope role"); if (p.device_type && !p.labour_code) missing.push("labour code"); return { id: p.id, name: p.name, sku: p.sku, missing }; })
    .filter((p) => p.missing.length);

  // Labour tags that contradict the device type — these charge the wrong
  // fit-off line (or a cable run for head-end gear) on every quote.
  const labourMismatch: CoverageData["labourMismatch"] = [];
  for (const p of products) {
    if (p.is_active === false || !p.device_type) continue;
    const expected = EXPECTED_LABOUR[p.device_type];
    if (expected && p.labour_code && p.labour_code !== expected) labourMismatch.push({ id: p.id, name: p.name, sku: p.sku, device_type: p.device_type, problem: `labour code "${p.labour_code}" — expected "${expected}"` });
    if (HEAD_END.has(p.device_type) && p.requires_cable_run) labourMismatch.push({ id: p.id, name: p.name, sku: p.sku, device_type: p.device_type, problem: "flagged as needing a cable run — head-end gear doesn't" });
    const expectedScope = EXPECTED_SCOPE[p.device_type];
    if (p.scope_role === "none") labourMismatch.push({ id: p.id, name: p.name, sku: p.sku, device_type: p.device_type, problem: "scope role is 'none' — this device never appears in the scope of works" });
    else if (expectedScope && p.scope_role && p.scope_role !== expectedScope) labourMismatch.push({ id: p.id, name: p.name, sku: p.sku, device_type: p.device_type, problem: `scope role "${p.scope_role}" — expected "${expectedScope}" (it's scoped as the wrong thing)` });
  }

  const rulesBroken: CoverageData["rulesBroken"] = [];
  for (const r of activeRules) {
    const tpl = r.template_id ? (tplName.get(r.template_id) ?? null) : null;
    const problems: string[] = [];
    if (!r.auto_add_product_id) problems.push("no product to add");
    else if (!pById.has(r.auto_add_product_id)) problems.push("product no longer exists");
    else if (!active(r.auto_add_product_id)) problems.push(`product "${pById.get(r.auto_add_product_id)?.name}" is inactive`);
    else if (pById.get(r.auto_add_product_id)?.discontinued_at) problems.push(`product "${pById.get(r.auto_add_product_id)?.name}" is discontinued`);
    if (!r.template_id && !r.is_universal) problems.push("no template and not universal — never runs");
    if (r.template_id && !tplName.has(r.template_id)) problems.push("template is inactive");
    if (r.trigger_code && r.trigger_condition !== "always") {
      for (const code of r.trigger_code.split("+").map((c) => c.trim()).filter(Boolean)) {
        if (!dtCodes.has(code) && !SITE_FIELDS.has(code) && !VIRTUAL_CODES.has(code)) problems.push(`trigger device type "${code}" isn't a known device type`);
      }
    }
    for (const problem of problems) rulesBroken.push({ id: r.id, description: r.description, problem, template: tpl ?? (r.is_universal ? "universal" : null) });
  }

  const kitsBroken: CoverageData["kitsBroken"] = [];
  const sampleVars = { qty: 4, cameras: 12, doors: 2, detectors: 6, sqm: 800, retention_days: 30, tv_count: 4, cardio_count: 20 };
  for (const k of approvedKits) {
    const kit = pById.get(k.kit_product_id); const comp = pById.get(k.component_product_id);
    const kitName = kit?.name ?? k.kit_product_id.slice(0, 8); const compName = comp?.name ?? k.component_product_id.slice(0, 8);
    if (!kit || kit.is_active === false) kitsBroken.push({ kit: kitName, component: compName, problem: "kit product is inactive or missing" });
    if (!comp || comp.is_active === false) kitsBroken.push({ kit: kitName, component: compName, problem: "component product is inactive or missing" });
    if (k.qty_mode === "formula" && k.qty_formula && k.qty_formula !== "hdd_pack") {
      try { evalKitFormula(k.qty_formula, sampleVars); } catch (e) { kitsBroken.push({ kit: kitName, component: compName, problem: `formula won't evaluate: ${e instanceof Error ? e.message : String(e)}` }); }
    }
  }

  // Rules whose part a kit already adds. The engine nets the kit quantity off
  // the rule line, so the quote is right either way — but the rule is dead
  // weight that confuses the Rules tab (the Snap K6000 rules, 24 Sep). Only
  // single-device-type triggers whose default product IS the kit qualify.
  const kitsAdding = new Map<string, Set<string>>();
  for (const k of approvedKits) kitsAdding.set(k.component_product_id, (kitsAdding.get(k.component_product_id) ?? new Set<string>()).add(k.kit_product_id));
  const defaultFor = (code: string, templateId: string | null): string | null => {
    const tpl = templateId ? defaults.find((d) => d.template_id === templateId && d.device_type === code && active(d.product_id)) : undefined;
    if (tpl?.product_id) return tpl.product_id;
    const g = productByDevice.get(code) ?? [];
    return (g.find((p) => p.is_default) ?? g[0])?.id ?? null;
  };
  const rulesCoveredByKits: CoverageData["rulesCoveredByKits"] = [];
  for (const r of activeRules) {
    if (!r.auto_add_product_id || !r.trigger_code || r.trigger_condition === "always") continue;
    const kitIds = kitsAdding.get(r.auto_add_product_id); if (!kitIds) continue;
    const codes = r.trigger_code.split("+").map((s) => s.trim()).filter(Boolean);
    if (codes.length !== 1) continue;
    const picked = r.template_id
      ? [defaultFor(codes[0], r.template_id)]
      : Array.from(new Set([defaultFor(codes[0], null), ...defaults.filter((d) => d.device_type === codes[0] && active(d.product_id)).map((d) => d.product_id as string)]));
    if (!picked.length || !picked.every((id) => !!id && kitIds.has(id))) continue;
    rulesCoveredByKits.push({ id: r.id, description: r.description, product: pById.get(r.auto_add_product_id)?.name ?? r.auto_add_product_id, kit: pById.get(picked[0] as string)?.name ?? (picked[0] as string), template: r.template_id ? (tplName.get(r.template_id) ?? null) : "universal" });
  }

  const rulesUsing = new Map<string, number>(); for (const r of activeRules) if (r.auto_add_product_id) rulesUsing.set(r.auto_add_product_id, (rulesUsing.get(r.auto_add_product_id) ?? 0) + 1);
  const kitsUsing = new Map<string, number>(); for (const k of approvedKits) kitsUsing.set(k.component_product_id, (kitsUsing.get(k.component_product_id) ?? 0) + 1);
  const zeroCost = products
    .filter((p) => p.is_active !== false && !(Number(p.cost_price) > 0) && (rulesUsing.has(p.id) || kitsUsing.has(p.id) || defaultProducts.has(p.id) || (p.is_default && p.device_type)))
    .map((p) => ({ id: p.id, name: p.name, sku: p.sku, used_by_rules: rulesUsing.get(p.id) ?? 0, used_by_kits: kitsUsing.get(p.id) ?? 0 }));

  const coverage: CoverageData = { deviceTypesNoProduct, productsMissingTags, labourMismatch, rulesBroken, rulesCoveredByKits, kitsBroken, zeroCost, templates, deviceTypes, supply };

  // ---- Gaps inbox ----
  const linesByQuote = new Map<string, LineRow[]>();
  for (const l of lines) linesByQuote.set(l.quote_id, [...(linesByQuote.get(l.quote_id) ?? []), l]);
  const quoteByJob = new Map<string, QuoteRow>();
  for (const q of quotes) if (q.job_id && (q.status === "accepted" || !quoteByJob.has(q.job_id))) quoteByJob.set(q.job_id, q);
  const kitCandidate = (pid: string | null) => { const p = pid ? pById.get(pid) : undefined; return !!p && (!!p.is_kit || !!p.device_type); };
  const isComponentOf = new Set(kits.map((k) => `${k.kit_product_id}|${k.component_product_id}`)); // any status = already decided

  // per added product: quotes it was hand-added on, and the kit candidates on those quotes
  const adds = new Map<string, { quotes: Set<string>; manual: Set<string>; proc: Set<string>; along: Map<string, Set<string>> }>();
  const note = (y: string, quoteId: string, via: "manual" | "proc", candidates: string[]) => {
    if (!pById.get(y) || pById.get(y)?.is_active === false) return;
    const a = adds.get(y) ?? { quotes: new Set(), manual: new Set(), proc: new Set(), along: new Map() };
    a.quotes.add(quoteId); (via === "manual" ? a.manual : a.proc).add(quoteId);
    for (const x of candidates) if (x !== y) a.along.set(x, (a.along.get(x) ?? new Set()).add(quoteId));
    adds.set(y, a);
  };
  for (const q of quotes) {
    if (q.quote_mode === "manual") continue; // no engine ran — nothing to learn about the rules
    const ql = linesByQuote.get(q.id) ?? [];
    const candidates = Array.from(new Set(ql.map((l) => l.product_id).filter((p): p is string => kitCandidate(p))));
    const onQuote = new Set(ql.map((l) => l.product_id).filter(Boolean) as string[]);
    for (const l of ql) if (l.product_id && !l.auto_added && !l.device_type_code && !l.kit_parent_product_id && !kitCandidate(l.product_id)) note(l.product_id, q.id, "manual", candidates);
    void onQuote;
  }
  for (const pr of proc) {
    if (!pr.product_id || pr.quote_line_item_id) continue; // came from a quote line — the engine's work
    const q = quoteByJob.get(pr.job_id); if (!q || q.quote_mode === "manual") continue;
    const ql = linesByQuote.get(q.id) ?? [];
    if (ql.some((l) => l.product_id === pr.product_id)) continue; // re-ordered something already quoted
    const candidates = Array.from(new Set(ql.map((l) => l.product_id).filter((p): p is string => kitCandidate(p))));
    note(pr.product_id, q.id, "proc", candidates);
  }
  const lite = (id: string) => { const p = pById.get(id)!; return { id: p.id, name: p.name, sku: p.sku }; };
  const all = Array.from(adds.entries()).map(([y, a]) => ({
    product: lite(y), quotes: a.quotes.size, viaManual: a.manual.size, viaProcurement: a.proc.size, ruleAdds: ruleProducts.has(y),
    alongside: Array.from(a.along.entries()).map(([x, s]) => ({ product: lite(x), n: s.size, alreadyComponent: isComponentOf.has(`${x}|${y}`) })).sort((p, q) => q.n - p.n).slice(0, 6),
  })).sort((p, q) => q.quotes - p.quotes || p.product.name.localeCompare(q.product.name));
  const gaps: GapsData = { adds: all.filter((a) => a.quotes >= 2).slice(0, 60), oneOffs: all.filter((a) => a.quotes < 2).length, quotesScanned: quotes.length, since: SINCE };
  return { coverage, gaps };
}
