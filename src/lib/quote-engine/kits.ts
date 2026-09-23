/**
 * Kits (docs/quoting-v2-CONTEXT.md D1, D6) — "quoting X requires these components".
 * Approved `product_kit_components` rows expand into extra BOM lines under the
 * kit product, at quantities driven by the kit line, the quote's device counts
 * or a formula. Kits nest (depth ≤ 3). Components ADD to the BOM — unlike the
 * dependency rules, which "ensure at least N". The old `quote_product_kit_contents`
 * ("ships with", net-off) is untouched and still runs after this.
 */
import { DEFAULT_MARKUP } from './constants'
import type { DeviceCounts, SiteInfo } from './constants'
import type { BOMItem, Product } from './dependency-engine'

export interface KitComponent {
  id: string
  kit_product_id: string
  component_product_id: string
  qty_mode: 'per_unit' | 'fixed' | 'per_n' | 'formula' | 'per_device_type'
  qty_value: number
  qty_per: number | null
  qty_formula: string | null
  qty_device_type: string | null
  requirement: 'required' | 'optional' | 'ask'
  ask_prompt: string | null
  status: 'proposed' | 'approved' | 'rejected'
  notes?: string | null
  sort_order?: number
}

export interface DeviceTypeRow {
  code: string
  legend: string
  category: string | null
  default_scope_role: string | null
  labour_code: string | null
  has_hardware: boolean
  count_only: boolean
  is_active: boolean
}

export interface TemplateSupply {
  template_id: string
  device_type: string
  supplied_by: 'centrefit' | 'customer'
}

/** Answers to 'ask' components, keyed by component id: true = include. */
export type KitAnswers = Record<string, boolean>

export interface KitContext {
  deviceCounts: DeviceCounts
  siteInfo: SiteInfo
  kitAnswers: KitAnswers
  retentionDays?: number   // HDD sizing (Mitchell 23 Sep: 30 days ≈ 1 TB per camera)
  tbPerCamera?: number
}

export interface KitDiagnostic { code: string; message: string; product_id?: string | null }

const cameraCount = (dc: DeviceCounts) => (dc.camera_black || 0) + (dc.camera_white || 0)
const detectorCount = (dc: DeviceCounts) => (dc.pir_360_roof || 0) + (dc.pir_wall || 0) + (dc.reed_switch || 0) + (dc.duress_button || 0)
const doorCount = (dc: DeviceCounts, si: SiteInfo) => Math.max(si.door_count || 0, (dc.mag_lock || 0) + (dc.door_strike || 0) + (dc.door_lock || 0), dc.card_reader || 0)

/** Tiny safe evaluator for kit formulas: numbers, + - * / ( ), max/min/ceil/floor/round, named vars. */
export function evalKitFormula(formula: string, vars: Record<string, number>): number {
  const src = formula.trim()
  if (!/^[\w\s+\-*/().,]+$/.test(src)) throw new Error(`formula has unsupported characters: ${src}`)
  const allowed = new Set(['max', 'min', 'ceil', 'floor', 'round', ...Object.keys(vars)])
  for (const ident of src.match(/[A-Za-z_]\w*/g) ?? []) if (!allowed.has(ident)) throw new Error(`unknown name in formula: ${ident}`)
  const fn = new Function(...Object.keys(vars), 'max', 'min', 'ceil', 'floor', 'round', `return (${src});`)
  const v = Number(fn(...Object.values(vars), Math.max, Math.min, Math.ceil, Math.floor, Math.round))
  return Number.isFinite(v) ? v : 0
}

/**
 * Cheapest set of drives that reaches `requiredTb` within `slots` bays
 * (Mitchell 23 Sep: "16 TB → 1×10 + 1×6, make it smart"). Small DP over the
 * available surveillance drives: minimise cost, tie-break on fewer drives.
 */
export function hddPack(requiredTb: number, slots: number, drives: { product: Product; tb: number }[]): { product: Product; qty: number }[] {
  if (requiredTb <= 0 || !drives.length) return []
  const usable = drives.filter((d) => d.tb > 0 && d.product.cost_price > 0)
  if (!usable.length) return []
  const maxSlots = Math.max(1, slots)
  // best[n] = cheapest combo using exactly n drives, over capacity tracked per combo
  type Combo = { cost: number; tb: number; counts: number[] }
  let frontier: Combo[] = [{ cost: 0, tb: 0, counts: usable.map(() => 0) }]
  let best: Combo | null = null
  for (let n = 1; n <= maxSlots; n++) {
    const next: Combo[] = []
    for (const c of frontier) for (let i = 0; i < usable.length; i++) {
      const counts = [...c.counts]; counts[i] += 1
      const combo = { cost: c.cost + usable[i].product.cost_price, tb: c.tb + usable[i].tb, counts }
      if (combo.tb >= requiredTb) { if (!best || combo.cost < best.cost - 1e-9) best = combo }
      else next.push(combo)
    }
    // prune dominated partials (same or more tb for less cost)
    next.sort((a, b) => a.cost - b.cost)
    const kept: Combo[] = []
    for (const c of next) if (!kept.some((k) => k.tb >= c.tb && k.cost <= c.cost)) kept.push(c)
    frontier = kept.slice(0, 200)
    if (!frontier.length) break
  }
  if (!best) {
    // can't reach it within the bays: fill every bay with the biggest drive and let lint flag it
    const biggest = usable.reduce((a, b) => (b.tb > a.tb ? b : a))
    return [{ product: biggest.product, qty: maxSlots }]
  }
  return best.counts.map((qty, i) => ({ product: usable[i].product, qty })).filter((x) => x.qty > 0)
}

const parseTb = (p: Product) => { const m = /(\d+(?:\.\d+)?)\s*TB/i.exec(p.name); return m ? Number(m[1]) : 0 }
const parseSlots = (p: Product) => { const m = /(\d+)\s*X\s*SATA/i.exec(p.name); return m ? Number(m[1]) : 2 }

function lineFor(product: Product, qty: number, kit: BOMItem, note: string): BOMItem {
  return {
    device_type_code: null,
    device_type_legend: null,
    category: product.category || kit.category,
    product_id: product.id,
    product_name: product.name,
    sku: product.sku || '',
    supplier: product.supplier || '',
    quantity: qty,
    cost_price: product.cost_price || 0,
    markup: product.markup || DEFAULT_MARKUP,
    sell_price: product.sell_price || 0,
    notes: note,
    auto_added: true,
    rule_description: `kit: ${kit.sku || kit.product_name}`,
    kit_parent_product_id: kit.product_id,
  }
}

/**
 * Expand approved kit components under every BOM line whose product is a kit.
 * Returns the new lines (the caller appends), plus questions still unanswered
 * and diagnostics for lint.
 */
export function expandKits(
  bomItems: BOMItem[],
  products: Product[],
  kitComponents: KitComponent[],
  ctx: KitContext,
): { added: BOMItem[]; questions: { component: KitComponent; kit: BOMItem; product: Product }[]; diagnostics: KitDiagnostic[] } {
  const added: BOMItem[] = []
  const questions: { component: KitComponent; kit: BOMItem; product: Product }[] = []
  const diagnostics: KitDiagnostic[] = []
  const approved = kitComponents.filter((k) => k.status === 'approved')
  if (!approved.length) return { added, questions, diagnostics }
  const byKit = new Map<string, KitComponent[]>()
  for (const k of approved) { if (!byKit.has(k.kit_product_id)) byKit.set(k.kit_product_id, []); byKit.get(k.kit_product_id)!.push(k) }
  const pById = new Map(products.map((p) => [p.id, p]))
  const cams = cameraCount(ctx.deviceCounts)
  const vars = {
    cameras: cams,
    doors: doorCount(ctx.deviceCounts, ctx.siteInfo),
    detectors: detectorCount(ctx.deviceCounts),
    sqm: ctx.siteInfo.site_sqm || 0,
    retention_days: ctx.retentionDays ?? 30,
    tv_count: (ctx.siteInfo.tv_count || 0) + (ctx.siteInfo.ceiling_tv_count || 0),
    cardio_count: ctx.siteInfo.cardio_count || 0,
  }
  const drives = products.filter((p) => p.is_active !== false && (p.scope_role === 'hdd' || /surveillance hdd|purple/i.test(p.name)) && parseTb(p) > 0).map((p) => ({ product: p, tb: parseTb(p) }))

  const walk = (kitLine: BOMItem, depth: number) => {
    if (!kitLine.product_id || depth > 3) return
    const comps = byKit.get(kitLine.product_id)
    if (!comps) return
    for (const c of comps.sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100))) {
      const product = pById.get(c.component_product_id)
      if (!product || product.is_active === false) { diagnostics.push({ code: 'kit_component_missing', message: `${kitLine.product_name}: kit component is inactive or missing`, product_id: c.component_product_id }); continue }
      if (c.requirement === 'ask') {
        const answer = ctx.kitAnswers[c.id]
        if (answer === undefined) { questions.push({ component: c, kit: kitLine, product }); continue }
        if (!answer) continue
      }
      const kitQty = kitLine.quantity
      let qty = 0
      let note = c.notes ?? ''
      if (c.qty_mode === 'formula' && c.qty_formula === 'hdd_pack') {
        const required = Math.ceil(cams * (ctx.tbPerCamera ?? 1) * ((ctx.retentionDays ?? 30) / 30))
        if (required <= 0) {
          // Manual quotes carry no device counts — the NVR can't be sized. Say so instead of a false "no drives" error.
          diagnostics.push({ code: 'hdd_pack_skipped', message: `${kitLine.product_name}: no camera count to size the drives — add drives by hand (1 TB per camera, 30 days)`, product_id: kitLine.product_id })
          continue
        }
        const packed = hddPack(required, parseSlots(pById.get(kitLine.product_id) ?? product), drives)
        if (!packed.length) diagnostics.push({ code: 'hdd_pack_failed', message: `no surveillance drives with a cost to size ${required} TB for ${cams} cameras`, product_id: kitLine.product_id })
        for (const d of packed) added.push(lineFor(d.product, d.qty, kitLine, `${required} TB for ${cams} cameras at ${ctx.tbPerCamera ?? 1} TB/camera, ${ctx.retentionDays ?? 30} days — cheapest fill`))
        continue
      }
      try {
        switch (c.qty_mode) {
          case 'per_unit': qty = Number(c.qty_value) * kitQty; break
          case 'fixed': qty = Number(c.qty_value); break
          case 'per_n': qty = Math.ceil(kitQty / Math.max(1, Number(c.qty_per ?? 1))) * Number(c.qty_value || 1); break
          case 'per_device_type': qty = Number(c.qty_value) * (ctx.deviceCounts[c.qty_device_type ?? ''] || 0); break
          case 'formula': qty = evalKitFormula(c.qty_formula ?? '0', { ...vars, qty: kitQty }); break
        }
      } catch (err) {
        diagnostics.push({ code: 'kit_formula_error', message: `${kitLine.product_name} → ${product.name}: ${err instanceof Error ? err.message : String(err)}`, product_id: product.id })
        continue
      }
      qty = Math.max(0, Math.round(qty))
      if (qty <= 0) continue
      const line = lineFor(product, qty, kitLine, note)
      added.push(line)
      walk(line, depth + 1)
    }
  }
  for (const line of [...bomItems]) walk(line, 1)
  return { added, questions, diagnostics }
}

/**
 * Merge kit-added lines into the BOM: same product on a non-kit line → ADD
 * quantity (kits are additive); otherwise append.
 */
export function mergeKitLines(bomItems: BOMItem[], added: BOMItem[]): BOMItem[] {
  const out = [...bomItems]
  for (const a of added) {
    const existing = out.find((b) => b.product_id === a.product_id && b.kit_parent_product_id === a.kit_parent_product_id)
    if (existing) { existing.quantity += a.quantity; continue }
    out.push(a)
  }
  return out
}

/**
 * Template supply (locked 23 Sep): a device type the customer supplies on this
 * template stays on the BOM for labour and cabling but carries no price and is
 * never procured.
 */
export function applyTemplateSupply(bomItems: BOMItem[], supply: TemplateSupply[], templateId: string | null): BOMItem[] {
  if (!templateId) return bomItems
  const customer = new Set(supply.filter((s) => s.template_id === templateId && s.supplied_by === 'customer').map((s) => s.device_type))
  if (!customer.size) return bomItems
  return bomItems.map((b) => (b.device_type_code && customer.has(b.device_type_code)
    ? { ...b, cost_price: 0, sell_price: 0, customer_supplied: true, notes: [b.notes, 'customer supplied — labour & cabling only'].filter(Boolean).join(' · ') }
    : b))
}
