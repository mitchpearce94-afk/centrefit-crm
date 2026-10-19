// @ts-nocheck
// Add another builder to the PF Reformer Pilates tender: customer + contacts,
// three builder sites, three Quote Draft jobs, three DRAFT quotes cloned
// line-for-line from the current reference quotes (CF-2026-0102 content =
// Datalogic reader kit + 19 Oct scope). Nothing is sent.
//   npx tsx scripts/pf-pilates-builder-clone.mts [--write]
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const write = process.argv.includes('--write')
const env = {}
for (const line of readFileSync('.env.gc-probe', 'utf8').split(/\r?\n/)) { const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/(\\n)+$/, '').trim() }
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data }
const MITCHELL = '3d786409-988c-42fb-9b23-7fc4839cc55f'
const STATUS_QUOTE_DRAFT = 'c14b3b2c-d516-40b7-b864-64fcf1f948d9'
const CAT1 = '4182f42f-571c-42c6-9d54-3e97be6b1b32', CAT2 = '08729c1b-44e5-460f-9019-1808ce826711'

const BUILDER = {
  name: 'Pacific Design & Construct', type: 'commercial', billing_email: null,
  notes: 'Builder (Pacific Design & Construct Pty Ltd), Suite 101, 4 Clarke Street, Crows Nest NSW 2065 · 02 8964 5377 · pacificconstruct.com.au. Built Planet Fitness Maroochydore (Bill Morrison, Sep 2026). Jeremy Allomes emailed Mark 19 Oct 2026 for the three PF Reformer Pilates retrofit prices.',
  contacts: [
    { name: 'Jeremy Allomes', role: 'Managing Director', mobile: '0404 534 375', phone: '02 8964 5377', email: 'jeremy@pacificconstruct.com.au', is_primary: true },
    { name: 'Bill Morrison', role: 'Site / project (PF Maroochydore)', mobile: null, phone: '02 8964 5377', email: 'bill@pacificconstruct.com.au', is_primary: false },
  ],
}
const CLUBS = [
  { short: 'Tuggerah', address: 'Bryant Dr & Wyong Rd', suburb: 'Tuggerah', state: 'NSW', postcode: '2259', master: 'CFA05277', sheets: 'A201–A206', srcRef: 'CF-2026-0098' },
  { short: 'Chermside', address: 'Tenancy 5A/725 Webster Rd', suburb: 'Chermside', state: 'QLD', postcode: '4032', master: 'CFA05278', sheets: 'A101, A102, A105, A106', srcRef: 'CF-2026-0102' },
  { short: 'Casula', address: 'Shop 17A Crossroads Homemaker Centre, Cnr Beech Rd & Camden Valley Way', suburb: 'Casula', state: 'NSW', postcode: '2170', master: 'CFA05279', sheets: 'A001–A006', srcRef: 'CF-2026-0098' },
]
const masters = must(await sb.from('jobs').select('id, number, site_id').in('number', CLUBS.map((c) => c.master)), 'masters')

let cust = (must(await sb.from('customers').select('id, name').ilike('name', BUILDER.name).limit(1), 'cust'))[0]
if (!cust) { console.log('+ customer', BUILDER.name); if (write) cust = must(await sb.from('customers').insert({ name: BUILDER.name, type: BUILDER.type, billing_email: BUILDER.billing_email, notes: BUILDER.notes, is_active: true }).select('id, name').single(), 'ins cust'); else cust = { id: 'dry', name: BUILDER.name } }
else console.log('= customer', cust.name)
let primaryContactId = null
if (cust.id !== 'dry') {
  const existing = must(await sb.from('customer_contacts').select('id, email, is_primary').eq('customer_id', cust.id), 'contacts')
  primaryContactId = existing.find((c) => c.is_primary)?.id ?? null
  for (const c of BUILDER.contacts) {
    if (existing.find((e) => (e.email ?? '').toLowerCase() === c.email)) continue
    console.log('  + contact', c.name)
    if (write) { const row = must(await sb.from('customer_contacts').insert({ customer_id: cust.id, name: c.name, role: c.role, mobile: c.mobile, phone: c.phone, email: c.email, is_primary: c.is_primary && !primaryContactId }).select('id').single(), 'ins contact'); if (c.is_primary && !primaryContactId) primaryContactId = row.id }
  }
} else for (const c of BUILDER.contacts) console.log('  + contact', c.name)

const refs = must(await sb.from('quotes').select('ref').like('ref', 'CF-2026-%'), 'refs')
let n = 1; for (const q of refs) { const m = /-(\d+)$/.exec(q.ref); if (m && parseInt(m[1]) >= n) n = parseInt(m[1]) + 1 }
const out = []
for (const club of CLUBS) {
  const master = masters.find((m) => m.number === club.master)
  const siteName = `${BUILDER.name} - Planet Fitness ${club.short}`
  let site = cust.id === 'dry' ? undefined : (must(await sb.from('customer_sites').select('id, name').eq('customer_id', cust.id).ilike('name', siteName).limit(1), 'site'))[0]
  if (!site) { console.log('  + site', siteName); if (write) site = must(await sb.from('customer_sites').insert({ customer_id: cust.id, name: siteName, address: club.address, suburb: club.suburb, state: club.state, postcode: club.postcode, billing_email: BUILDER.billing_email, site_contact_id: primaryContactId, notes: `Builder tender site for Planet Fitness ${club.short} — Bravo Fit Reformer Pilates retrofit (DDA P2701 Rev A, Oct 2026). Club record: Planet Fitness ${club.short} (site ${master.site_id}); master club job ${club.master}.` }).select('id, name').single(), 'ins site'); else site = { id: 'dry', name: siteName } }
  else console.log('  = site', siteName)
  const reference = `Reformer Pilates retrofit – security & access control – quote to ${BUILDER.name}`
  let job = site.id === 'dry' ? undefined : (must(await sb.from('jobs').select('id, number').eq('site_id', site.id).eq('reference', reference).limit(1), 'job'))[0]
  if (!job) { console.log('    + job', reference); if (write) job = must(await sb.from('jobs').insert({ customer_id: cust.id, site_id: site.id, reference, description: `Quote to ${BUILDER.name} for the Planet Fitness ${club.short} Reformer Pilates studio door (Bravo Fit tender, DDA P2701 Rev A, sheets ${club.sheets}). Master club job ${club.master}. Scope: supply and fit-off of one access-controlled door — Veyla controller, PF barcode/QR reader kit, REX, mag lock + glass armature, break glass, lock PSU, relocation of the existing CCTV camera; the builder's electrician does the rough-in as per plan. All three clubs complete by 11 Dec 2026. Contact: Jeremy Allomes, jeremy@pacificconstruct.com.au, 0404 534 375.`, category_1_id: CAT1, category_2_id: CAT2, status_id: STATUS_QUOTE_DRAFT, job_contact_id: primaryContactId, created_by: MITCHELL, is_new_build: false }).select('id, number').single(), 'ins job'); else job = { id: 'dry', number: 'CFA0xxxx' } }
  else console.log('    = job', job.number)
  const have = job.id === 'dry' ? [] : must(await sb.from('quotes').select('ref').eq('job_id', job.id), 'q')
  if (have.length) { console.log('      = quote', have[0].ref); out.push({ club: club.short, job: job.number, ref: have[0].ref }); continue }
  const src = must(await sb.from('quotes').select('*').eq('ref', club.srcRef).single(), 'src')
  const lines = must(await sb.from('quote_line_items').select('*').eq('quote_id', src.id).order('sort_order'), 'lines')
  const ref = `CF-2026-${String(n++).padStart(4, '0')}`
  const { id: _i, created_at: _c, updated_at: _u, response_token: _t, sent_at: _s, sent_to_email: _e, expires_at: _x, notes: _n, followup_sent_at: _f, accepted_at: _a, declined_at: _d, ...rest } = src
  const row = { ...rest, ref, status: 'draft', job_id: job.id, site_id: site.id, customer_id: cust.id, client_name: BUILDER.name, site_name: siteName, site_address: `${club.address}, ${club.suburb}, ${club.state}, ${club.postcode}`, is_interstate: club.state !== 'QLD', sent_as_proposal: false, followup_count: 0, lint_checked_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), created_by: MITCHELL,
    notes: `Bravo Fit Reformer Pilates retrofit tender (DDA P2701 Rev A). Quote to ${BUILDER.name} for Planet Fitness ${club.short}; master club job ${club.master}. Cloned from ${club.srcRef} 19 Oct 2026 (identical scope and price to the URBN / Elite PEM / Astech quotes). Builder's electrician does the rough-in.` }
  console.log(`      + quote ${ref} ← ${club.srcRef} $${Number(row.pricing_snapshot.totalExGST).toFixed(2)} ex GST, ${lines.length} lines`)
  if (write) { const q = must(await sb.from('quotes').insert(row).select('id').single(), 'ins quote'); must(await sb.from('quote_line_items').insert(lines.map(({ id: _a, created_at: _b, rfq_sent_at: _r, cost_confirmed_at: _cc, ...l }) => ({ ...l, quote_id: q.id }))), 'ins lines') }
  out.push({ club: club.short, job: job.number, ref })
}
if (write) for (const club of CLUBS) { const m = masters.find((x) => x.number === club.master); const r = out.find((o) => o.club === club.short); must(await sb.from('job_updates').insert({ job_id: m.id, staff_id: MITCHELL, content: `Builder quote raised 19 Oct 2026 for ${BUILDER.name} (Jeremy Allomes, via Mark 15:44): ${r.ref} on ${r.job}, $6,409.13 ex GST, same scope as the other builders. DRAFT — Mitchell to check before sending.` }), 'upd') }
console.log(out, write ? 'WRITTEN' : 'DRY RUN')
