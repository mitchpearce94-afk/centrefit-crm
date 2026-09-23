// 2026-09-23 — Quoting v2 D2: turn the Snap dependency rules into PROPOSED kit components.
// A rule "when <device type> > 0, add <product> × qty" becomes a component on that device type's
// default product (the thing the customer actually chooses). Mitchell approves in the Kit editor.
// Rules that depend on the site (sqm, concrete, TVs, compound, custom formulas, ALWAYS) are left as
// rules and listed so we know what still lives outside kits.
// Dry run by default (prints the proposal). `--write` inserts rows with status 'proposed'.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const WRITE = process.argv.includes("--write");
const envFile = ["../.env.gc-probe", "../.env.local"].map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
const env = Object.fromEntries(readFileSync(envFile, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }));
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const [{ data: rules }, { data: products }, { data: templates }, { data: deviceTypes }, { data: defaults }] = await Promise.all([
  svc.from("quote_dependency_rules").select("*").eq("is_active", true),
  svc.from("quote_products").select("id, name, sku, device_type, is_default, is_active, scope_role"),
  svc.from("quote_rule_templates").select("id, name, slug"),
  svc.from("quote_device_types").select("code, legend, has_hardware"),
  svc.from("quote_template_device_defaults").select("template_id, device_type, product_id"),
]);
const tById = new Map(templates.map((t) => [t.id, t]));
const pById = new Map(products.map((p) => [p.id, p]));
const dtCodes = new Set(deviceTypes.map((d) => d.code));
const defaultFor = (code) => products.find((p) => p.is_active && p.device_type === code && p.is_default) ?? products.find((p) => p.is_active && p.device_type === code) ?? null;

const proposals = []; const leftAsRules = []; const problems = [];
for (const r of rules) {
  const t = r.template_id ? tById.get(r.template_id) : null;
  if (!(r.is_universal || t?.slug === "snap_fitness" || t?.slug === "planet_fitness")) continue;
  const comp = pById.get(r.auto_add_product_id);
  if (!comp) { problems.push(`rule ${r.description}: product missing`); continue; }
  const codes = String(r.trigger_code ?? "").split("+").map((s) => s.trim()).filter(Boolean);
  const simpleTrigger = ["greater_than", "greater_than_or_equal", "equals"].includes(r.trigger_condition) && Number(r.trigger_value ?? 0) <= 1;
  const simpleQty = ["fixed", "match_trigger", "per_n", "ceil_formula"].includes(r.quantity_mode);
  const allDevices = codes.length >= 1 && codes.every((c) => dtCodes.has(c) || c === "reed_switch_all");
  const perUnit = r.quantity_mode === "match_trigger";
  // Single device type: any simple qty becomes a kit component on that device's product.
  // A family (a + b + c): only PER-UNIT rules become a component on EACH member (door loop per lock,
  // Clipsal bracket per device); fixed/tiered family rules are system-level and stay as rules.
  const eligible = simpleTrigger && simpleQty && allDevices && (codes.length === 1 || perUnit);
  if (!eligible) { leftAsRules.push({ rule: r.description, trigger: r.trigger_code ?? r.trigger_condition, why: !allDevices ? "site/count trigger" : codes.length > 1 ? "family, fixed/tiered qty (system-level)" : !simpleTrigger ? r.trigger_condition : r.quantity_mode }); continue; }
  for (const code of codes.map((c) => (c === "reed_switch_all" ? "reed_switch" : c))) {
    const kit = defaultFor(code);
    if (!kit) { problems.push(`rule "${r.description}": no default product for device type ${code} — kit can't attach`); continue; }
    if (kit.id === comp.id) continue; // the device line itself
    let qty_mode = "fixed", qty_value = Number(r.quantity_value ?? 1), qty_per = null;
    if (r.quantity_mode === "match_trigger") { qty_mode = "per_unit"; qty_value = Number(r.quantity_value ?? 1) || 1; }
    else if (r.quantity_mode === "per_n") { qty_mode = "per_n"; qty_per = Number(r.quantity_divisor ?? r.quantity_value ?? 1); qty_value = 1; }
    else if (r.quantity_mode === "ceil_formula") { qty_mode = "per_n"; qty_per = Number(r.quantity_divisor ?? 1) / Number(r.quantity_multiplier ?? 1); qty_value = 1; }
    proposals.push({ kit_product_id: kit.id, kit: kit.name, device: code, component_product_id: comp.id, component: comp.name, sku: comp.sku, qty_mode, qty_value, qty_per, requirement: "required", status: "proposed", source: "rule_migration", source_rule_id: r.id, notes: `${r.description ?? ""}${t ? ` (from ${t.name} rules)` : " (universal rule)"}`.trim() });
  }
}
// dedupe (same kit+component+mode)
const seen = new Set(); const rows = [];
for (const p of proposals) { const k = `${p.kit_product_id}|${p.component_product_id}|${p.qty_mode}`; if (seen.has(k)) continue; seen.add(k); rows.push(p); }

const byKit = new Map();
for (const p of rows) { if (!byKit.has(p.kit)) byKit.set(p.kit, []); byKit.get(p.kit).push(p); }
console.log(`PROPOSED KITS (${byKit.size} kit products, ${rows.length} components):`);
for (const [kit, comps] of [...byKit.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${kit}  [${comps[0].device}]`);
  for (const c of comps) console.log(`   + ${c.component}  ×${c.qty_mode === "per_unit" ? `${c.qty_value} per unit` : c.qty_mode === "per_n" ? `1 per ${c.qty_per}` : `${c.qty_value} fixed`}   — ${c.notes.slice(0, 70)}`);
}
console.log(`\nLEFT AS RULES (${leftAsRules.length}):`);
for (const l of leftAsRules) console.log(`   ${l.rule?.slice(0, 70)}  [${l.trigger}] — ${l.why}`);
if (problems.length) { console.log(`\nPROBLEMS (${problems.length}):`); for (const p of problems) console.log("   " + p); }
writeFileSync(new URL("./kits-from-rules.json", import.meta.url), JSON.stringify({ rows, leftAsRules, problems }, null, 2));
if (WRITE) {
  const payload = rows.map(({ kit, device, component, sku, ...db }) => db);
  const { data: existing } = await svc.from("product_kit_components").select("kit_product_id, component_product_id, qty_mode");
  const have = new Set((existing ?? []).map((e) => `${e.kit_product_id}|${e.component_product_id}|${e.qty_mode}`));
  const fresh = payload.filter((r) => !have.has(`${r.kit_product_id}|${r.component_product_id}|${r.qty_mode}`));
  const { error } = fresh.length ? await svc.from("product_kit_components").insert(fresh) : { error: null };
  if (error) { console.error("insert failed:", error.message); process.exit(1); }
  const kitIds = [...new Set(rows.map((r) => r.kit_product_id))];
  await svc.from("quote_products").update({ is_kit: true }).in("id", kitIds);
  console.log(`\nWROTE ${payload.length} proposed components across ${kitIds.length} kit products`);
} else console.log("\n(dry run — pass --write to insert as proposed)");
