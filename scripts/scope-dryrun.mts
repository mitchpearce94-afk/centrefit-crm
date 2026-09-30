// Render the generated Scope of Works for a quote, the way the customer sees it.
// usage: npx tsx scripts/scope-dryrun.mts CF-2026-0086 [envfile]
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { generateScopeOfWorks, BOMRollup } from '../src/lib/quote-engine/scope-of-works'

const ref = process.argv[2]
if (!ref) { console.error('usage: npx tsx scripts/scope-dryrun.mts CF-2026-0086 [envfile]'); process.exit(1) }
const envFile = process.argv[3] ?? '.env.local'
const env: Record<string, string> = {}
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/(\\n)+$/, '').trim()
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { data: quote } = await sb.from('quotes').select('*').eq('ref', ref).maybeSingle() as { data: Record<string, any> | null }
if (!quote) { console.error('no quote', ref); process.exit(1) }
const [{ data: lines }, { data: products }, { data: roles }] = await Promise.all([
  sb.from('quote_line_items').select('product_id, quantity').eq('quote_id', quote.id),
  sb.from('quote_products').select('id, scope_role, name, sku'),
  sb.from('quote_scope_roles').select('slug, description'),
])
const roleDescriptions: Record<string, string> = {}
for (const r of roles ?? []) if (r.description) roleDescriptions[r.slug] = r.description
const siteInfo = { site_sqm: quote.site_sqm ?? 0, door_count: quote.door_count ?? 0, cardio_count: quote.cardio_count ?? 0, tv_count: quote.tv_count ?? 0, ceiling_tv_count: quote.ceiling_tv_count ?? 0, mag_lock_glass: quote.mag_lock_glass ?? 0 }
const bom = (lines ?? []) as { product_id: string | null; quantity: number }[]
const prods = (products ?? []) as { id: string; scope_role: string | null; name: string; sku: string }[]
const scope = generateScopeOfWorks(bom, prods, siteInfo, quote.scope_overrides ?? undefined, roleDescriptions, quote.device_counts ?? undefined)
const strip = (h: string) => h.replace(/<[^>]+>/g, '')
console.log(`\n${ref}\n${strip(scope.summary.lead)}\n`)
for (const s of scope.systems) {
  console.log(`## ${s.name}${s.included ? '' : ' (excluded)'}`)
  console.log(`   ${strip(s.lead)}`)
  for (const it of s.items) console.log(`   • ${strip(it)}`)
  console.log()
}
for (const b of scope.byOthers) { console.log(`## ${b.name}`); for (const it of b.items) console.log(`   • ${strip(it)}`); console.log() }
console.log('## Ongoing'); for (const o of scope.ongoingCosts) console.log(`   • ${o.desc} — ${o.price}`)
const roll = new BOMRollup(bom, prods)
console.log('\n## BOM lines with no scope bullet (silent)')
for (const u of roll.unhandled) console.log(`   ${String(u.quantity).padStart(3)} × ${u.sku ?? ''} ${u.productName} [${u.scopeRole ?? 'untagged'}]`)
