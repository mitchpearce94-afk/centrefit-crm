// @ts-nocheck
// 27 Oct 2026 — Mitchell: standardise on the Suprema XPass Q2 (XPQ2-DPB) as the PF door reader.
// Adds "Veyla Access Reader" (VEY-Q2, supplier Veyla, at cost like the other Veyla products),
// retires the Datalogic scanner kit PFRRK (+ its per-door PIM / USB-RS232 / DB9 parts) in its favour,
// carries the controller/enclosure/X100 kit parts across, and sets it as the PF card_reader default.
// Customer price per door unchanged: VEY-Q2 sells at the old PFRRK + PIM + RS232 + DB9 stack ($895).
// usage: npx tsx scripts/veyla-q2-reader-catalogue-2026-10-27.mts [--write]
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const write = process.argv.includes('--write')
const env: Record<string, string> = {}
for (const line of readFileSync('.env.gc-probe', 'utf8').split(/\r?\n/)) { const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/(\\n)+$/, '').trim() }
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data }
const PFRRK = '502b7660-ca83-4838-a61a-9c5d0709edeb', VEYLA_SUPPLIER = '8eb71942-71c8-4f88-994d-1ab69f076ca2', PF_TEMPLATE = '1c20ceda-ff67-4e1c-a938-c8537afa2da0'
const MITCHELL = '3d786409-988c-42fb-9b23-7fc4839cc55f', CARD_READER_ASSET = '80936f60-4b2b-457f-a06e-ae56faea5d97'
const X1100C = 'b3eed4cc-65e0-4044-9abf-a70be750a95b', ENCLOSURE = '8e9f70db-189a-40f7-b1b9-e40f69b7f7b7', X100 = 'c31858c2-1ac4-445b-9fad-5ed010a62f35'
const PRICE = 895 // ex GST, = PFRRK 634.33 + PIM 180 + USB-RS232 56.39 + DB9 24.54 = 895.26 → quoted per-door price held

const existing = must(await sb.from('quote_products').select('id').eq('sku', 'VEY-Q2').maybeSingle(), 'lookup')
let q2Id = existing?.id
console.log(`VEY-Q2 ${q2Id ? 'exists ' + q2Id : 'to create'} · price $${PRICE} ex · write=${write}`)
if (!write) process.exit(0)
if (!q2Id) {
  const row = must(await sb.from('quote_products').insert({
    name: 'Veyla Access Reader (Suprema XPass Q2 — QR + barcode, PoE)', sku: 'VEY-Q2', category: 'Access Control', supplier: 'Veyla', supplier_id: VEYLA_SUPPLIER,
    cost_price: PRICE, markup: 0, device_type: 'card_reader', is_default: true, is_active: true, labour_code: 'card_reader', scope_role: 'card_reader', requires_cable_run: true,
    notes: 'Standard PF door reader from 27 Oct 2026 (Mitchell). Suprema XPQ2-DPB bought by Veyla direct from Suprema (USD 450), supplied to Centrefit at the Veyla list price with no Centrefit margin. Reads PF app QR, Veyla passes and Code 39 key tags; one Cat6 + PoE per door; dials the Veyla gateway. Replaces the Datalogic GFS4950 kit (PFRRK) + NIDAC PIM + USB-RS232 + DB9 per door.',
  }).select('id').single(), 'insert product')
  q2Id = row.id
  console.log('  ✅ product', q2Id)
}
// retire PFRRK → VEY-Q2 (engine hops discontinued products to their replacement on regenerate)
must(await sb.from('quote_products').update({ discontinued_at: new Date().toISOString(), replacement_product_id: q2Id, device_type: null, is_default: false, notes: 'RETIRED 27 Oct 2026 — PF readers are the Suprema XPass Q2 (VEY-Q2). Datalogic/PIM/USB-RS232 stack kept for historical quotes only.' }).eq('id', PFRRK), 'retire PFRRK')
console.log('  ✅ PFRRK discontinued → VEY-Q2')
// kit parts that still ride with a reader placement: controller (1/site), printed enclosure (1/site), X100 per 2 doors beyond the first 2
const comps = [
  { component_product_id: X1100C, qty_mode: 'fixed', qty_value: 1, notes: 'Veyla Access Controller — one per site, drives the first 2 doors (carried from PFRRK 27 Oct 2026)', sort_order: 20 },
  { component_product_id: ENCLOSURE, qty_mode: 'fixed', qty_value: 1, notes: 'Printed enclosure for the controller (carried from PFRRK)', sort_order: 22 },
  { component_product_id: X100, qty_mode: 'formula', qty_value: 1, qty_formula: 'max(0, ceil((qty - 2) / 2))', notes: 'X100 per 2 doors beyond the first 2 (carried from PFRRK)', sort_order: 21 },
]
const have = must(await sb.from('product_kit_components').select('component_product_id').eq('kit_product_id', q2Id), 'comps')
const haveSet = new Set((have ?? []).map((c) => c.component_product_id))
const toAdd = comps.filter((c) => !haveSet.has(c.component_product_id)).map((c) => ({ kit_product_id: q2Id, requirement: 'required', status: 'approved', source: 'manual', decided_by: MITCHELL, decided_at: new Date().toISOString(), ...c }))
if (toAdd.length) must(await sb.from('product_kit_components').insert(toAdd), 'insert comps')
console.log(`  ✅ kit components ${toAdd.length} added`)
// PF template default for the card_reader symbol
const def = must(await sb.from('quote_template_device_defaults').select('product_id').eq('template_id', PF_TEMPLATE).eq('device_type', 'card_reader').maybeSingle(), 'default')
if (!def) must(await sb.from('quote_template_device_defaults').insert({ template_id: PF_TEMPLATE, device_type: 'card_reader', product_id: q2Id }), 'insert default')
else if (def.product_id !== q2Id) must(await sb.from('quote_template_device_defaults').update({ product_id: q2Id }).eq('template_id', PF_TEMPLATE).eq('device_type', 'card_reader'), 'update default')
console.log('  ✅ PF card_reader default → VEY-Q2')
// asset register: one Card Reader per unit
const units = must(await sb.from('product_asset_units').select('id').eq('product_id', q2Id), 'units')
if (!units?.length) must(await sb.from('product_asset_units').insert({ product_id: q2Id, asset_type_id: CARD_READER_ASSET, quantity: 1, device_name: 'Veyla Access Reader', manufacturer: 'Suprema', model: 'XPass Q2 (XPQ2-DPB)', sort_order: 1 }), 'insert unit')
console.log('  ✅ asset unit: Card Reader / Suprema XPass Q2')
console.log('VEY-Q2 =', q2Id)
