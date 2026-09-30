// Regenerate a saved plan quote in place with the CURRENT rules/kits/engine —
// what the wizard's "Regenerate BOM" + "Recalculate labour" + Save would do,
// without opening it. Keeps custom labour lines and hour overrides (except
// customs the engine now produces itself). Dry by default; --write persists.
//
// usage: npx tsx scripts/quote-regenerate.mts CF-2026-0086 [envfile] [--write]
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { generateBOM } from '../src/lib/quote-engine/bom-engine'
import { calculateLabour, recalcLabour } from '../src/lib/quote-engine/labour-engine'
import { calculateQuoteSummary } from '../src/lib/quote-engine/pricing'
import { lintQuote } from '../src/lib/quote-engine/lint'
import type { DependencyRule, BOMItem, Product } from '../src/lib/quote-engine/dependency-engine'
import type { DeviceTypeRow, KitComponent, TemplateSupply } from '../src/lib/quote-engine/kits'
import type { BomLabourLine, LabourTimingsMap, LabourData, LabourItem } from '../src/lib/quote-engine/labour-engine'

const args = process.argv.slice(2)
const write = args.includes('--write')
// --keep SKU=qty,SKU=0 — hand edits on the saved quote to carry across the regenerate (0 removes the line)
const keep = new Map<string, number>()
for (const a of args) if (a.startsWith('--keep=')) for (const kv of a.slice(7).split(',')) { const [k, v] = kv.split('='); if (k) keep.set(k.trim(), Number(v)) }
// --counts=code=qty,code=qty — override device counts before regenerating (e.g. cameras added on a plan revision)
const countOverrides = new Map<string, number>()
for (const a of args) if (a.startsWith('--counts=')) for (const kv of a.slice(9).split(',')) { const [k, v] = kv.split('='); if (k) countOverrides.set(k.trim(), Number(v)) }
// --price=70000 — negotiated total ex GST (pricing_snapshot.override); --price=0 clears; omitted = keep whatever the quote has
const priceArg = args.find((a) => a.startsWith('--price='))
const [ref, envArg] = args.filter((a) => !a.startsWith('--'))
if (!ref) { console.error('usage: npx tsx scripts/quote-regenerate.mts CF-2026-0086 [envfile] [--write]'); process.exit(1) }
const envFile = envArg ?? '.env.local'
const env: Record<string, string> = {}
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/(\\n)+$/, '').trim()
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const must = <T,>(r: { data: T | null; error: { message: string } | null }, what: string): T => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data as T }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const quote = must(await sb.from('quotes').select('*').eq('ref', ref).maybeSingle(), 'quote') as Record<string, any> | null
if (!quote) { console.error('no quote', ref); process.exit(1) }
if (quote.quote_mode === 'manual') { console.error(ref, 'is a manual quote — nothing to regenerate'); process.exit(1) }

const [prodRes, ruleRes, defRes, kcRes, dtRes, compRes, supRes, timRes, billRes, liRes, exRes] = await Promise.all([
  sb.from('quote_products').select('*').eq('is_active', true).order('category, name'),
  sb.from('quote_dependency_rules').select('*').eq('is_active', true).order('sort_order'),
  sb.from('quote_template_device_defaults').select('template_id, device_type, product_id'),
  sb.from('quote_product_kit_contents').select('kit_product_id, component_product_id, quantity'),
  sb.from('quote_device_types').select('*').eq('is_active', true).order('sort_order'),
  sb.from('product_kit_components').select('*').eq('status', 'approved').order('sort_order'),
  sb.from('quote_template_device_supply').select('template_id, device_type, supplied_by'),
  sb.from('labour_timings').select('code, name, minutes_per').order('sort_order'),
  sb.from('billing_settings').select('*').single(),
  sb.from('quote_line_items').select('*').eq('quote_id', quote.id).order('sort_order'),
  sb.from('quote_extras').select('category, description, cost, sell').eq('quote_id', quote.id).order('sort_order'),
])
const products = must(prodRes, 'products') as Product[]
const rows = must(ruleRes, 'rules') as Record<string, unknown>[]
const defaults = must(defRes, 'defaults') as { template_id: string; device_type: string; product_id: string }[]
const kitContents = must(kcRes, 'kit contents') as { kit_product_id: string; component_product_id: string; quantity: number }[]
const deviceTypes = must(dtRes, 'device types') as DeviceTypeRow[]
const kitComponents = must(compRes, 'kit components') as KitComponent[]
const templateSupply = must(supRes, 'supply') as TemplateSupply[]
const timings = must(timRes, 'timings') as { code: string; name: string; minutes_per: number }[]
const billing = (billRes.data ?? {}) as { labour_cost_rate?: number; labour_sell_rate?: number }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const oldLines = (liRes.data ?? []) as Record<string, any>[]
const extras = (exRes.data ?? []) as { category: string; description: string; cost: number; sell: number }[]

const templateId: string | null = quote.template_id ?? null
const rules: DependencyRule[] = rows
  .filter((r) => r.is_active && r.auto_add_product_id && (r.is_universal || (templateId && r.template_id === templateId)))
  .map((r) => { const p = products.find((x) => x.id === r.auto_add_product_id); return { ...(r as unknown as DependencyRule), preset: '', auto_add_product_sku: p?.sku ?? null, auto_add_product_name: p?.name ?? null } })
const deviceDefaults: Record<string, string> = {}
for (const d of defaults) if (d.template_id === templateId) deviceDefaults[d.device_type] = d.product_id
const deviceCounts: Record<string, number> = { ...(quote.device_counts ?? {}) }
for (const [code, qty] of countOverrides) { console.log(`  counts: ${code} ${deviceCounts[code] ?? 0} → ${qty}`); deviceCounts[code] = qty }
const siteInfo = {
  site_sqm: quote.site_sqm ?? 0, door_count: quote.door_count ?? 0, external_camera_count: quote.external_camera_count ?? 0,
  concrete_mount_black: quote.concrete_mount_black ?? 0, concrete_mount_white: quote.concrete_mount_white ?? 0,
  cardio_count: quote.cardio_count ?? 0, tv_count: quote.tv_count ?? 0, ceiling_tv_count: quote.ceiling_tv_count ?? 0,
  wall_tv_mount_count: quote.wall_tv_mount_count ?? 0, ceiling_tv_mount_count: quote.ceiling_tv_mount_count ?? 0,
  separate_studio_zone: !!quote.separate_studio_zone, reed_switch_uncabled: quote.reed_switch_uncabled ?? 0, mag_lock_glass: quote.mag_lock_glass ?? 0,
}
const plan = must(await sb.from('plan_files').select('state').eq('quote_id', quote.id).order('created_at', { ascending: false }).limit(1).maybeSingle(), 'plan') as { state?: string | null } | null
const stateGuess = plan?.state ?? (/\b(QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\b/i.exec(String(quote.site_address ?? ''))?.[1]?.toUpperCase() ?? null)
if (stateGuess) (siteInfo as Record<string, unknown>).state = stateGuess
const elec = { elecDoingRoughIn: !!quote.elec_doing_rough_in, elecDoingFitOff: !!quote.elec_doing_fit_off }
const diagnostics: { code: string; message: string; product_id?: string | null }[] = []
const kitQuestions: { component: KitComponent; kit: BOMItem; product: Product }[] = []

// ── BOM ──
const bom = generateBOM(deviceCounts, products, rules, siteInfo, elec, deviceDefaults, kitContents, {
  deviceTypes, kitComponents, kitAnswers: quote.kit_answers ?? {}, templateSupply, templateId, diagnostics, kitQuestions,
})

for (const [sku, qty] of keep) {
  const idx = bom.findIndex((b) => b.sku === sku)
  if (idx < 0) { console.log(`  keep: ${sku} not on the regenerated BOM — ignored`); continue }
  if (qty <= 0) bom.splice(idx, 1)
  else bom[idx] = { ...bom[idx], quantity: qty, notes: [bom[idx].notes, 'qty set by hand'].filter(Boolean).join(' · ') }
}

// ── Labour (as the wizard feeds it) ──
const pById = new Map(products.map((p) => [p.id, p]))
const fitOff = new Map<string, number>()
const bomLabour: BomLabourLine[] = []
for (const b of bom) {
  const p = b.product_id ? pById.get(b.product_id) : undefined
  if (!p || b.quantity <= 0) continue
  if (p.labour_code && p.labour_code !== 'none') fitOff.set(p.labour_code, (fitOff.get(p.labour_code) ?? 0) + b.quantity)
  if ((p as unknown as { requires_cable_run?: boolean }).requires_cable_run) bomLabour.push({ labour_code: null, quantity: b.quantity, requires_cable: true, scope_role: null })
  if (p.scope_role && p.scope_role !== 'none') bomLabour.push({ labour_code: null, scope_role: p.scope_role, quantity: b.quantity })
}
const counts: Record<string, number> = {}
for (const b of bom) if (b.device_type_code) counts[b.device_type_code] = (counts[b.device_type_code] ?? 0) + b.quantity
for (const dt of deviceTypes) {
  const n = deviceCounts[dt.code] || 0
  if (n <= 0 || !(dt.count_only || !dt.has_hardware)) continue
  counts[dt.code] = n
  if (dt.has_hardware || dt.count_only) continue
  if (dt.labour_code && dt.labour_code !== 'none') fitOff.set(dt.labour_code, (fitOff.get(dt.labour_code) ?? 0) + n)
  bomLabour.push({ labour_code: null, quantity: n, requires_cable: true, scope_role: null })
}
for (const [labour_code, quantity] of fitOff) bomLabour.unshift({ labour_code, quantity, scope_role: null })
const timingsMap: LabourTimingsMap = Object.fromEntries(timings.map((t) => [t.code, t]))
const timingOverrides = Object.fromEntries(timings.map((t) => [t.code, t.minutes_per]))
const fresh = calculateLabour(counts, siteInfo, { labourCostRate: billing.labour_cost_rate, labourSellRate: billing.labour_sell_rate }, timingOverrides, { ...elec, isManualQuote: false }, bomLabour, timingsMap)

// Merge with the saved labour the way the wizard's regenerateLabour does:
// deleted keys stay deleted, hour overrides survive, custom lines survive —
// unless the engine now produces that line itself (name match), in which
// case the custom one is dropped so it isn't counted twice.
const saved = (quote.labour_data ?? null) as (LabourData & { deleted_labour_keys?: string[] }) | null
const deleted = new Set<string>(Array.isArray(saved?.deleted_labour_keys) ? saved!.deleted_labour_keys : [])
const key = (section: string, item: string) => `${section}::${item}`
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const droppedCustoms: string[] = []
const merged: LabourData = {
  ...fresh,
  sections: fresh.sections.map((section) => {
    const old = saved?.sections?.find((s) => s.name === section.name)
    const engineNames = new Set(section.items.map((i) => norm(i.name)))
    const formula: LabourItem[] = section.items
      .filter((it) => !deleted.has(key(section.name, it.name)))
      .map((it) => {
        const o = old?.items.find((x) => x.name === it.name && !x.isCustom)
        if (!o) return it
        return Math.abs(o.hours - o.defaultHours) > 0.001 ? { ...it, hours: o.hours } : it
      })
    const customs = (old?.items ?? []).filter((x) => x.isCustom).filter((x) => {
      const n = norm(x.name)
      const dup = [...engineNames].some((e) => e.includes(n) || n.includes(e) || (n.includes('tailgat') && e.includes('tailgat')) || (n.includes('access control wiring') && e.includes('access control wiring')))
      if (dup) droppedCustoms.push(`${section.name}: ${x.name} (${x.hours} h)`)
      return !dup
    })
    return { ...section, items: [...formula, ...customs] }
  }),
}
const labour = recalcLabour(merged)

// ── Pricing ──
const priceOverrideExGST = priceArg ? Number(priceArg.slice(8)) || 0 : Number(quote.pricing_snapshot?.override?.exGST) || 0
const opts = { discountPercent: Number(quote.discount_percent) || 0, electricianCost: Number(quote.electrician_cost) || 0, isInterstate: !!quote.is_interstate, priceOverrideExGST }
const summary = calculateQuoteSummary(bom, labour, extras, opts)
const oldSplit = quote.pricing_snapshot?.split
const total = Math.round(summary.totalExGST * 100) / 100
let pricing: Record<string, unknown> = { ...summary, quote_mode: 'plan', split: { mode: 'cost' } }
if (quote.quote_type === 'progress' && oldSplit?.mode === 'manual' && Number(oldSplit.pp1ExGST) > 0 && Number(oldSplit.pp1ExGST) < total) {
  const pp1 = Number(oldSplit.pp1ExGST)
  pricing = { ...pricing, pp1: { ...summary.pp1, total: pp1 }, pp2: { ...summary.pp2, total: Math.round((total - pp1) * 100) / 100 }, split: { mode: 'manual', pp1ExGST: pp1, costPp1: summary.pp1.total, adjustment: Math.round((pp1 - summary.pp1.total) * 100) / 100 } }
}

// ── Lint ──
const findings = lintQuote({
  bomItems: bom, deviceCounts, siteInfo, products, deviceTypes, rules, kitComponents, templateId, templateSupply,
  elecDoingRoughIn: elec.elecDoingRoughIn, isInterstate: opts.isInterstate, electricianCost: opts.electricianCost,
  labourTimingCodes: timings.map((t) => t.code), unansweredKitQuestions: kitQuestions, diagnostics, quoteMode: 'plan',
})

// ── Report ──
const oldTotal = Number(quote.pricing_snapshot?.totalExGST) || 0
const skuOf = (l: Record<string, unknown>) => String(l.sku || l.product_name || '')
const oldQty = new Map<string, number>(); for (const l of oldLines) oldQty.set(skuOf(l), (oldQty.get(skuOf(l)) ?? 0) + Number(l.quantity))
const newQty = new Map<string, number>(); for (const b of bom) newQty.set(b.sku || b.product_name, (newQty.get(b.sku || b.product_name) ?? 0) + b.quantity)
console.log(`\n${ref} — ${write ? 'WRITING' : 'dry run'}`)
console.log(`lines ${oldLines.length} → ${bom.length} · materials $${summary.materials.sell.toFixed(2)} · labour ${labour.grandTotalHours} h $${labour.grandTotalSell.toFixed(2)} · total ex GST $${oldTotal.toFixed(2)} → $${total.toFixed(2)}`)
if (summary.override) console.log(`negotiated price: $${summary.override.exGST.toFixed(2)} ex GST (list $${summary.override.listExGST.toFixed(2)}, ${summary.override.saving >= 0 ? 'saving' : 'adds'} $${Math.abs(summary.override.saving).toFixed(2)}) · PP1 $${Number(pricing.pp1 && (pricing.pp1 as { total: number }).total).toFixed(2)} / PP2 $${Number(pricing.pp2 && (pricing.pp2 as { total: number }).total).toFixed(2)}`)
console.log('\nBOM changes (qty by product)')
for (const [sku, q] of newQty) { const o = oldQty.get(sku) ?? 0; if (o !== q) console.log(`  ${sku.padEnd(24)} ${o} → ${q}`) }
for (const [sku, q] of oldQty) if (!newQty.has(sku)) console.log(`  ${sku.padEnd(24)} ${q} → 0 (removed)`)
console.log('\nLabour')
for (const s of labour.sections) { console.log(`  ${s.name} — ${s.totalHours} h`); for (const it of s.items) if (it.isCustom || Math.abs(it.hours - it.defaultHours) > 0.001 || /veyla|tailgat|wiring/i.test(it.name)) console.log(`      ${it.isCustom ? '[custom] ' : ''}${it.name} ${it.hours} h`) }
if (droppedCustoms.length) console.log('  dropped custom lines the engine now supplies:', droppedCustoms.join('; '))
console.log('\nLint:', findings.filter((f) => f.code !== 'cost_unknown_age' && f.code !== 'cost_stale').map((f) => `${f.severity} ${f.code}`).join(', ') || 'clean')
if (kitQuestions.length) console.log('Unanswered kit questions:', kitQuestions.map((q) => q.component.ask_prompt).join(' | '))

if (!write) { console.log('\n(dry run — add --write to persist)'); process.exit(0) }

// ── Persist (mirrors the wizard save) ──
must(await sb.from('quote_line_items').delete().eq('quote_id', quote.id), 'delete lines')
must(await sb.from('quote_line_items').insert(bom.map((item, i) => ({
  quote_id: quote.id, product_id: item.product_id,
  device_type_code: item.device_type_code, device_type_legend: item.device_type_legend,
  category: item.category, product_name: item.product_name,
  sku: item.sku, supplier: item.supplier, quantity: item.quantity,
  cost_price: item.cost_price, markup: item.markup, sell_price: item.sell_price,
  auto_added: item.auto_added, rule_description: item.rule_description,
  notes: item.notes, sort_order: i,
  customer_supplied: item.customer_supplied ?? false,
  kit_parent_product_id: item.kit_parent_product_id ?? null,
}))), 'insert lines')
must(await sb.from('quotes').update({
  ...(countOverrides.size ? { device_counts: deviceCounts } : {}),
  labour_data: { ...labour, deleted_labour_keys: Array.from(deleted), quote_mode: 'plan' },
  pricing_snapshot: pricing,
  lint_findings: findings,
  lint_checked_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}).eq('id', quote.id), 'update quote')
console.log(`\nwritten: ${bom.length} lines, labour + pricing snapshot updated on ${ref}`)
