// @ts-nocheck
// PF Tuggerah / Chermside / Casula — draft quotes to the club entities for the
// front-door changeover to Veyla + Veyla Protect, PENDING SITE VISIT.
// Mitchell, 19 Oct 2026 23:30: "1 x protect, 1 x reader and 8 x labour 1 x
// call out 100m of cat6 cable for the removal of the existing access control,
// wiring in our new ones and then installed veyla protect as well (they are
// already getting the controller in the new pilates studio quote)."
// One new Quote Draft job per club site + one manual draft quote. Nothing sent.
//   npx tsx scripts/pf-front-door-veyla-quotes.mts [--write]
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { calculateQuoteSummary } from '../src/lib/quote-engine/pricing'
import { lintQuote } from '../src/lib/quote-engine/lint'

const write = process.argv.includes('--write')
const env = {}
for (const line of readFileSync('.env.gc-probe', 'utf8').split(/\r?\n/)) { const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/(\\n)+$/, '').trim() }
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data }
const MITCHELL = '3d786409-988c-42fb-9b23-7fc4839cc55f'
const STATUS_QUOTE_DRAFT = 'c14b3b2c-d516-40b7-b864-64fcf1f948d9'
const CAT1 = '4182f42f-571c-42c6-9d54-3e97be6b1b32', CAT2 = '08729c1b-44e5-460f-9019-1808ce826711'
const REFERENCE = 'Front door access control changeover to Veyla + Veyla Protect (pending site visit)'

const CLUBS = [
  { short: 'Tuggerah', site_id: '8a58568f-2ee0-4bc9-b41e-ad13eda1daa1', state: 'NSW', pilates: 'CFA05277' },
  { short: 'Chermside', site_id: '39563c3f-53e5-4089-871d-3d28b054e03d', state: 'QLD', pilates: 'CFA05278' },
  { short: 'Casula', site_id: '2bc169bb-06fa-4a27-8b37-2510e69ad152', state: 'NSW', pilates: 'CFA05279' },
]
const PFRRK = '502b7660-ca83-4838-a61a-9c5d0709edeb'
const LINES = [
  { id: '062c76d8-458f-44de-af41-12f5ccb7f78f', qty: 1, note: '', kit: null },                               // Veyla Protect - Kit (at cost)
  { id: PFRRK, qty: 1, note: '', kit: null },                                                                  // Datalogic reader kit
  { id: 'f3d29163-6646-45aa-925c-59ef4a1842be', qty: 1, note: '1 from kit: Datalogic GFS4950 Barcode Reader Replacement Kit', kit: PFRRK }, // PIM S4
  { id: '1c275733-1def-49cc-9a77-75827359ee73', qty: 1, note: '1 from kit: Datalogic GFS4950 Barcode Reader Replacement Kit', kit: PFRRK }, // USB→RS232
  { id: 'a046d790-289f-43bd-9628-7fe1d01612c0', qty: 1, note: '1 from kit: Datalogic GFS4950 Barcode Reader Replacement Kit', kit: PFRRK }, // DB9-F
  { id: '0c6756e2-1443-464b-8dfa-5e87ce93c9d0', qty: 100, note: '', kit: null },                              // Blue Cat6 per metre
]

const SCOPE = `<p><strong>ANY AND ALL ELECTRICAL WORKS ARE NOT INCLUDED IN THIS QUOTE</strong></p>
<p><strong>Front door — access control changeover to Veyla and Veyla Protect</strong></p>
<p><strong>Indicative pricing pending a site visit.</strong> Centrefit shall remove the club's existing front-door access control, wire the entry door onto the new Veyla access controller being supplied under the Reformer Pilates studio works, and install Veyla Protect tailgating detection at the entry. Quantities and labour will be confirmed after Centrefit has inspected the site.</p>
<p><strong>Access Control</strong></p>
<ol><li><p>• Decommission and remove the existing front-door reader and controller and make the wiring safe.</p></li><li><p>• (1) Planet Fitness barcode/QR reader at the entry door for member app check-in, wired to the Veyla access controller.</p></li><li><p>• Existing lock, exit device and emergency release at the entry door re-terminated onto the Veyla controller.</p></li><li><p>• Programming, commissioning, testing and handover to club staff.</p></li></ol>
<p><strong>Veyla Protect</strong></p>
<ol><li><p>• (1) Veyla Protect kit — AI server and entry camera, mounted inside the club looking at the entry door, bound to the front door for tailgating and let-in detection with alerts to club staff.</p></li><li><p>• Veyla Protect configuration, calibration and commissioning.</p></li><li><p>• The Veyla Protect monthly service is billed separately by Veyla under the club's Veyla agreement.</p></li></ol>
<p><strong>Cabling &amp; Installation</strong></p>
<ol><li><p>• Up to 100 m of Cat6 for the reader, controller and camera runs between the entry door and the comms rack.</p></li><li><p>• One call-out; works carried out inside the operating club.</p></li></ol>
<h3>Standards &amp; codes of practice</h3><p>Installation complies with: AS/NZS 2201.1-2007 (Intruder alarm systems) · AS 4806 (CCTV — management &amp; operation) · AS/NZS 62676.1.2:2020 (Video surveillance) · AS/NZS IEC 60839.11.1:2019 (Electronic access control) · AS/CA S009:2020 (Customer cabling — wiring rules)</p>`

const [prodRes, dtRes, compRes, supRes, timRes, billRes] = await Promise.all([
  sb.from('quote_products').select('*').eq('is_active', true), sb.from('quote_device_types').select('*').eq('is_active', true),
  sb.from('product_kit_components').select('*').eq('status', 'approved'), sb.from('quote_template_device_supply').select('template_id, device_type, supplied_by'),
  sb.from('labour_timings').select('code'), sb.from('billing_settings').select('*').single(),
])
const products = must(prodRes, 'products'), deviceTypes = must(dtRes, 'dt'), kitComponents = must(compRes, 'kc'), templateSupply = must(supRes, 'sup')
const timingCodes = must(timRes, 't').map((t) => t.code), billing = must(billRes, 'billing')
const costRate = Number(billing.labour_cost_rate ?? 75), sellRate = Number(billing.labour_sell_rate ?? 150)
const manualLabourLines = [
  { id: 'ml_labour', category: 'Labour', description: 'Removal of existing access control, wiring in the Veyla reader + controller, Veyla Protect install & commissioning', quantity: 8, unitCost: costRate, unitAmount: sellRate },
  { id: 'ml_callout', category: 'Call-out', description: 'Call-out', quantity: 1, unitCost: Number(billing.callout_fee_cost ?? 80), unitAmount: Number(billing.callout_fee_sell ?? 80) },
]
function buildLabourData(lines) {
  const byCat = new Map()
  for (const l of lines) { const cat = l.category || 'Labour', qty = Number(l.quantity) || 0; if (!byCat.has(cat)) byCat.set(cat, { name: cat, totalSell: 0, totalCost: 0, lines: [] }); const s = byCat.get(cat); s.totalSell += qty * (Number(l.unitAmount) || 0); s.totalCost += qty * (Number(l.unitCost ?? l.unitAmount) || 0); s.lines.push(l) }
  const sections = Array.from(byCat.values()).map((s) => ({ name: s.name, mandatory: false, warning: null, items: s.lines.map((l) => ({ name: l.description || s.name, formula: `${l.quantity || 0} × $${l.unitAmount || 0}`, defaultHours: Number(l.quantity) || 0, hours: Number(l.quantity) || 0, unitRate: Number(l.unitAmount) || 0, unitLabel: s.name === 'Labour' ? 'hrs' : 'x' })), totalHours: s.lines.reduce((a, l) => a + (Number(l.quantity) || 0), 0), totalCost: s.totalCost, totalSell: s.totalSell }))
  return { sections, fixedCosts: [], grandTotalHours: sections.reduce((a, s) => a + s.totalHours, 0), grandTotalCost: sections.reduce((a, s) => a + s.totalCost, 0), grandTotalSell: sections.reduce((a, s) => a + s.totalSell, 0), costRate, sellRate }
}
const labourData = buildLabourData(manualLabourLines)
const bomItems = LINES.map(({ id, qty, note, kit }) => { const p = products.find((x) => x.id === id); if (!p) throw new Error(`product ${id} missing`); return { device_type_code: null, device_type_legend: null, category: p.category || 'Access Control', product_id: p.id, product_name: p.name, sku: p.sku ?? '', supplier: p.supplier ?? '', quantity: qty, cost_price: Number(p.cost_price) || 0, markup: Number(p.markup) || 0, sell_price: Number(p.sell_price) || 0, notes: note, auto_added: false, rule_description: null, customer_supplied: false, kit_parent_product_id: kit } })
console.log('Parts per quote:'); for (const b of bomItems) console.log(`  ${String(b.quantity).padStart(3)} × ${b.product_name} [${b.sku}] $${b.cost_price.toFixed(2)} → $${b.sell_price.toFixed(2)}`)
console.log(`Labour: ${manualLabourLines.map((l) => `${l.category} ${l.quantity} × $${l.unitAmount}`).join(' · ')}`)

const refs = must(await sb.from('quotes').select('ref').like('ref', 'CF-2026-%'), 'refs')
let n = 1; for (const q of refs) { const m = /-(\d+)$/.exec(q.ref); if (m && parseInt(m[1]) >= n) n = parseInt(m[1]) + 1 }
const out = []
for (const club of CLUBS) {
  const site = must(await sb.from('customer_sites').select('id, name, address, suburb, state, postcode, customer_id, customers(name), site_contact_id').eq('id', club.site_id).single(), 'site')
  let job = (must(await sb.from('jobs').select('id, number').eq('site_id', site.id).eq('reference', REFERENCE).limit(1), 'job'))[0]
  if (!job) {
    console.log(`+ job on ${site.name}`)
    if (write) job = must(await sb.from('jobs').insert({ customer_id: site.customer_id, site_id: site.id, reference: REFERENCE, description: `Indicative quote pending site visit: remove the existing front-door access control, wire the entry door onto the Veyla access controller supplied under the Reformer Pilates studio works (${club.pilates}), and install Veyla Protect at the entry. 1 × Veyla Protect kit, 1 × PF barcode/QR reader kit, 100 m Cat6, 8 h labour, 1 call-out. Mitchell 19 Oct 2026.`, category_1_id: CAT1, category_2_id: CAT2, status_id: STATUS_QUOTE_DRAFT, job_contact_id: site.site_contact_id ?? null, created_by: MITCHELL, is_new_build: false }).select('id, number').single(), 'ins job')
    else job = { id: 'dry', number: 'CFA0xxxx' }
  } else console.log(`= job ${job.number} on ${site.name}`)
  const have = job.id === 'dry' ? [] : must(await sb.from('quotes').select('ref, pricing_snapshot').eq('job_id', job.id), 'q')
  if (have.length) { console.log(`  = quote ${have[0].ref}`); out.push({ club: club.short, job: job.number, ref: have[0].ref, total: have[0].pricing_snapshot?.totalExGST }); continue }
  const isInterstate = club.state !== 'QLD'
  const siteInfo = { site_sqm: 0, door_count: 1, external_camera_count: 0, concrete_mount_black: 0, concrete_mount_white: 0, cardio_count: 0, tv_count: 0, ceiling_tv_count: 0, wall_tv_mount_count: 0, ceiling_tv_mount_count: 0, separate_studio_zone: false, reed_switch_uncabled: 0, mag_lock_glass: 0, state: club.state }
  const summary = calculateQuoteSummary(bomItems, labourData, [], { discountPercent: 0, electricianCost: 0, isInterstate, priceOverrideExGST: 0 })
  const lint = lintQuote({ bomItems, deviceCounts: {}, siteInfo, products, deviceTypes, rules: [], kitComponents, templateId: null, templateSupply, elecDoingRoughIn: false, isInterstate, electricianCost: 0, labourTimingCodes: timingCodes, unansweredKitQuestions: [], diagnostics: [], quoteMode: 'manual' })
  const lintOverrides = {}
  for (const f of lint) if (f.code === 'electrician_cost_missing') lintOverrides[`${f.code}|${f.message}`] = 'Centrefit technicians do this work themselves (removal, cabling, Veyla install) — no electrician on this scope; indicative pending site visit (Mitchell, 19 Oct 2026).'
  const errs = lint.filter((f) => f.severity === 'error').map((f) => `${f.code}${lintOverrides[`${f.code}|${f.message}`] ? ' (overridden)' : ''}`)
  const ref = `CF-2026-${String(n++).padStart(4, '0')}`
  const payload = {
    ref, status: 'draft', customer_id: site.customer_id, site_id: site.id, job_id: job.id, client_name: site.customers?.name ?? site.name, site_name: site.name,
    site_address: [site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(', '),
    site_sqm: null, door_count: 1, external_camera_count: 0, concrete_mount_black: 0, concrete_mount_white: 0, cardio_count: 0, tv_count: 0, ceiling_tv_count: 0, wall_tv_mount_count: 0, ceiling_tv_mount_count: 0, separate_studio_zone: false, mag_lock_glass: 0, reed_switch_uncabled: 0,
    device_counts: {}, labour_data: { ...labourData, deleted_labour_keys: [], scope_of_works: SCOPE, ongoing_costs: [], quote_mode: 'manual', manual_labour_lines: manualLabourLines },
    discount_percent: 0, electrician_cost: 0, elec_doing_rough_in: false, elec_doing_fit_off: false, is_interstate: isInterstate, quote_mode: 'manual', kit_answers: {}, interview: null,
    lint_findings: lint, lint_overrides: lintOverrides, lint_checked_at: new Date().toISOString(), quote_type: 'full', template_id: null,
    pricing_snapshot: { ...summary, scope_of_works: SCOPE, quote_mode: 'manual', split: { mode: 'cost' } },
    expires_at: new Date(Date.now() + (billing.quote_validity_days ?? 30) * 86400000).toISOString(),
    notes: `PENDING SITE VISIT — indicative. Front door changeover to Veyla + Veyla Protect for Planet Fitness ${club.short}; the Veyla access controller is supplied under the Reformer Pilates studio builder quotes (${club.pilates}). Mitchell 19 Oct 2026.`,
    created_by: MITCHELL,
  }
  console.log(`  + quote ${ref}  parts $${summary.materials.sell.toFixed(2)} · labour $${summary.labour.totalSell.toFixed(2)} · total $${summary.totalExGST.toFixed(2)} ex GST ($${summary.totalIncGST.toFixed(2)} inc) · lint errors: ${errs.join(', ') || 'none'}`)
  if (write) {
    const q = must(await sb.from('quotes').insert(payload).select('id').single(), 'ins quote')
    must(await sb.from('quote_line_items').insert(bomItems.map((b, i) => ({ quote_id: q.id, product_id: b.product_id, device_type_code: null, device_type_legend: null, category: b.category, product_name: b.product_name, sku: b.sku, supplier: b.supplier, quantity: b.quantity, cost_price: b.cost_price, markup: b.markup, sell_price: b.sell_price, auto_added: false, rule_description: null, notes: b.notes, sort_order: i, customer_supplied: false, kit_parent_product_id: b.kit_parent_product_id }))), 'ins lines')
  }
  out.push({ club: club.short, job: job.number, ref, total: summary.totalExGST })
}
console.log(out, write ? 'WRITTEN' : 'DRY RUN')
