// @ts-nocheck
// One-off: CF-2026-0026 Buckley Road Child Care (DWP Electrical) — Aite Group 27 Oct 2026:
// CCTV to 12 external cameras (Rev D markup), Dahua NVR + 30 days kept, router/switches/WAPs
// removed (supplied by others). Access control, alarm, intercom untouched. Revert to draft.
// usage: npx tsx scripts/buckley-reprice-2026-10-27.mts [--write]
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { calculateLabour, recalcLabour } from '../src/lib/quote-engine/labour-engine'
import { calculateQuoteSummary } from '../src/lib/quote-engine/pricing'

const write = process.argv.includes('--write')
const PANELS = Number((process.argv.find((a) => a.startsWith('--panels=')) ?? '--panels=2').slice(9))
const env: Record<string, string> = {}
for (const line of readFileSync('.env.gc-probe', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/(\\n)+$/, '').trim()
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data }

const quote = must(await sb.from('quotes').select('*').eq('ref', 'CF-2026-0026').single(), 'quote')
const [prodRes, dtRes, timRes, billRes, liRes, exRes] = await Promise.all([
  sb.from('quote_products').select('*').order('category, name'),
  sb.from('quote_device_types').select('*').eq('is_active', true).order('sort_order'),
  sb.from('labour_timings').select('code, name, minutes_per').order('sort_order'),
  sb.from('billing_settings').select('*').single(),
  sb.from('quote_line_items').select('*').eq('quote_id', quote.id).order('sort_order'),
  sb.from('quote_extras').select('category, description, cost, sell').eq('quote_id', quote.id).order('sort_order'),
])
const products = must(prodRes, 'products'); const deviceTypes = must(dtRes, 'device types'); const timings = must(timRes, 'timings')
const billing = billRes.data ?? {}; const oldLines = liRes.data ?? []; const extras = exRes.data ?? []
const pById = new Map(products.map((p) => [p.id, p]))
const nvr16 = pById.get('cbbed7f6-0890-4fe3-beca-fde0b054f3e3') // DAHUA LITE 16CH NVR 16xPoE 2xSATA

// ── edited BOM from the saved lines ──
const REMOVE = new Set(['NHU-UCG-FIBER', 'NHU-USW-PRO-48-POE', 'NHU-U7-PRO'])
const QTY: Record<string, number> = { 'DH-HDW3666TMP-White': 12, 'ST8000VX0022': 2, 'PFB204W': 9, '24PPWK': PANELS, 'CPL160': PANELS * 24, 'EMP-CAT6UTPST': 1 }
const bom = []
for (const l of oldLines) {
  if (REMOVE.has(l.sku)) continue
  const item = {
    device_type_code: l.device_type_code, device_type_legend: l.device_type_legend, category: l.category,
    product_id: l.product_id, product_name: l.product_name, sku: l.sku, supplier: l.supplier,
    quantity: QTY[l.sku] ?? l.quantity, cost_price: Number(l.cost_price), markup: Number(l.markup), sell_price: Number(l.sell_price),
    notes: l.notes ?? '', auto_added: l.auto_added, rule_description: l.rule_description,
    customer_supplied: l.customer_supplied ?? false, kit_parent_product_id: l.kit_parent_product_id ?? null,
  }
  if (l.sku === 'DHU10568') Object.assign(item, {
    product_id: nvr16.id, product_name: nvr16.name, sku: nvr16.sku, supplier: nvr16.supplier,
    cost_price: Number(nvr16.cost_price), markup: Number(nvr16.markup), sell_price: Number(nvr16.sell_price),
    rule_description: '16-channel NVR for up to 16 cameras',
  })
  bom.push(item)
}

// ── counts / site info ──
const deviceCounts = { ...(quote.device_counts ?? {}), camera_white: 12, wap: 0 }
const siteInfo = {
  site_sqm: quote.site_sqm ?? 0, door_count: quote.door_count ?? 0, external_camera_count: 9,
  concrete_mount_black: quote.concrete_mount_black ?? 0, concrete_mount_white: quote.concrete_mount_white ?? 0,
  cardio_count: 0, tv_count: 0, ceiling_tv_count: 0, wall_tv_mount_count: 0, ceiling_tv_mount_count: 0,
  separate_studio_zone: !!quote.separate_studio_zone, reed_switch_uncabled: quote.reed_switch_uncabled ?? 0, mag_lock_glass: quote.mag_lock_glass ?? 0, state: 'QLD',
}
const elec = { elecDoingRoughIn: !!quote.elec_doing_rough_in, elecDoingFitOff: !!quote.elec_doing_fit_off }

// ── labour: edit the saved labour in place (the Aug 2026 engine run) so alarm /
// access / intercom hours stay exactly as priced; only CCTV + network lines move.
const saved = structuredClone(quote.labour_data)
const deleted = new Set(Array.isArray(saved.deleted_labour_keys) ? saved.deleted_labour_keys : [])
const CABLES = 62 - 18 - 15 // was 62: 18 cameras and 15 WAPs gone
const edit = (section, name, fn) => { const s = saved.sections.find((x) => x.name === section); const i = s.items.findIndex((x) => x.name === name); if (i < 0) throw new Error(`no labour line ${section}/${name}`); fn(s.items, i) }
const h = (n) => Math.round(n * 100) / 100
edit('Rough In', 'Termination', (items, i) => { items[i] = { ...items[i], hours: h(CABLES * 8 / 60), defaultHours: h(CABLES * 8 / 60), formula: `${CABLES} cables × 8 min (both ends)` } })
edit('Fit Off', 'Camera install (plaster)', (items, i) => { items[i] = { ...items[i], hours: 4.5, defaultHours: 4.5, formula: '9 × 30 min' } })
edit('Fit Off', 'WAP', (items, i) => { items.splice(i, 1); deleted.add('Fit Off::WAP') })
edit('Commissioning & Build', 'NVR config', (items, i) => { items[i] = { ...items[i], defaultHours: h((20 + 12 * 5) / 60), formula: '20 min base + 12 cameras × 5 min' } }) // keeps the 1 h override
edit('Commissioning & Build', 'Switch config (VLANs, network)', (items, i) => { items[i] = { ...items[i], hours: 1 } }) // switches by others — back to the 1 h default
const labour = recalcLabour(saved)

// ── pricing ──
const opts = { discountPercent: Number(quote.discount_percent) || 0, electricianCost: Number(quote.electrician_cost) || 0, isInterstate: !!quote.is_interstate, priceOverrideExGST: Number(quote.pricing_snapshot?.override?.exGST) || 0 }
const summary = calculateQuoteSummary(bom, labour, extras, opts)
const total = Math.round(summary.totalExGST * 100) / 100
const pricing = { ...summary, quote_mode: 'plan', split: { mode: 'cost' } }

// ── scope text ──
const so = structuredClone(quote.scope_overrides)
so.systems.cctv = {
  lead: 'External camera coverage of the site entries, driveway and carpark undercroft, building perimeter, ground-floor yards, verandahs and the Level 1 play deck as per the Aite Group Rev D CCTV markup (external public areas only, no internal cameras), recording continuously to the on-site Dahua NVR with mobile-app remote viewing.',
  items: [
    '<strong>(12) Dahua 6MP IP cameras</strong> — external public areas, mounted as per the Aite Rev D markup (C01, C03, C05, X01–X05, X08, X10, X12, X15)',
    '<strong>(1) Dahua 16-channel PoE network video recorder</strong>',
    '<strong>(2) 8TB surveillance-grade HDDs</strong> — sized for 30 days of continuous recording across all 12 cameras',
    '<strong>(1) monitor</strong> for live CCTV viewing in the comms / reception area',
    'All Cat6 cabling, terminations and wall / soffit-mount brackets',
    'Programming, commissioning, mobile-app configuration and customer training',
  ],
}
so.systems.data = {
  lead: 'Server cabinet and structured cabling for the security systems, terminated to Centrefit patch panels. Router, network switches and Wi-Fi access points are supplied, installed and configured by others.',
  items: [
    '<strong>(1) 42RU server cabinet as requested sizing on plans</strong>',
    `<strong>(${PANELS}) Centrefit 24-port keystone patch panels</strong>`,
    'All Cat6 patch leads, snap plugs and rack terminations',
    'Router, network switches and Wi-Fi access points — <strong>by others</strong> (removed from this quote)',
  ],
}
so.summaryLead = so.summaryLead.replace('security & alarm, access control, cctv / digital surveillance, data & wireless, additional items systems', 'security & alarm, access control, CCTV / digital surveillance and data cabling systems')
so.byOthers.electrician.items = [...so.byOthers.electrician.items, '<strong>Network</strong> — router, network switches and Wi-Fi access points supplied, installed and configured by others']

// ── report ──
const oldTotal = Number(quote.pricing_snapshot?.totalExGST) || 0
console.log(`\nCF-2026-0026 — ${write ? 'WRITING' : 'dry run'}`)
console.log(`lines ${oldLines.length} → ${bom.length} · materials $${summary.materials.sell.toFixed(2)} · labour ${labour.grandTotalHours} h $${labour.grandTotalSell.toFixed(2)}`)
console.log(`total ex GST $${oldTotal.toFixed(2)} → $${total.toFixed(2)} · credit $${(oldTotal - total).toFixed(2)} ex GST ($${((oldTotal - total) * 1.1).toFixed(2)} inc)`)
console.log(`PP1 $${pricing.pp1.total.toFixed(2)} / PP2 $${pricing.pp2.total.toFixed(2)}`)
console.log('\nBOM')
for (const b of bom) { const o = oldLines.find((l) => l.sku === b.sku || (l.sku === 'DHU10568' && b.sku === nvr16.sku)); const mark = !o || o.quantity !== b.quantity || o.sku !== b.sku ? ' *' : ''; console.log(`  ${String(b.quantity).padStart(3)} × ${b.sku.padEnd(22)} $${(b.sell_price * b.quantity).toFixed(2).padStart(9)}  ${b.product_name.slice(0, 60)}${mark}`) }
for (const l of oldLines) if (REMOVE.has(l.sku)) console.log(`  REMOVED ${l.quantity} × ${l.sku} $${(l.sell_price * l.quantity).toFixed(2)}`)
console.log('\nLabour')
for (const s of labour.sections) { console.log(`  ${s.name} — ${s.totalHours} h`); for (const it of s.items) { const o = quote.labour_data.sections.find((x) => x.name === s.name)?.items.find((x) => x.name === it.name); if (!o || Math.abs(o.hours - it.hours) > 0.001) console.log(`      ${it.name}: ${o?.hours ?? '—'} → ${it.hours} h  (${it.formula})`) } }

if (!write) { console.log('\n(dry run — add --write to persist)'); process.exit(0) }
must(await sb.from('quote_line_items').delete().eq('quote_id', quote.id), 'delete lines')
must(await sb.from('quote_line_items').insert(bom.map((item, i) => ({ quote_id: quote.id, ...item, sort_order: i }))), 'insert lines')
must(await sb.from('quotes').update({
  status: 'draft', sent_at: null, sent_to_email: null, response_token: null, accepted_at: null, declined_at: null, expires_at: null,
  device_counts: deviceCounts, external_camera_count: 9,
  labour_data: { ...labour, deleted_labour_keys: Array.from(deleted), quote_mode: 'plan' },
  pricing_snapshot: pricing, scope_overrides: so, updated_at: new Date().toISOString(),
}).eq('id', quote.id), 'update quote')
console.log('\nwritten')
