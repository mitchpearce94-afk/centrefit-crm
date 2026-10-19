// Veyla products: no Centrefit margin (Mitchell 2026-10-19 — "purchase price
// is the sale price to the customer, so Veyla gets the seed money").
// Purchase price = Veyla's published hardware list (Stripe catalogue, ex GST,
// 15 Oct 2026); markup 0 → sell_price (generated) = cost.
// Also: "AI Server" asset type + asset register units for the Veyla products.
// usage: npx tsx scripts/veyla-zero-margin-2026-10-19.mts [--write]
import { db as sb } from './_service-db.mjs'
const write = process.argv.includes('--write')
const VEYLA_SUPPLIER = '8eb71942-71c8-4f88-994d-1ab69f076ca2'
const PRICES: Record<string, number> = {
  'HID Aero X1100C': 2527.50, // hw-hid-x1100
  'VEY-KIT-01': 2450.00,      // hw-protect-kit-first-door
}
const { data: prods } = await sb.from('quote_products').select('id,name,sku,cost_price,sell_price,markup,asset_type_id').eq('supplier_id', VEYLA_SUPPLIER)
for (const p of prods ?? []) {
  const target = PRICES[p.sku]
  console.log(`${p.sku.padEnd(16)} ${p.name.padEnd(26)} cost ${p.cost_price} sell ${p.sell_price} markup ${p.markup} → cost ${target ?? '(unchanged)'} markup 0`)
  if (!write) continue
  const { error: e1 } = await sb.from('quote_products').update({ markup: 0 }).eq('id', p.id); if (e1) throw e1
  if (target != null) {
    const { error: e2 } = await sb.from('product_supplier_offers').update({ cost_price: target, cost_updated_at: new Date().toISOString() }).eq('product_id', p.id).eq('supplier_id', VEYLA_SUPPLIER); if (e2) throw e2
  }
}
// asset type
const { data: types } = await sb.from('asset_types').select('id,slug,name').in('slug', ['ai_server','camera','door_controller'])
const byslug = new Map((types ?? []).map(t => [t.slug, t.id]))
if (!byslug.get('ai_server')) {
  console.log('asset type ai_server: CREATE')
  if (write) {
    const { data, error } = await sb.from('asset_types').insert({ slug: 'ai_server', name: 'AI Server', category: 'access', default_manufacturer: 'Veyla', default_model: 'AI Server', has_serial: true, has_mac: true, has_ip: true, has_network_credentials: true, is_key_info: true, sort_order: 40 }).select('id').single(); if (error) throw error
    byslug.set('ai_server', data.id)
  }
} else console.log('asset type ai_server: exists')
const units = [
  { sku: 'VEY-KIT-01', slug: 'ai_server', device_name: 'Veyla AI Server', manufacturer: 'Veyla', model: 'AI Server', sort_order: 1 },
  { sku: 'VEY-KIT-01', slug: 'camera', device_name: 'Veyla Vision Camera', manufacturer: 'Veyla', model: 'Vision Camera', sort_order: 2 },
  { sku: 'HID Aero X1100C', slug: 'door_controller', device_name: 'Veyla Access Controller', manufacturer: 'HID', model: 'Aero X1100', sort_order: 1 },
]
for (const u of units) {
  const p = (prods ?? []).find(x => x.sku === u.sku); const t = byslug.get(u.slug)
  console.log(`unit ${u.sku} → 1× ${u.device_name} (${u.slug})`, p && t ? '' : 'SKIP (missing product/type)')
  if (!write || !p || !t) continue
  const { data: ex } = await sb.from('product_asset_units').select('id').eq('product_id', p.id).eq('asset_type_id', t).eq('device_name', u.device_name).maybeSingle()
  if (ex) continue
  const { error } = await sb.from('product_asset_units').insert({ product_id: p.id, asset_type_id: t, quantity: 1, device_name: u.device_name, manufacturer: u.manufacturer, model: u.model, sort_order: u.sort_order }); if (error) throw error
}
if (write) {
  const { data: after } = await sb.from('quote_products').select('sku,cost_price,sell_price,markup').eq('supplier_id', VEYLA_SUPPLIER)
  console.table(after)
}
