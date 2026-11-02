// @ts-nocheck
// One-off: CF-2026-0110 Beerwah — Mitchell 2 Nov 2026 trimmed the quote (8ch NVR, no monitor, no
// 4G router, TP-Link modem/router instead of UniFi gateway + Wi-Fi 7 AP, associated labour out).
// This rewrites the CCTV + Data scope blocks to the new gear and adds a "What's changed" block
// with the saving per change (monitor folded into the NVR line, not mentioned). Then renders the
// PDF to /tmp for a look. usage: npx tsx scripts/beerwah-scope-2026-11-02.mts [--write]
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { generateScopeOfWorks } from '../src/lib/quote-engine'
import { generateQuotePdfBuffer } from '../src/lib/quote-pdf'
import { generateProposalPdfBuffer } from '../src/lib/proposal-pdf'

const write = process.argv.includes('--write')
const env: Record<string, string> = {}
for (const line of readFileSync('.env.gc-probe', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/(\\n)+$/, '').trim()
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data }
const QUOTE_ID = '6e8bfe07-d23e-484a-a02d-927aa8c01fa4'
const quote = must(await sb.from('quotes').select('*').eq('id', QUOTE_ID).single(), 'quote')
if (quote.ref !== 'CF-2026-0110') throw new Error('wrong quote')
const ps = quote.pricing_snapshot
const SENT_EX = 23919.65, SENT_INC = 26311.62
const nowEx = Math.round(ps.totalExGST * 100) / 100, nowInc = Math.round(ps.totalIncGST * 100) / 100
if (nowEx !== 20932.17) throw new Error(`quote moved since I looked: $${nowEx}`)
const saving = Math.round((SENT_INC - nowInc) * 100) / 100
const $ = (n) => n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })
// per-change savings, inc GST, sell × 1.05 uplift × 1.1 GST (monitor $210.56 folded into the NVR line)
const nvr = 389.54, fourG = 370.75, net = 2525.94
if (Math.round((nvr + fourG + net) * 100) / 100 !== saving) throw new Error(`lines ${nvr + fourG + net} ≠ saving ${saving}`)

const so = structuredClone(quote.scope_overrides)
so.systems.cctv = {
  lead: 'Six 6 MP Dahua AI cameras inside and out, recording continuously to an on-site NVR and viewed from your phone.',
  items: [
    '<strong>(6) 6 MP IP cameras</strong> — internal and external, mounted as per plan',
    '<strong>(1) 8-channel PoE NVR</strong> with a 6 TB surveillance drive — about 30 days of recording, with room for two more cameras',
    'AI tripwire and intrusion rules for after hours',
    'All Cat6 cabling, terminations and mounting brackets',
  ],
}
so.systems.data = {
  lead: 'Locked 9RU wall cabinet on the mezzanine with a Wi-Fi modem/router, PoE switching and a UPS so the rack, cameras, alarm and access controller ride through a power cut.',
  items: [
    '<strong>(1) 9RU lockable cabinet</strong> with shelves, lockable drawer, power board and cable management',
    '<strong>(1) Wi-Fi modem/router</strong> (TP-Link Archer VR400) — NBN connection and Wi-Fi for the warehouse; NBN service arranged separately',
    '<strong>(1) 8-port 2.5 GbE PoE switch</strong>',
    '<strong>(1) 2000 VA UPS</strong>',
    '<strong>(1) data point</strong>, all patch leads and rack terminations',
  ],
}
so.customSystems = (so.customSystems ?? []).filter((c) => c.id !== 'changes_from_26_oct')
so.customSystems.push({
  id: 'changes_from_26_oct',
  name: "What's changed from the 26 October quote",
  iconLabel: '$',
  lead: `Three changes bring the quote from ${$(SENT_INC)} to ${$(nowInc)} inc GST — a saving of ${$(saving)}. Everything else is as quoted: the alarm and monitoring, app-based access on both doors, the six cameras, environmental monitoring and the Veyla one-app integration.`,
  items: [
    `<strong>8-channel NVR</strong> instead of 16-channel — room for two more cameras rather than ten; a second recorder would be needed if the camera count grows past eight later. Saves ${$(nvr)}`,
    `<strong>4G failover router removed</strong> — if the NBN drops, the cameras and app access are offline until it comes back; the alarm keeps its own 4G path and still reports to the monitoring centre. Saves ${$(fourG)}`,
    `<strong>Domestic Wi-Fi modem/router</strong> instead of the UniFi gateway and Wi-Fi 7 access point — a standard home-grade network rather than a managed one, so Centrefit can no longer remotely diagnose or fix network issues on the site; anything on the network side becomes a site visit. Includes the cabling, fit-off and rack-build labour that went with the UniFi gear. Saves ${$(net)}`,
  ],
})

console.log(`CF-2026-0110 ${write ? 'WRITING' : 'dry run'} — ${$(SENT_INC)} → ${$(nowInc)} inc, saving ${$(saving)} (${$(Math.round((SENT_EX - nowEx) * 100) / 100)} ex)`)
if (write) {
  must(await sb.from('quotes').update({ scope_overrides: so, updated_at: new Date().toISOString() }).eq('id', QUOTE_ID), 'update')
  console.log('scope written')
}

// ── render like the PDF routes do ──
const siteInfo = {
  site_sqm: quote.site_sqm ?? 0, door_count: quote.door_count ?? 0, external_camera_count: quote.external_camera_count ?? 0,
  concrete_mount_black: quote.concrete_mount_black ?? 0, concrete_mount_white: quote.concrete_mount_white ?? 0,
  cardio_count: quote.cardio_count ?? 0, tv_count: quote.tv_count ?? 0, ceiling_tv_count: quote.ceiling_tv_count ?? 0,
  wall_tv_mount_count: quote.wall_tv_mount_count ?? 0, ceiling_tv_mount_count: quote.ceiling_tv_mount_count ?? 0,
  separate_studio_zone: quote.separate_studio_zone ?? false,
}
const [bomRows, productRows, roleRows] = await Promise.all([
  sb.from('quote_line_items').select('product_id, quantity').eq('quote_id', QUOTE_ID).then((r) => must(r, 'bom')),
  sb.from('quote_products').select('id, scope_role, name, sku').then((r) => must(r, 'products')),
  sb.from('quote_scope_roles').select('slug, description').then((r) => must(r, 'roles')),
])
const roleDescriptions = {}
for (const r of roleRows) if (r.description?.trim()) roleDescriptions[r.slug] = r.description.trim()
const scope = generateScopeOfWorks(bomRows.map((r) => ({ product_id: r.product_id ?? null, quantity: Number(r.quantity) || 0 })), productRows, siteInfo, so, roleDescriptions, quote.device_counts ?? undefined)
const quoteForPdf = { ref: quote.ref, createdAt: new Date().toISOString(), clientName: quote.client_name, siteName: quote.site_name, siteAddress: quote.site_address, isProgress: quote.quote_type === 'progress', pricing: ps }
const asProposal = quote.sent_as_proposal === true
const pdf = asProposal ? await generateProposalPdfBuffer(quoteForPdf, scope) : await generateQuotePdfBuffer(quoteForPdf, scope)
const out = `/tmp/CF-2026-0110-${asProposal ? 'proposal' : 'quote'}-2026-11-02.pdf`
writeFileSync(out, pdf)
console.log('rendered', out, pdf.length, 'bytes', asProposal ? '(proposal)' : '(quote)')
