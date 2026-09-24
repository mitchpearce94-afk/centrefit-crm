/**
 * Quote lint (docs/quoting-v2-CONTEXT.md D5) — the completeness check that runs
 * on the finished BOM regardless of how it was built, and blocks send on errors
 * unless each one is overridden with a reason. Every finding names the rule.
 */
import type { DeviceCounts, SiteInfo } from './constants'
import type { BOMItem, DependencyRule, Product } from './dependency-engine'
import type { DeviceTypeRow, KitComponent, KitDiagnostic, TemplateSupply } from './kits'

export type LintSeverity = 'error' | 'warn'
export type LintFix = { kind: 'add_product'; product_id: string; qty: number } | { kind: 'site_field'; field: string } | { kind: 'answer_kit'; component_id: string }
export interface LintFinding {
  code: string
  severity: LintSeverity
  message: string
  product_id?: string | null
  fix?: LintFix
}

export interface LintInput {
  bomItems: BOMItem[]
  deviceCounts: DeviceCounts
  siteInfo: SiteInfo
  products: Product[]
  deviceTypes: DeviceTypeRow[]
  rules: DependencyRule[]
  kitComponents: KitComponent[]
  templateId: string | null
  templateSupply: TemplateSupply[]
  elecDoingRoughIn?: boolean
  /** Interstate jobs must carry the electrician's quoted cost (Mitchell, 23 Sep) */
  isInterstate?: boolean
  electricianCost?: number
  labourTimingCodes?: string[]
  unansweredKitQuestions?: { component: KitComponent; product: Product }[]
  diagnostics?: KitDiagnostic[]
  quoteMode: 'plan' | 'manual'
}

const roleOf = (p: Product | undefined) => p?.scope_role ?? null
const nameHas = (p: Product | undefined, re: RegExp) => !!p && re.test(p.name)

export function lintQuote(input: LintInput): LintFinding[] {
  const f: LintFinding[] = []
  const pById = new Map(input.products.map((p) => [p.id, p]))
  const lines = input.bomItems.filter((b) => (b.quantity || 0) > 0)
  const withProduct = lines.map((b) => ({ b, p: b.product_id ? pById.get(b.product_id) : undefined }))
  const has = (pred: (p: Product | undefined, b: BOMItem) => boolean) => withProduct.some(({ b, p }) => pred(p, b))
  const dc = input.deviceCounts
  const cams = (dc.camera_black || 0) + (dc.camera_white || 0)
  // Existing detectors kept on a new panel still take zones (Mitchell, 23 Sep)
  const detectors = (dc.pir_360_roof || 0) + (dc.pir_wall || 0) + (dc.pir_360_roof_existing || 0) + (dc.pir_wall_existing || 0) + (dc.reed_switch || 0) + (dc.duress_button || 0)
  const customerSupplied = new Set(input.templateSupply.filter((s) => s.template_id === input.templateId && s.supplied_by === 'customer').map((s) => s.device_type))
  const dtByCode = new Map(input.deviceTypes.map((d) => [d.code, d]))

  // E8/E9 — lines that can't be right
  for (const { b, p } of withProduct) {
    if (!b.product_id) f.push({ code: 'no_product', severity: 'error', message: `"${b.product_name}" has no product behind it — it would be quoted free and never ordered` })
    else if (!b.customer_supplied && (b.sell_price || 0) <= 0) f.push({ code: 'zero_sell', severity: 'error', message: `${b.product_name}: $0 sell price (cost $${(b.cost_price || 0).toFixed(2)}) — set the price on the product`, product_id: b.product_id })
    if (p?.discontinued_at) f.push({ code: 'discontinued', severity: 'warn', message: `${p.name} is discontinued${p.replacement_product_id ? ' — a replacement exists' : ''}`, product_id: p.id })
    if (p && !b.customer_supplied) {
      const age = p.cost_updated_at ? (Date.now() - new Date(p.cost_updated_at).getTime()) / 86400000 : null
      if (age == null) f.push({ code: 'cost_unknown_age', severity: 'warn', message: `${p.name}: cost price has never been confirmed with a supplier`, product_id: p.id })
      else if (age > 60) f.push({ code: 'cost_stale', severity: 'warn', message: `${p.name}: cost price is ${Math.round(age)} days old`, product_id: p.id })
    }
  }

  // The same product on more than one non-kit line — a rule line plus a hand-
  // added line, or two hand-added lines — is how a part gets ordered twice
  // (CF-2026-0079, Mitchell 24 Sep). Kit lines are exempt: they belong to
  // their kit and the engine already nets them off rule lines.
  const byProduct = new Map<string, BOMItem[]>()
  for (const b of lines) if (b.product_id && !b.kit_parent_product_id) byProduct.set(b.product_id, [...(byProduct.get(b.product_id) ?? []), b])
  for (const [pid, ls] of byProduct) if (ls.length > 1) f.push({ code: 'duplicate_product', severity: 'error', message: `${ls[0].product_name} is on ${ls.length} lines (${ls.map((l) => l.quantity).join(' + ')}) — it would be ordered twice`, product_id: pid })

  // E13 — device counted, no product (from the engine)
  for (const [code, n] of Object.entries(dc)) {
    if (!n || n <= 0) continue
    const dt = dtByCode.get(code)
    if (!dt || !dt.has_hardware || dt.count_only) continue
    if (customerSupplied.has(code)) continue
    if (!lines.some((b) => b.device_type_code === code)) f.push({ code: 'device_no_line', severity: 'error', message: `${n} × ${dt.legend} counted but no product line — no active product carries device type "${code}"` })
  }

  // System checks (plan mode has counts; manual mode infers from products)
  const nvrPresent = has((p) => roleOf(p) === 'nvr' || nameHas(p, /\bNVR\b/i))
  const hddPresent = has((p) => roleOf(p) === 'hdd' || nameHas(p, /\bHDD\b|surveillance.*TB/i))
  const cameraLines = withProduct.filter(({ p }) => roleOf(p) === 'camera').reduce((t, { b }) => t + b.quantity, 0)
  if (nvrPresent && !hddPresent) f.push({ code: 'nvr_without_hdd', severity: 'error', message: 'An NVR is quoted with no hard drive — nothing would record' })
  if ((cams > 0 || cameraLines > 0) && !nvrPresent) f.push({ code: 'cameras_without_recorder', severity: 'error', message: `${cams || cameraLines} cameras quoted with no recorder` })
  const lockLines = withProduct.filter(({ p, b }) => roleOf(p) === 'mag_lock' || roleOf(p) === 'door_strike' || b.device_type_code === 'mag_lock' || b.device_type_code === 'door_strike')
  const psuPresent = has((p) => nameHas(p, /12V\s*(DC)?\s*\d+A|switchmode|power supply|PSU/i) && !nameHas(p, /18V|24V|battery/i))
  if (lockLines.length && !psuPresent) f.push({ code: 'lock_without_psu', severity: 'error', message: 'Door locks are quoted with no 12 V access-control supply (MP3560)' })
  const readerLines = withProduct.filter(({ b }) => b.device_type_code === 'card_reader' && !b.customer_supplied)
  const controllerPresent = has((p) => roleOf(p) === 'access_control_system' && nameHas(p, /X1100|Aero|controller|SLAM|Inception|Paxton10 Door/i))
  if (readerLines.length && !controllerPresent) f.push({ code: 'reader_without_controller', severity: 'error', message: 'Readers are quoted with no access controller' })
  const panelPresent = has((p, b) => roleOf(p) === 'alarm_panel' && (b.device_type_code === 'alarm_panel' || nameHas(p, /K6000|Solution 6000|panel/i)))
  const commsPresent = has((p) => nameHas(p, /MY368|ETHM|4G|GSM|ethernet relay/i))
  if (panelPresent && !commsPresent) f.push({ code: 'panel_without_comms', severity: 'error', message: 'Alarm panel quoted with no comms path (4G modem or ETHM-A)' })
  const expanders = withProduct.filter(({ p }) => nameHas(p, /CM704B/i)).reduce((t, { b }) => t + b.quantity, 0)
  if (panelPresent && detectors > 16 && expanders === 0) f.push({ code: 'detectors_over_capacity', severity: 'warn', message: `${detectors} detectors on the panel with no zone expander` })
  if (input.isInterstate && !(Number(input.electricianCost) > 0)) f.push({ code: 'electrician_cost_missing', severity: 'error', message: 'Interstate job with no electrician cost — enter the electrician\'s quote on the Labour step' })
  if (!input.elecDoingRoughIn) {
    // Existing detectors are re-terminated on their own cable — they don't need a roll.
    const securityDevices = detectors - (dc.pir_360_roof_existing || 0) - (dc.pir_wall_existing || 0) + (dc.duress_intercom || 0) + (dc.light_siren || 0) + (dc.rf_receiver || 0)
    if (securityDevices > 0 && !has((p) => nameHas(p, /6 ?core|security cable/i))) f.push({ code: 'security_without_cable', severity: 'warn', message: 'Security devices quoted with no 6-core cable' })
    const dataDevices = cams + (dc.wap || 0) + (dc.data_point || 0) + (dc.tailgate_system || 0)
    if (dataDevices > 0 && !has((p) => nameHas(p, /cat ?6.*(305|roll|box)/i))) f.push({ code: 'data_without_cable', severity: 'warn', message: 'Data devices quoted with no Cat6 cable roll' })
  }

  // E12 — site fields a rule depends on are still zero
  const siteFieldsUsed = new Set<string>()
  for (const r of input.rules) {
    if (r.trigger_site_field) siteFieldsUsed.add(r.trigger_site_field)
    if (r.quantity_site_field) siteFieldsUsed.add(r.quantity_site_field)
    for (const code of String(r.trigger_code ?? '').split('+').map((s) => s.trim())) {
      if (code in input.siteInfo) siteFieldsUsed.add(code)
      if (code === 'switch_ports') { siteFieldsUsed.add('cardio_count'); siteFieldsUsed.add('tv_count') }
    }
  }
  if (input.quoteMode === 'plan') {
    for (const field of ['site_sqm', 'door_count']) if (siteFieldsUsed.has(field) && !(input.siteInfo as Record<string, unknown>)[field]) f.push({ code: 'site_field_zero', severity: 'warn', message: `${field.replace('_', ' ')} is 0 but rules depend on it`, fix: { kind: 'site_field', field } })
    if ((siteFieldsUsed.has('tv_count') || siteFieldsUsed.has('cardio_count')) && !input.siteInfo.tv_count && !input.siteInfo.cardio_count && has((p) => roleOf(p) === 'modulator' || roleOf(p) === 'amplifier')) f.push({ code: 'av_without_counts', severity: 'warn', message: 'AV distribution parts are quoted but TV and cardio counts are 0', fix: { kind: 'site_field', field: 'tv_count' } })
  }

  // Labour: a product with a labour code the timings table doesn't know
  if (input.labourTimingCodes?.length) {
    const known = new Set(input.labourTimingCodes)
    for (const { p } of withProduct) if (p?.labour_code && p.labour_code !== 'none' && !known.has(p.labour_code)) f.push({ code: 'labour_code_unknown', severity: 'warn', message: `${p.name}: labour code "${p.labour_code}" has no timing — no fit-off labour will be charged`, product_id: p.id })
  }

  // Kits
  for (const q of input.unansweredKitQuestions ?? []) f.push({ code: 'kit_question', severity: 'error', message: `${q.component.ask_prompt ?? `Include ${q.product.name}?`}`, product_id: q.product.id, fix: { kind: 'answer_kit', component_id: q.component.id } })
  for (const d of input.diagnostics ?? []) f.push({ code: d.code, severity: d.code === 'hdd_pack_failed' ? 'error' : 'warn', message: d.message, product_id: d.product_id ?? null })

  // de-dupe identical findings
  const seen = new Set<string>()
  return f.filter((x) => { const k = `${x.code}|${x.message}`; if (seen.has(k)) return false; seen.add(k); return true })
}

/** Errors that still block: every error must carry an override reason. */
export function blockingFindings(findings: LintFinding[], overrides: Record<string, string> | null | undefined): LintFinding[] {
  const ov = overrides ?? {}
  return findings.filter((x) => x.severity === 'error' && !(ov[`${x.code}|${x.message}`] ?? '').trim())
}
export const findingKey = (x: LintFinding) => `${x.code}|${x.message}`
