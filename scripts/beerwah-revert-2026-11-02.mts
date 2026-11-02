// @ts-nocheck
// One-off: CF-2026-0110 Ty Menzies Warehouse – Beerwah. Mitchell 2 Nov 2026: "revert the
// quote back to how it was before I removed the rough in cost". The 29 Oct edit (the
// $19,831.79 inc version Mark sent 29 Oct 14:43) dropped Rough In (18 runs: cable pulling 18 h +
// termination 2.4 h), the cable/bracket materials, the 22" monitor, Server rack build 6 h,
// Hardware Incidentals $400, and bumped camera install 3 h → 5 h. This puts the quote back to
// the as-sent 26 Oct state: $23,919.65 ex / $26,311.62 inc (verified against the sent proposal).
// Sources: ~/.cortex/backups/plans/quote-6e8bfe07….pricing.before-sensors-2026-10-26.json (lines +
// category totals) and CMEM obs #22956 (item-level labour on 26 Oct).
// usage: npx tsx scripts/beerwah-revert-2026-11-02.mts [--write]
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { recalcLabour } from '../src/lib/quote-engine/labour-engine'
import { calculateQuoteSummary } from '../src/lib/quote-engine/pricing'

const write = process.argv.includes('--write')
const env: Record<string, string> = {}
for (const line of readFileSync('.env.gc-probe', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/(\\n)+$/, '').trim()
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data }
const SENT_EX_GST = 23919.65
const QUOTE_ID = '6e8bfe07-d23e-484a-a02d-927aa8c01fa4'

const quote = must(await sb.from('quotes').select('*').eq('id', QUOTE_ID).single(), 'quote')
if (quote.ref !== 'CF-2026-0110') throw new Error(`wrong quote ${quote.ref}`)
const oldLines = must(await sb.from('quote_line_items').select('*').eq('quote_id', QUOTE_ID).order('sort_order'), 'lines')
const extras = must(await sb.from('quote_extras').select('category, description, cost, sell').eq('quote_id', QUOTE_ID).order('sort_order'), 'extras')
const backup = JSON.parse(readFileSync('/Users/mitchellpearce/.cortex/backups/plans/quote-6e8bfe07-d23e-484a-a02d-927aa8c01fa4.pricing.before-sensors-2026-10-26.json', 'utf8'))

// ── BOM: put the four removed 26 Oct lines back where they were ──
const RESTORE = ['GLO6C1402300', 'DHI-LM22-H200', 'DHU7061', 'CLI155N']
const have = new Set(oldLines.map((l) => l.sku))
for (const s of RESTORE) if (have.has(s)) throw new Error(`${s} already on the quote — stop`)
const strip = (l) => ({
  device_type_code: l.device_type_code, device_type_legend: l.device_type_legend, category: l.category,
  product_id: l.product_id, product_name: l.product_name, sku: l.sku, supplier: l.supplier,
  quantity: l.quantity, cost_price: Number(l.cost_price), markup: Number(l.markup), sell_price: Number(l.sell_price),
  notes: l.notes ?? '', auto_added: l.auto_added, rule_description: l.rule_description,
  customer_supplied: l.customer_supplied ?? false, kit_parent_product_id: l.kit_parent_product_id ?? null,
})
// walk the 26 Oct order, keeping current data for lines that survived, then the 3 lines added after the backup
const bom = []
const current = new Map(oldLines.map((l) => [l.sku, l]))
for (const b of backup.lines) {
  if (RESTORE.includes(b.sku)) bom.push({ ...strip(b), restored: true })
  else if (current.has(b.sku)) bom.push(strip(current.get(b.sku)))
  else throw new Error(`backup line ${b.sku} missing from the current quote — unexpected`)
}
for (const l of oldLines) if (!backup.lines.some((b) => b.sku === l.sku)) bom.push(strip(l))
if (bom.length !== 40) throw new Error(`expected 40 lines, got ${bom.length}`)

// ── labour: current sections edited back to the 26 Oct structure ──
const saved = structuredClone(quote.labour_data)
const deleted = new Set(Array.isArray(saved.deleted_labour_keys) ? saved.deleted_labour_keys : [])
const section = (n) => { const s = saved.sections.find((x) => x.name === n); if (!s) throw new Error(`no section ${n}`); return s }
const RUNS = 18
const ri = section('Rough In')
if (ri.items.length) throw new Error('Rough In already has items — stop')
ri.items = [
  { name: 'Cable pulling', formula: `${RUNS} runs × 60 min (1 hr per run, 2-person crew)`, defaultHours: RUNS, hours: RUNS },
  { name: 'Termination', formula: `${RUNS} cables × 8 min (both ends)`, defaultHours: 2.4, hours: 2.4 },
]
const fo = section('Fit Off')
const cam = fo.items.find((i) => i.name === 'Camera install (plaster)'); if (!cam) throw new Error('no camera line')
cam.hours = 3 // 6 × 30 min, as sent (bumped to 5 h in the 29 Oct edit)
const cb = section('Commissioning & Build')
if (cb.items.some((i) => i.name === 'Server rack build')) throw new Error('rack build already present')
cb.items.unshift({ name: 'Server rack build', formula: 'Fixed 6 hrs', defaultHours: 6, hours: 6 })
const ot = section('Other')
if (ot.items.some((i) => i.name === 'Hardware Incidentals')) throw new Error('incidentals already present')
const adminIdx = ot.items.findIndex((i) => i.name === 'Administration')
ot.items.splice(adminIdx, 0, { name: 'Hardware Incidentals', formula: 'Flat dollar amount', defaultHours: 200, hours: 400, isDollarInput: true })
for (const k of ['Rough In::Cable pulling', 'Rough In::Termination', 'Commissioning & Build::Server rack build', 'Other::Hardware Incidentals']) deleted.delete(k)
const labour = recalcLabour(saved)

// ── pricing ──
const opts = { discountPercent: Number(quote.discount_percent) || 0, electricianCost: Number(quote.electrician_cost) || 0, isInterstate: !!quote.is_interstate, priceOverrideExGST: Number(quote.pricing_snapshot?.override?.exGST) || 0 }
const summary = calculateQuoteSummary(bom, labour, extras, opts)
const total = Math.round(summary.totalExGST * 100) / 100
const pricing = { ...summary, quote_mode: 'plan', split: { mode: 'cost' } }

// ── report ──
const oldTotal = Number(quote.pricing_snapshot?.totalExGST) || 0
console.log(`\nCF-2026-0110 — ${write ? 'WRITING' : 'dry run'}`)
console.log(`lines ${oldLines.length} → ${bom.length} · materials $${summary.materials.sell.toFixed(2)} · labour ${labour.grandTotalHours} h $${labour.grandTotalSell.toFixed(2)} (cost $${labour.grandTotalCost.toFixed(2)})`)
console.log(`total ex GST $${oldTotal.toFixed(2)} → $${total.toFixed(2)} (inc $${(total * 1.1).toFixed(2)}) · PP1 $${pricing.pp1.total.toFixed(2)} / PP2 $${pricing.pp2.total.toFixed(2)}`)
console.log('labour by category', summary.labour.byCategory)
for (const b of bom) if (b.restored) console.log(`  RESTORED ${b.quantity} × ${b.sku} $${(b.sell_price * b.quantity).toFixed(2)}  ${b.product_name.slice(0, 60)}`)
for (const s of labour.sections) console.log(`  ${s.name}: ${s.totalHours} h · $${s.totalSell} sell · ${s.items.map((i) => `${i.name} ${i.hours}`).join(', ')}`)
if (Math.abs(total - SENT_EX_GST) > 0.01) throw new Error(`rebuilt total $${total} ≠ sent $${SENT_EX_GST} — stop`)
console.log(`✓ matches the 26 Oct sent total $${SENT_EX_GST} ex GST`)

if (!write) { console.log('\n(dry run — add --write to persist)'); process.exit(0) }
must(await sb.from('quote_line_items').delete().eq('quote_id', QUOTE_ID), 'delete lines')
must(await sb.from('quote_line_items').insert(bom.map(({ restored, ...item }, i) => ({ quote_id: QUOTE_ID, ...item, sort_order: i }))), 'insert lines')
must(await sb.from('quotes').update({
  labour_data: { ...labour, deleted_labour_keys: Array.from(deleted), quote_mode: 'plan' },
  pricing_snapshot: pricing, updated_at: new Date().toISOString(),
}).eq('id', QUOTE_ID), 'update quote')
console.log('\nwritten')
