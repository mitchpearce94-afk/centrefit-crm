/**
 * Quote engine dry run — what would the engine produce for an existing quote
 * TODAY, with the current products, rules, kits and device types? Prints the
 * BOM lines, lint findings and labour sections without touching the quote.
 *
 *   npx tsx scripts/quote-engine-dryrun.mts CF-2026-0079 [path/to/.env]
 *
 * Mirrors the loaders in src/app/(dashboard)/quoting/new/page.tsx and the
 * wizard's rulesForTemplate / bomLabourLines / bomDeviceCounts so a quote can
 * be checked from a terminal (24 Sep 2026: CF-2026-0079 had every K6000 part
 * twice — this is how the fix was proven before Mitchell re-ran the quote).
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { generateBOM, lintQuote, calculateLabour } from '../src/lib/quote-engine/index'
import type { DependencyRule, Product, BOMItem, LabourTimingsMap, BomLabourLine } from '../src/lib/quote-engine/index'
import type { DeviceTypeRow, KitComponent, TemplateSupply } from '../src/lib/quote-engine/kits'

const ref = process.argv[2]
if (!ref) { console.error('usage: npx tsx scripts/quote-engine-dryrun.mts CF-2026-0079 [envfile]'); process.exit(1) }
const envFile = process.argv[3] ?? '.env.local'
const env: Record<string, string> = {}
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  // `vercel env pull` keeps the literal backslash-n some values carry in Vercel (see memory: printf not echo)
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/(\\n)+$/, '').trim()
}
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) { console.error('no Supabase URL/key in', envFile); process.exit(1) }
const sb = createClient(url, key, { auth: { persistSession: false } })

const must = <T,>(r: { data: T | null; error: { message: string } | null }, what: string): T => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data as T }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const quote = must(await sb.from('quotes').select('*').eq('ref', ref).maybeSingle(), 'quote') as Record<string, any> | null
if (!quote) { console.error('no quote', ref); process.exit(1) }

const [prodRes, tplRes, ruleRes, defRes, kcRes, dtRes, compRes, supRes, timRes, billRes] = await Promise.all([
  sb.from('quote_products').select('*').eq('is_active', true).order('category, name'),
  sb.from('quote_rule_templates').select('*').eq('is_active', true).order('sort_order'),
  sb.from('quote_dependency_rules').select('*').eq('is_active', true).order('sort_order'),
  sb.from('quote_template_device_defaults').select('template_id, device_type, product_id'),
  sb.from('quote_product_kit_contents').select('kit_product_id, component_product_id, quantity'),
  sb.from('quote_device_types').select('*').eq('is_active', true).order('sort_order'),
  sb.from('product_kit_components').select('*').eq('status', 'approved').order('sort_order'),
  sb.from('quote_template_device_supply').select('template_id, device_type, supplied_by'),
  sb.from('labour_timings').select('code, name, minutes_per').order('sort_order'),
  sb.from('billing_settings').select('*').single(),
])
const products = must(prodRes, 'products') as Product[]
const templates = must(tplRes, 'templates') as { id: string; name: string }[]
const rows = must(ruleRes, 'rules') as Record<string, unknown>[]
const defaults = must(defRes, 'defaults') as { template_id: string; device_type: string; product_id: string }[]
const kitContents = must(kcRes, 'kit contents') as { kit_product_id: string; component_product_id: string; quantity: number }[]
const deviceTypes = must(dtRes, 'device types') as DeviceTypeRow[]
const kitComponents = must(compRes, 'kit components') as KitComponent[]
const templateSupply = must(supRes, 'supply') as TemplateSupply[]
const timings = must(timRes, 'timings') as { code: string; name: string; minutes_per: number }[]
const billing = (billRes.data ?? {}) as { labour_cost_rate?: number; labour_sell_rate?: number }

const templateId: string | null = quote.template_id ?? null
const rules: DependencyRule[] = rows
  .filter((r) => r.is_active && r.auto_add_product_id && (r.is_universal || (templateId && r.template_id === templateId)))
  .map((r) => {
    const p = products.find((x) => x.id === r.auto_add_product_id)
    return { ...(r as unknown as DependencyRule), preset: '', auto_add_product_sku: p?.sku ?? null, auto_add_product_name: p?.name ?? null }
  })
const deviceDefaults: Record<string, string> = {}
for (const d of defaults) if (d.template_id === templateId) deviceDefaults[d.device_type] = d.product_id
const deviceCounts: Record<string, number> = quote.device_counts ?? {}
const siteInfo = {
  site_sqm: quote.site_sqm ?? 0, door_count: quote.door_count ?? 0, external_camera_count: quote.external_camera_count ?? 0,
  concrete_mount_black: quote.concrete_mount_black ?? 0, concrete_mount_white: quote.concrete_mount_white ?? 0,
  cardio_count: quote.cardio_count ?? 0, tv_count: quote.tv_count ?? 0, ceiling_tv_count: quote.ceiling_tv_count ?? 0,
  wall_tv_mount_count: quote.wall_tv_mount_count ?? 0, ceiling_tv_mount_count: quote.ceiling_tv_mount_count ?? 0,
  separate_studio_zone: !!quote.separate_studio_zone, reed_switch_uncabled: quote.reed_switch_uncabled ?? 0, mag_lock_glass: quote.mag_lock_glass ?? 0,
}
// state drives the QLD-only callout line; the wizard takes it from the plan / site address
const plan = must(await sb.from('plan_files').select('state').eq('quote_id', quote.id).order('created_at', { ascending: false }).limit(1).maybeSingle(), 'plan') as { state?: string | null } | null
const stateGuess = plan?.state ?? (/\b(QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\b/i.exec(String(quote.site_address ?? ''))?.[1]?.toUpperCase() ?? null)
if (stateGuess) (siteInfo as Record<string, unknown>).state = stateGuess
const elec = { elecDoingRoughIn: !!quote.elec_doing_rough_in, elecDoingFitOff: !!quote.elec_doing_fit_off }
const diagnostics: { code: string; message: string; product_id?: string | null }[] = []
const kitQuestions: { component: KitComponent; kit: BOMItem; product: Product }[] = []

const bom = generateBOM(deviceCounts, products, rules, siteInfo, elec, deviceDefaults, kitContents, {
  deviceTypes, kitComponents, kitAnswers: quote.kit_answers ?? {}, templateSupply, templateId, diagnostics, kitQuestions,
})

console.log(`\n${ref} — ${templates.find((t) => t.id === templateId)?.name ?? 'no template'} · mode ${quote.quote_mode} · counts ${JSON.stringify(deviceCounts)} · sqm ${siteInfo.site_sqm} doors ${siteInfo.door_count}`)
console.log(`rules in play: ${rules.length}\n`)
console.log('BOM')
for (const b of bom) console.log(`  ${String(b.quantity).padStart(3)} × ${(b.sku || '').padEnd(20)} ${b.product_name.slice(0, 58).padEnd(58)} $${(b.sell_price * b.quantity).toFixed(2).padStart(9)}  ${b.kit_parent_product_id ? '[kit]' : b.auto_added ? '[rule]' : b.device_type_code ? `[${b.device_type_code}]` : ''} ${b.rule_description ?? ''}${b.notes ? ' · ' + b.notes : ''}`)
console.log(`  = $${bom.reduce((t, b) => t + b.sell_price * b.quantity, 0).toFixed(2)} sell across ${bom.length} lines`)

const findings = lintQuote({
  bomItems: bom, deviceCounts, siteInfo, products, deviceTypes, rules, kitComponents, templateId, templateSupply,
  elecDoingRoughIn: elec.elecDoingRoughIn, isInterstate: !!quote.is_interstate, electricianCost: Number(quote.electrician_cost) || 0,
  labourTimingCodes: timings.map((t) => t.code), unansweredKitQuestions: kitQuestions, diagnostics, quoteMode: quote.quote_mode === 'manual' ? 'manual' : 'plan',
})
console.log('\nLINT')
for (const f of findings) if (f.code !== 'cost_unknown_age' && f.code !== 'cost_stale') console.log(`  ${f.severity.padEnd(5)} ${f.code.padEnd(26)} ${f.message}`)
console.log(`  (+ ${findings.filter((f) => f.code === 'cost_unknown_age' || f.code === 'cost_stale').length} cost-age warnings)`)

// labour, the way the wizard feeds it once the BOM exists
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
const labour = calculateLabour(counts, siteInfo, { labourCostRate: billing.labour_cost_rate, labourSellRate: billing.labour_sell_rate }, {}, { ...elec, isManualQuote: quote.quote_mode === 'manual' }, bomLabour, timingsMap)
console.log('\nLABOUR')
for (const s of labour.sections) {
  console.log(`  ${s.name} — ${s.totalHours} h, $${s.totalSell}`)
  for (const it of s.items) console.log(`      ${it.name.padEnd(36)} ${String(it.hours).padStart(6)}  ${it.formula}`)
}
console.log(`  = ${labour.grandTotalHours} h, $${labour.grandTotalSell} sell\n`)
