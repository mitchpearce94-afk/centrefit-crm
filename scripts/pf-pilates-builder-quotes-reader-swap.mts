// 19 Oct 2026 — Mitchell: "no not the HID reader, its the data logic one".
// Swap the HID Signo 20 line on CF-2026-0093…0101 for the PFRRK Datalogic kit
// and expand the kit's approved per-door parts (PIM S4, USB→RS232, DB9-F),
// exactly as the wizard's manual add would. Controller + enclosure (fixed kit
// parts) are already on the quotes. Reprices + relints each quote.
// usage: npx tsx scripts/pf-pilates-builder-quotes-reader-swap.mts [envfile] [--write]
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { calculateQuoteSummary } from '../src/lib/quote-engine/pricing'
import { lintQuote } from '../src/lib/quote-engine/lint'
import type { BOMItem, Product, DependencyRule } from '../src/lib/quote-engine/dependency-engine'
import type { DeviceTypeRow, KitComponent, TemplateSupply } from '../src/lib/quote-engine/kits'

const args = process.argv.slice(2); const write = args.includes('--write')
const envFile = args.find((a) => !a.startsWith('--')) ?? '.env.gc-probe'
const env: Record<string, string> = {}
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/(\\n)+$/, '').trim() }
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const must = <T,>(r: { data: T | null; error: { message: string } | null }, what: string): T => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data as T }

const SIGNO = '768f83a2-84db-4db3-89e8-b0df916dcc6f'
const PFRRK = '502b7660-ca83-4838-a61a-9c5d0709edeb'
const KIT_PARTS = ['f3d29163-6646-45aa-925c-59ef4a1842be', '1c275733-1def-49cc-9a77-75827359ee73', 'a046d790-289f-43bd-9628-7fe1d01612c0'] // PIM S4, USB→RS232, DB9-F
const REFS = Array.from({ length: 9 }, (_, i) => `CF-2026-${String(93 + i).padStart(4, '0')}`)

const [prodRes, dtRes, compRes, supRes, timRes] = await Promise.all([
  sb.from('quote_products').select('*').eq('is_active', true), sb.from('quote_device_types').select('*').eq('is_active', true),
  sb.from('product_kit_components').select('*').eq('status', 'approved'), sb.from('quote_template_device_supply').select('template_id, device_type, supplied_by'), sb.from('labour_timings').select('code'),
])
const products = must(prodRes, 'products') as Product[]
const deviceTypes = must(dtRes, 'dt') as DeviceTypeRow[]; const kitComponents = must(compRes, 'kc') as KitComponent[]
const templateSupply = must(supRes, 'sup') as TemplateSupply[]; const timingCodes = (must(timRes, 't') as { code: string }[]).map((t) => t.code)
const prod = (id: string) => { const p = products.find((x) => x.id === id); if (!p) throw new Error(`product ${id} missing`); return p }
const lineFrom = (p: Product, notes: string, kitParent: string | null) => ({
  product_id: p.id, device_type_code: null, device_type_legend: null, category: p.category || 'Access Control', product_name: p.name, sku: p.sku ?? '', supplier: p.supplier ?? '',
  quantity: 1, cost_price: Number(p.cost_price) || 0, markup: Number((p as unknown as { markup: number }).markup) || 0, sell_price: Number(p.sell_price) || 0,
  auto_added: false, rule_description: null, notes, customer_supplied: false, kit_parent_product_id: kitParent,
})
const kit = prod(PFRRK)
const newLines = [lineFrom(kit, '', null), ...KIT_PARTS.map((id) => lineFrom(prod(id), `1 from kit: ${kit.name}`, PFRRK))]
console.log('Replacing HID Signo with:'); for (const l of newLines) console.log(`  1 × ${l.product_name} [${l.sku}] $${l.cost_price.toFixed(2)} → $${l.sell_price.toFixed(2)}`)

for (const ref of REFS) {
  const q = must(await sb.from('quotes').select('*').eq('ref', ref).single(), ref) as Record<string, any>
  if (q.status !== 'draft') { console.log(`${ref}: status ${q.status} — skipped`); continue }
  const lines = must(await sb.from('quote_line_items').select('*').eq('quote_id', q.id).order('sort_order'), 'lines') as Record<string, any>[]
  const signoIdx = lines.findIndex((l) => l.product_id === SIGNO)
  if (signoIdx < 0) { console.log(`${ref}: no Signo line (already swapped?) — skipped`); continue }
  const kept = lines.filter((l) => l.product_id !== SIGNO)
  const rebuilt = [...kept.slice(0, signoIdx), ...newLines.map((l) => ({ ...l, quote_id: q.id })), ...kept.slice(signoIdx)].map((l, i) => ({ ...l, sort_order: i }))
  const bom = rebuilt.map((l) => ({ device_type_code: null, device_type_legend: null, category: l.category, product_id: l.product_id, product_name: l.product_name, sku: l.sku, supplier: l.supplier, quantity: l.quantity, cost_price: Number(l.cost_price), markup: Number(l.markup), sell_price: Number(l.sell_price), notes: l.notes ?? '', auto_added: false, rule_description: null }) as BOMItem)
  const summary = calculateQuoteSummary(bom, q.labour_data, [], { discountPercent: Number(q.discount_percent) || 0, electricianCost: 0, isInterstate: !!q.is_interstate, priceOverrideExGST: 0 })
  const siteInfo = { site_sqm: 0, door_count: 1, external_camera_count: 0, concrete_mount_black: 0, concrete_mount_white: 0, cardio_count: 0, tv_count: 0, ceiling_tv_count: 0, wall_tv_mount_count: 0, ceiling_tv_mount_count: 0, separate_studio_zone: false, reed_switch_uncabled: 0, mag_lock_glass: 1 }
  const lint = lintQuote({ bomItems: bom, deviceCounts: {}, siteInfo: siteInfo as never, products, deviceTypes, rules: [] as DependencyRule[], kitComponents, templateId: null, templateSupply, elecDoingRoughIn: true, isInterstate: !!q.is_interstate, electricianCost: 0, labourTimingCodes: timingCodes, unansweredKitQuestions: [], diagnostics: [], quoteMode: 'manual' })
  const errs = lint.filter((f) => f.severity === 'error').map((f) => `${f.code}${q.lint_overrides?.[`${f.code}|${f.message}`] ? ' (overridden)' : ''}`)
  console.log(`${ref}: parts $${summary.materials.sell.toFixed(2)} · total $${summary.totalExGST.toFixed(2)} ex GST ($${summary.totalIncGST.toFixed(2)} inc) · lint errors: ${errs.join(', ') || 'none'}`)
  if (!write) continue
  must(await sb.from('quote_line_items').delete().eq('quote_id', q.id), 'delete lines')
  must(await sb.from('quote_line_items').insert(rebuilt.map(({ id: _id, created_at: _c, rfq_sent_at: _r, cost_confirmed_at: _cc, ...l }) => l)), 'insert lines')
  must(await sb.from('quotes').update({
    pricing_snapshot: { ...q.pricing_snapshot, ...summary, scope_of_works: q.pricing_snapshot?.scope_of_works, quote_mode: 'manual', split: { mode: 'cost' } },
    lint_findings: lint, lint_checked_at: new Date().toISOString(),
    notes: `${q.notes ?? ''} Reader swapped HID Signo → PFRRK Datalogic kit (+ PIM S4, USB→RS232, DB9-F) 19 Oct 2026 per Mitchell.`.trim(),
  }).eq('id', q.id), 'update quote')
}
console.log(write ? 'WRITTEN.' : 'DRY RUN — re-run with --write.')
