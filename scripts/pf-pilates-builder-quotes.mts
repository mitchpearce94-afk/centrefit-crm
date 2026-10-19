// PF Reformer Pilates retrofits (Bravo Fit tender, DDA P2701 Rev A) — set up the
// three tendering builders in the CRM and raise one manual draft quote per
// builder per club (9 quotes), all identical: Veyla controller + enclosure,
// card reader, REX, mag lock + glass armature, break glass, 12 V PSU, 8 h
// fit-off labour, $1,000 flights. Builders' electricians do the rough-in.
//
// Mitchell, 19 Oct 2026: "all of them the same with a controller and card
// reader, rex button, mag lock, armature, break glass and then $1000 for
// flights and 8 x labour for fit off" / "their sparkies will do rough in".
//
// Idempotent on names/refs. Dry by default; --write persists.
// usage: npx tsx scripts/pf-pilates-builder-quotes.mts [envfile] [--write]
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { calculateQuoteSummary } from '../src/lib/quote-engine/pricing'
import { lintQuote } from '../src/lib/quote-engine/lint'
import type { BOMItem, Product, DependencyRule } from '../src/lib/quote-engine/dependency-engine'
import type { DeviceTypeRow, KitComponent, TemplateSupply } from '../src/lib/quote-engine/kits'
import type { LabourData } from '../src/lib/quote-engine/labour-engine'

const args = process.argv.slice(2)
const write = args.includes('--write')
const envFile = args.find((a) => !a.startsWith('--')) ?? '.env.gc-probe'
const env: Record<string, string> = {}
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/(\\n)+$/, '').trim()
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const must = <T,>(r: { data: T | null; error: { message: string } | null }, what: string): T => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data as T }
const log = (...a: unknown[]) => console.log(...a)

const MITCHELL = '3d786409-988c-42fb-9b23-7fc4839cc55f'
const CAT_JOB_TYPE_IT_SUPPLY_INSTALL = '4182f42f-571c-42c6-9d54-3e97be6b1b32'
const CAT_BU_SOLUTIONS = '08729c1b-44e5-460f-9019-1808ce826711'
const STATUS_QUOTE_DRAFT = 'c14b3b2c-d516-40b7-b864-64fcf1f948d9'

type Contact = { name: string; role: string | null; mobile: string | null; phone: string | null; email: string; is_primary: boolean }
type Builder = { name: string; type: string; billing_email: string | null; notes: string; contacts: Contact[] }
const BUILDERS: Builder[] = [
  {
    name: 'URBN Group', type: 'commercial', billing_email: 'accounts@urbngroup.au',
    notes: 'Builder. Has delivered Planet Fitness fit-outs (Noarlunga). Tendering the Bravo Fit Reformer Pilates retrofits (Tuggerah, Chermside, Casula), Oct 2026.',
    contacts: [
      { name: 'Aakash Sharma', role: 'Estimating Manager', mobile: '0413 713 726', phone: null, email: 'aakash@urbngroup.au', is_primary: true },
      { name: 'Cherry Rose Aceron', role: 'Estimating Assistant', mobile: null, phone: null, email: 'cherry@urbngroup.au', is_primary: false },
      { name: 'Jonles Bantilan', role: 'Estimating', mobile: null, phone: null, email: 'estimating@urbngroup.au', is_primary: false },
    ],
  },
  {
    name: 'Elite PEM Electrical Services', type: 'commercial', billing_email: 'admin@elitepem.com.au',
    notes: 'Electrical contractor, 1/6 Brussels Rd Wyong NSW 2259 · 07 2379 0527 · elitepem.com.au. Tendering the Bravo Fit Reformer Pilates retrofits (Oct 2026); Mark told Shayne 13 Oct Elite would likely do our rough-in at Tuggerah.',
    contacts: [
      { name: 'Shayne Parkes', role: 'Service Manager', mobile: '0400 121 283', phone: '07 2379 0527', email: 'shayne@elitepem.com.au', is_primary: true },
      { name: 'Elite PEM Admin', role: 'Admin', mobile: null, phone: '07 2379 0527', email: 'admin@elitepem.com.au', is_primary: false },
    ],
  },
  {
    name: 'Astech Electrical Services', type: 'commercial', billing_email: null,
    notes: 'Electrical contractor, 7/20 Brodie St Morisset NSW 2264 · astechelectricalservices.com.au. Tendering the Bravo Fit Reformer Pilates retrofits (Oct 2026); sent Tuggerah drawings 13 Oct, wanted our quote by 15 Oct.',
    contacts: [
      { name: 'Mick Stevens', role: 'Estimator', mobile: '0410 640 496', phone: null, email: 'mick@astechelec.com', is_primary: true },
    ],
  },
]

type Club = { short: string; address: string; suburb: string; state: string; postcode: string; master: string; sheets: string }
const CLUBS: Club[] = [
  { short: 'Tuggerah', address: 'Bryant Dr & Wyong Rd', suburb: 'Tuggerah', state: 'NSW', postcode: '2259', master: 'CFA05277', sheets: 'A201–A206' },
  { short: 'Chermside', address: 'Tenancy 5A/725 Webster Rd', suburb: 'Chermside', state: 'QLD', postcode: '4032', master: 'CFA05278', sheets: 'A101, A102, A105, A106' },
  { short: 'Casula', address: 'Shop 17A Crossroads Homemaker Centre, Cnr Beech Rd & Camden Valley Way', suburb: 'Casula', state: 'NSW', postcode: '2170', master: 'CFA05279', sheets: 'A001–A006' },
]

// Product ids (quote_products) — looked up by id so a rename can't swap parts.
const LINES: { id: string; qty: number }[] = [
  { id: 'b3eed4cc-65e0-4044-9abf-a70be750a95b', qty: 1 }, // Veyla Access Controller (HID Aero X1100C)
  { id: '8e9f70db-189a-40f7-b1b9-e40f69b7f7b7', qty: 1 }, // HID Aero Enclosure
  { id: '768f83a2-84db-4db3-89e8-b0df916dcc6f', qty: 1 }, // HID Signo 20 Slim Reader
  { id: 'ce0b927c-c268-42e7-9530-7738941e46b3', qty: 1 }, // Request to exit button (PF default)
  { id: '30a755d0-b998-4ae1-a779-cd4e089e38ed', qty: 1 }, // FSH FEM4300 Slimline Mag Lock
  { id: '6d1054e4-bc02-44f5-ba7d-54876e4ba875', qty: 1 }, // FSH AMAB4300 armature plate (glass door)
  { id: 'ddc08987-1cda-47e3-96cc-5f395ea0c6f5', qty: 1 }, // Planet Fitness Break Glass
  { id: '51096018-d428-4c32-bc24-9d5e49f3ad78', qty: 1 }, // MP3560 12 V 5 A lock PSU
]

interface ManualLabourLine { id: string; description: string; category: string; quantity: number; unitAmount: number; unitCost?: number }

const SCOPE_HTML = `<p><strong>ANY AND ALL ELECTRICAL WORKS ARE NOT INCLUDED IN THIS QUOTE</strong></p>
<p><strong>Reformer Pilates studio — access control to door D-01</strong></p>
<p>Centrefit shall supply and fit off one access-controlled door to the new Reformer Pilates studio in line with the Bravo Fit tender drawings (DDA P2701 Rev A). Cabling and rough-in are by the builder's electrician to Centrefit's wiring schedule; Centrefit attends once for fit-off, programming and commissioning inside the operating club.</p>
<p><strong>Access Control</strong></p>
<ol><li><p>• (1) Veyla access controller in a wall enclosure at the studio door, networked back to the club's comms rack.</p></li><li><p>• (1) card reader on the gym side of the studio door.</p></li><li><p>• (1) FSH FEM4300 slimline mag lock, top mounted to the door header, with a glass-door armature plate on the frameless leaf.</p></li><li><p>• (1) request-to-exit button and (1) emergency break-glass on the studio side; the break-glass cuts lock power directly.</p></li><li><p>• 12 V DC lock power supply. Lock power is interlocked with the fire indicator panel via a dry contact provided by the fire contractor so the door releases on fire alarm and on power failure (fail-safe).</p></li><li><p>• Programming, commissioning, testing and handover to club staff.</p></li></ol>
<p><strong>Supplied by the builder / electrician</strong></p>
<ol><li><p>• Cable runs to Centrefit's wiring schedule: reader, exit button, break-glass, lock, FIP contact and a network point to the controller location; GPO at the controller.</p></li><li><p>• Door and header prepared for the mag lock and armature plate by the glazier.</p></li><li><p>• Site access for one fit-off visit.</p></li></ol>
<p><strong>Travel</strong></p>
<ol><li><p>• Flights for one technician for the fit-off visit.</p></li></ol>
<h3>Standards &amp; codes of practice</h3><p>Installation complies with: AS/NZS 2201.1-2007 (Intruder alarm systems) · AS 4806 (CCTV — management &amp; operation) · AS/NZS 62676.1.2:2020 (Video surveillance) · AS/NZS IEC 60839.11.1:2019 (Electronic access control) · AS/CA S009:2020 (Customer cabling — wiring rules)</p>`

// ── reference data ──
const [prodRes, dtRes, compRes, supRes, timRes, billRes, masterRes] = await Promise.all([
  sb.from('quote_products').select('*').eq('is_active', true),
  sb.from('quote_device_types').select('*').eq('is_active', true),
  sb.from('product_kit_components').select('*').eq('status', 'approved'),
  sb.from('quote_template_device_supply').select('template_id, device_type, supplied_by'),
  sb.from('labour_timings').select('code'),
  sb.from('billing_settings').select('*').single(),
  sb.from('jobs').select('id, number, site_id, customer_id').in('number', CLUBS.map((c) => c.master)),
])
const products = must(prodRes, 'products') as Product[]
const deviceTypes = must(dtRes, 'device types') as DeviceTypeRow[]
const kitComponents = must(compRes, 'kit components') as KitComponent[]
const templateSupply = must(supRes, 'supply') as TemplateSupply[]
const timingCodes = (must(timRes, 'timings') as { code: string }[]).map((t) => t.code)
const billing = must(billRes, 'billing') as { labour_cost_rate: number; labour_sell_rate: number; quote_validity_days: number }
const masters = must(masterRes, 'master jobs') as { id: string; number: string; site_id: string; customer_id: string }[]
for (const c of CLUBS) if (!masters.find((m) => m.number === c.master)) throw new Error(`master job ${c.master} missing`)

const costRate = Number(billing.labour_cost_rate ?? 75)
const sellRate = Number(billing.labour_sell_rate ?? 150)
const manualLabourLines: ManualLabourLine[] = [
  { id: 'ml_fitoff', category: 'Labour', description: 'Fit-off, programming & commissioning', quantity: 8, unitCost: costRate, unitAmount: sellRate },
  { id: 'ml_flights', category: 'Travel', description: 'Flights', quantity: 1, unitCost: 1000, unitAmount: 1000 },
]
// Same shape the wizard's manualLabourData memo builds.
function buildLabourData(lines: ManualLabourLine[]): LabourData {
  const byCat = new Map<string, { name: string; totalSell: number; totalCost: number; lines: ManualLabourLine[] }>()
  for (const l of lines) {
    const cat = l.category || 'Labour'; const qty = Number(l.quantity) || 0
    if (!byCat.has(cat)) byCat.set(cat, { name: cat, totalSell: 0, totalCost: 0, lines: [] })
    const s = byCat.get(cat)!; s.totalSell += qty * (Number(l.unitAmount) || 0); s.totalCost += qty * (Number(l.unitCost ?? l.unitAmount) || 0); s.lines.push(l)
  }
  const sections = Array.from(byCat.values()).map((s) => ({
    name: s.name, mandatory: false, warning: null,
    items: s.lines.map((l) => ({ name: l.description || s.name, formula: `${l.quantity || 0} × $${l.unitAmount || 0}`, defaultHours: Number(l.quantity) || 0, hours: Number(l.quantity) || 0, unitRate: Number(l.unitAmount) || 0, unitLabel: s.name === 'Labour' ? 'hrs' : 'x' })),
    totalHours: s.lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0), totalCost: s.totalCost, totalSell: s.totalSell,
  }))
  return { sections, fixedCosts: [], grandTotalHours: sections.reduce((a, s) => a + s.totalHours, 0), grandTotalCost: sections.reduce((a, s) => a + s.totalCost, 0), grandTotalSell: sections.reduce((a, s) => a + s.totalSell, 0), costRate, sellRate } as LabourData
}
const labourData = buildLabourData(manualLabourLines)

const bomItems: BOMItem[] = LINES.map(({ id, qty }) => {
  const p = products.find((x) => x.id === id)
  if (!p) throw new Error(`product ${id} missing or inactive`)
  return {
    device_type_code: null, device_type_legend: null, category: p.category || 'Access Control', product_id: p.id, product_name: p.name,
    sku: p.sku ?? '', supplier: p.supplier ?? '', quantity: qty, cost_price: Number(p.cost_price) || 0, markup: Number((p as unknown as { markup: number }).markup) || 0,
    sell_price: Number(p.sell_price) || 0, notes: '', auto_added: false, rule_description: null,
  } as BOMItem
})
log('Parts per quote:')
for (const b of bomItems) log(`  ${String(b.quantity).padStart(2)} × ${b.product_name} [${b.sku}] cost $${b.cost_price.toFixed(2)} → sell $${b.sell_price.toFixed(2)}`)
log(`Labour: ${manualLabourLines.map((l) => `${l.description} ${l.quantity} × $${l.unitAmount}`).join(' · ')}`)

// ── quote ref allocation (same scheme as the wizard) ──
const year = new Date().getFullYear(); const refPrefix = `CF-${year}-`
const yearRefs = must(await sb.from('quotes').select('ref').like('ref', `${refPrefix}%`), 'refs') as { ref: string }[]
let nextNumber = 1
for (const q of yearRefs) { const m = /-(\d+)$/.exec(q.ref ?? ''); if (m) { const n = parseInt(m[1], 10); if (n >= nextNumber) nextNumber = n + 1 } }

const results: { builder: string; club: string; site: string; job: string; ref: string; total: number; lint: string[] }[] = []

for (const builder of BUILDERS) {
  // customer
  let cust = (must(await sb.from('customers').select('id, name, billing_email').ilike('name', builder.name).limit(1), 'customer') as { id: string; name: string }[])[0]
  if (!cust) {
    log(`+ customer ${builder.name}`)
    if (write) cust = must(await sb.from('customers').insert({ name: builder.name, type: builder.type, billing_email: builder.billing_email, notes: builder.notes, is_active: true }).select('id, name').single(), 'insert customer') as { id: string; name: string }
    else cust = { id: `dry-cust-${builder.name}`, name: builder.name }
  } else log(`= customer ${builder.name} (${cust.id})`)
  // contacts
  const existing = !cust.id.startsWith('dry-') ? (must(await sb.from('customer_contacts').select('id, email, name, is_primary').eq('customer_id', cust.id), 'contacts') as { id: string; email: string | null; name: string; is_primary: boolean }[]) : []
  let primaryContactId: string | null = existing.find((c) => c.is_primary)?.id ?? null
  for (const c of builder.contacts) {
    const have = existing.find((e) => (e.email ?? '').toLowerCase() === c.email.toLowerCase())
    if (have) { if (c.is_primary && !primaryContactId) primaryContactId = have.id; continue }
    log(`  + contact ${c.name} <${c.email}>${c.is_primary ? ' (primary)' : ''}`)
    if (write) {
      const row = must(await sb.from('customer_contacts').insert({ customer_id: cust.id, name: c.name, role: c.role, mobile: c.mobile, phone: c.phone, email: c.email, is_primary: c.is_primary && !primaryContactId }).select('id').single(), 'insert contact') as { id: string }
      if (c.is_primary && !primaryContactId) primaryContactId = row.id
    }
  }

  for (const club of CLUBS) {
    const master = masters.find((m) => m.number === club.master)!
    const siteName = `${builder.name} - Planet Fitness ${club.short}`
    // site
    let site = cust.id.startsWith('dry-') ? undefined : (must(await sb.from('customer_sites').select('id, name').eq('customer_id', cust.id).ilike('name', siteName).limit(1), 'site') as { id: string; name: string }[])[0]
    if (!site) {
      log(`  + site ${siteName}`)
      if (write) site = must(await sb.from('customer_sites').insert({
        customer_id: cust.id, name: siteName, address: club.address, suburb: club.suburb, state: club.state, postcode: club.postcode,
        billing_email: builder.billing_email, site_contact_id: primaryContactId,
        notes: `Builder tender site for Planet Fitness ${club.short} — Bravo Fit Reformer Pilates retrofit (DDA P2701 Rev A, Oct 2026). Club record: Planet Fitness ${club.short} (site ${master.site_id}); master club job ${club.master}.`,
      }).select('id, name').single(), 'insert site') as { id: string; name: string }
      else site = { id: `dry-site-${siteName}`, name: siteName }
    } else log(`  = site ${siteName}`)

    // job
    const reference = `Reformer Pilates retrofit – security & access control – quote to ${builder.name}`
    let job = site.id.startsWith('dry-') ? undefined : (must(await sb.from('jobs').select('id, number').eq('site_id', site.id).eq('reference', reference).limit(1), 'job') as { id: string; number: string }[])[0]
    if (!job) {
      log(`    + job ${reference}`)
      if (write) job = must(await sb.from('jobs').insert({
        customer_id: cust.id, site_id: site.id, reference,
        description: `Quote to ${builder.name} for the Planet Fitness ${club.short} Reformer Pilates studio door (Bravo Fit tender, DDA P2701 Rev A, sheets ${club.sheets}). Master club job ${club.master}. Scope: supply and fit-off of one access-controlled door — Veyla controller, card reader, REX, mag lock + glass armature, break glass, lock PSU; the builder's electrician does the rough-in. All three clubs complete by 11 Dec 2026. Contact: ${builder.contacts[0].name}, ${builder.contacts[0].email}${builder.contacts[0].mobile ? ', ' + builder.contacts[0].mobile : ''}.`,
        category_1_id: CAT_JOB_TYPE_IT_SUPPLY_INSTALL, category_2_id: CAT_BU_SOLUTIONS, status_id: STATUS_QUOTE_DRAFT,
        job_contact_id: primaryContactId, created_by: MITCHELL, is_new_build: false, due_date: null,
      }).select('id, number').single(), 'insert job') as { id: string; number: string }
      else job = { id: `dry-job`, number: 'CFA0xxxx' }
    } else log(`    = job ${job.number}`)

    // quote
    const existingQuote = job.id.startsWith('dry') ? undefined : (must(await sb.from('quotes').select('id, ref, pricing_snapshot').eq('job_id', job.id).limit(1), 'quote') as { id: string; ref: string; pricing_snapshot: { totalExGST?: number } }[])[0]
    const isInterstate = club.state !== 'QLD'
    const siteInfo = { site_sqm: 0, door_count: 1, external_camera_count: 0, concrete_mount_black: 0, concrete_mount_white: 0, cardio_count: 0, tv_count: 0, ceiling_tv_count: 0, wall_tv_mount_count: 0, ceiling_tv_mount_count: 0, separate_studio_zone: false, reed_switch_uncabled: 0, mag_lock_glass: 1, state: club.state }
    const summary = calculateQuoteSummary(bomItems, labourData, [], { discountPercent: 0, electricianCost: 0, isInterstate, priceOverrideExGST: 0 })
    const lint = lintQuote({
      bomItems, deviceCounts: {}, siteInfo: siteInfo as never, products, deviceTypes, rules: [] as DependencyRule[], kitComponents, templateId: null, templateSupply,
      elecDoingRoughIn: true, isInterstate, electricianCost: 0, labourTimingCodes: timingCodes, unansweredKitQuestions: [], diagnostics: [], quoteMode: 'manual',
    })
    const lintOverrides: Record<string, string> = {}
    for (const f of lint) if (f.code === 'electrician_cost_missing') lintOverrides[`${f.code}|${f.message}`] = "Builder's electrician does the rough-in and prices it in their own tender — no electrician cost sits in this quote (Mitchell, 19 Oct 2026)."
    const lintSummary = lint.filter((f) => f.severity === 'error').map((f) => `${f.code}${lintOverrides[`${f.code}|${f.message}`] ? ' (overridden)' : ''}`)

    if (existingQuote) {
      log(`      = quote ${existingQuote.ref} $${Number(existingQuote.pricing_snapshot?.totalExGST ?? 0).toFixed(2)} ex GST`)
      results.push({ builder: builder.name, club: club.short, site: siteName, job: job.number, ref: existingQuote.ref, total: Number(existingQuote.pricing_snapshot?.totalExGST ?? 0), lint: lintSummary })
      continue
    }

    const payload = {
      customer_id: cust.id, site_id: site.id, job_id: job.id, client_name: builder.name, site_name: siteName,
      site_address: `${club.address}, ${club.suburb}, ${club.state}, ${club.postcode}`,
      site_sqm: null, door_count: 1, external_camera_count: 0, concrete_mount_black: 0, concrete_mount_white: 0, cardio_count: 0, tv_count: 0,
      ceiling_tv_count: 0, wall_tv_mount_count: 0, ceiling_tv_mount_count: 0, separate_studio_zone: false, mag_lock_glass: 1, reed_switch_uncabled: 0,
      device_counts: {},
      labour_data: { ...labourData, deleted_labour_keys: [], scope_of_works: SCOPE_HTML, ongoing_costs: [], quote_mode: 'manual', manual_labour_lines: manualLabourLines },
      discount_percent: 0, electrician_cost: 0, elec_doing_rough_in: true, elec_doing_fit_off: false, is_interstate: isInterstate,
      quote_mode: 'manual', kit_answers: {}, interview: null,
      lint_findings: lint, lint_overrides: lintOverrides, lint_checked_at: new Date().toISOString(),
      quote_type: 'full', template_id: null,
      pricing_snapshot: { ...summary, scope_of_works: SCOPE_HTML, quote_mode: 'manual', split: { mode: 'cost' } },
      expires_at: new Date(Date.now() + (billing.quote_validity_days ?? 30) * 86400000).toISOString(),
      notes: `Bravo Fit Reformer Pilates retrofit tender (DDA P2701 Rev A). Quote to ${builder.name} for Planet Fitness ${club.short}; master club job ${club.master}. Identical scope across all nine builder quotes (19 Oct 2026). Builder's electrician does the rough-in.`,
      status: 'draft', created_by: MITCHELL,
    }
    let ref = `${refPrefix}${String(nextNumber).padStart(4, '0')}`
    if (write) {
      let quoteId: string | null = null
      for (let attempt = 0; attempt < 5 && !quoteId; attempt++) {
        ref = `${refPrefix}${String(nextNumber).padStart(4, '0')}`
        const { data, error } = await sb.from('quotes').insert({ ...payload, ref }).select('id').single()
        if (!error && data) { quoteId = data.id; break }
        if (error?.code === '23505' || (error?.message ?? '').toLowerCase().includes('duplicate key')) { nextNumber++; continue }
        throw new Error(`insert quote ${ref}: ${error?.message}`)
      }
      if (!quoteId) throw new Error('could not allocate a quote ref')
      nextNumber++
      must(await sb.from('quote_line_items').insert(bomItems.map((item, i) => ({
        quote_id: quoteId, product_id: item.product_id, device_type_code: null, device_type_legend: null, category: item.category, product_name: item.product_name,
        sku: item.sku, supplier: item.supplier, quantity: item.quantity, cost_price: item.cost_price, markup: item.markup, sell_price: item.sell_price,
        auto_added: false, rule_description: null, notes: '', sort_order: i, customer_supplied: false, kit_parent_product_id: null,
      }))), 'insert lines')
    } else nextNumber++
    log(`      + quote ${ref}  parts $${summary.materials.sell.toFixed(2)} · labour $${summary.labour.totalSell.toFixed(2)} · total $${summary.totalExGST.toFixed(2)} ex GST ($${summary.totalIncGST.toFixed(2)} inc) · lint errors: ${lintSummary.join(', ') || 'none'}`)
    results.push({ builder: builder.name, club: club.short, site: siteName, job: job.number, ref, total: summary.totalExGST, lint: lintSummary })
  }
}

// one update on each master club job listing its three builder quotes
if (write) {
  for (const club of CLUBS) {
    const master = masters.find((m) => m.number === club.master)!
    const rows = results.filter((r) => r.club === club.short)
    const content = `Builder quotes raised 19 Oct 2026 (manual drafts, identical scope — Veyla controller + enclosure, HID Signo card reader, REX, FEM4300 mag lock + AMAB4300 glass armature, PF break glass, 12 V PSU, 8 h fit-off, $1,000 flights; builder's electrician does the rough-in): ${rows.map((r) => `${r.builder} → ${r.ref} on ${r.job} (${r.site}), $${r.total.toFixed(2)} ex GST`).join('; ')}. Drafts for Mitchell's review before sending.`
    must(await sb.from('job_updates').insert({ job_id: master.id, staff_id: MITCHELL, content }), 'job update')
  }
}

log('\nSummary')
for (const r of results) log(`  ${r.builder.padEnd(32)} ${r.club.padEnd(10)} ${r.job.padEnd(9)} ${r.ref}  $${r.total.toFixed(2)} ex GST  ${r.lint.length ? '⚠ ' + r.lint.join(', ') : ''}`)
log(write ? '\nWRITTEN.' : '\nDRY RUN — nothing written. Re-run with --write.')
