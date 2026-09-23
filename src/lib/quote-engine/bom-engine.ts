/**
 * BOM Engine — generates BOM from device counts + product catalog + dependency rules.
 * Ported exactly from centrefit-quote-engine/src/lib/bom-engine.js
 */

import { DEVICE_TYPES, DEFAULT_MARKUP } from './constants'
import type { DeviceCounts, SiteInfo } from './constants'
import { evaluateDependencyRules, autoAddItemsToBOM } from './dependency-engine'
import type { DependencyRule, Product, BOMItem, ElecMaterialOptions } from './dependency-engine'
import { applyTemplateSupply, expandKits, mergeKitLines } from './kits'
import type { DeviceTypeRow, KitAnswers, KitComponent, KitDiagnostic, TemplateSupply } from './kits'

/** Quoting v2 inputs (docs/quoting-v2-CONTEXT.md D1/D3): everything optional so old callers keep working. */
export interface BOMv2Options {
  deviceTypes?: DeviceTypeRow[]
  kitComponents?: KitComponent[]
  kitAnswers?: KitAnswers
  templateSupply?: TemplateSupply[]
  templateId?: string | null
  retentionDays?: number
  tbPerCamera?: number
  /** out-param: what the engine could not do, for lint */
  diagnostics?: KitDiagnostic[]
  /** out-param: kit questions still unanswered */
  kitQuestions?: { component: KitComponent; kit: BOMItem; product: Product }[]
}

export type { Product, DependencyRule, BOMItem } from './dependency-engine'

/** "Kit ships with N × component" — quote_product_kit_contents rows. */
export interface KitContent {
  kit_product_id: string
  component_product_id: string
  quantity: number
}

/**
 * Follow a discontinued product to its replacement (max 3 hops) so new BOM
 * generations quote what can actually be bought. Returns the original when
 * it isn't discontinued, has no replacement, or the replacement is inactive.
 */
export function resolveLiveProduct(
  product: Product | undefined,
  products: Product[]
): { product: Product | undefined; replacedSku: string | null } {
  let current = product
  let replacedSku: string | null = null
  let hops = 0
  while (current && current.discontinued_at && current.replacement_product_id && hops < 3) {
    const nextId = current.replacement_product_id
    const next = products.find((p) => p.id === nextId && p.is_active !== false)
    if (!next) break
    replacedSku = replacedSku ?? (current.sku || current.name)
    current = next
    hops += 1
  }
  return { product: current, replacedSku }
}

export interface BOMTotals {
  totalCost: number
  totalSell: number
  totalProfit: number
  itemCount: number
}

/**
 * Generate BOM items from device counts, product catalog, dependency rules, and site info.
 * 1. Maps device counts to default products.
 * 2. Runs dependency rules to auto-add ancillary products.
 */
export function generateBOM(
  deviceCounts: DeviceCounts,
  products: Product[],
  dependencyRules: DependencyRule[] = [],
  siteInfo: SiteInfo = {},
  elecOptions: ElecMaterialOptions = {},
  // Per-template default product per device type (quote_template_device_defaults):
  // e.g. Planet Fitness REX -> DFMWES2261, Snap -> WEL1911. Falls back to the
  // catalogue's global is_default when the template has no override.
  deviceDefaults: Record<string, string> = {},
  // Kit contents: components already inside a kit product get netted off any
  // rule/device line for the same product so nothing is quoted twice.
  kitContents: KitContent[] = [],
  v2: BOMv2Options = {}
): BOMItem[] {
  const bomItems: BOMItem[] = []
  const diagnostics = v2.diagnostics ?? []

  // Step 1: Map device types to products. The list is the DB table (D3 — so a
  // plan symbol like card_reader or alarm_keypad can't fall through) merged
  // over the code constant; DB rows win. has_hardware=false (data points,
  // integration cables) count for rules and labour but never make a line.
  const dbTypes = (v2.deviceTypes ?? []).filter((d) => d.is_active !== false)
  const typeList = [
    ...DEVICE_TYPES.map((d) => { const db = dbTypes.find((x) => x.code === d.code); return { code: d.code, legend: db?.legend ?? d.legend, category: db?.category ?? d.category, hasHardware: db ? db.has_hardware && !db.count_only : true } }),
    ...dbTypes.filter((d) => !DEVICE_TYPES.some((x) => x.code === d.code)).map((d) => ({ code: d.code, legend: d.legend, category: d.category ?? '', hasHardware: d.has_hardware && !d.count_only })),
  ]
  const customerSupplied = new Set((v2.templateSupply ?? []).filter((s) => s.template_id === v2.templateId && s.supplied_by === 'customer').map((s) => s.device_type))
  typeList.forEach((deviceType) => {
    const count = deviceCounts[deviceType.code] || 0
    if (count === 0) return
    if (!deviceType.hasHardware) return

    const overrideId = deviceDefaults[deviceType.code]
    const pickedProduct = (overrideId
      ? products.find((p) => p.id === overrideId && p.is_active !== false)
      : undefined
    ) || products.find(
      (p) => p.device_type === deviceType.code && p.is_default
    ) || products.find(
      (p) => p.device_type === deviceType.code
    )
    // Discontinued → quote the replacement (lifecycle, 2026-09-08).
    const live = resolveLiveProduct(pickedProduct, products)
    const defaultProduct = live.product
    const lifecycleNote = live.replacedSku ? `replaces ${live.replacedSku}` : ''

    // Reed switches split on the plan builder's Cabled tickbox (all templates,
    // Mitchell 2026-08-11): cabled units are the WIRED DFMWSS60W, uncabled
    // ones the RF RFDW-SM. siteInfo.reed_switch_uncabled carries the untick
    // count; quotes with no plan default to all-cabled (wired).
    if (deviceType.code === 'reed_switch') {
      const uncabled = Math.min(count, siteInfo.reed_switch_uncabled || 0)
      const cabled = count - uncabled
      const bySku = (sku: string) =>
        products.find((p) => p.sku?.toUpperCase() === sku && p.is_active !== false)
      const pushReed = (product: Product | undefined, qty: number, notes: string) => {
        if (qty <= 0) return
        const prod = product ?? defaultProduct
        bomItems.push({
          device_type_code: deviceType.code,
          device_type_legend: deviceType.legend,
          category: deviceType.category,
          product_id: prod?.id || null,
          product_name: prod?.name || `[No product set for ${deviceType.legend}]`,
          sku: prod?.sku || '',
          supplier: prod?.supplier || '',
          quantity: qty,
          cost_price: prod?.cost_price || 0,
          markup: prod?.markup || DEFAULT_MARKUP,
          sell_price: prod?.sell_price || 0,
          notes,
          auto_added: false,
          rule_description: null,
        })
      }
      pushReed(bySku('DFMWSS60W'), cabled, '')
      pushReed(bySku('RFDW-SM'), uncabled, 'wireless (RF)')
      return
    }

    // Wall speakers come in boxes of 2 (both colour variants)
    const isWallSpeaker = deviceType.code === 'speaker_wall_black' || deviceType.code === 'speaker_wall_white'
    const orderQty = isWallSpeaker ? Math.ceil(count / 2) : count
    if (!defaultProduct && !customerSupplied.has(deviceType.code)) {
      diagnostics.push({ code: 'device_no_product', message: `${count} × ${deviceType.legend}: no active product carries device type "${deviceType.code}"` })
    }

    bomItems.push({
      device_type_code: deviceType.code,
      device_type_legend: deviceType.legend,
      category: deviceType.category,
      product_id: defaultProduct?.id || null,
      product_name: defaultProduct?.name || `[No product set for ${deviceType.legend}]`,
      sku: defaultProduct?.sku || '',
      supplier: defaultProduct?.supplier || '',
      quantity: orderQty,
      cost_price: defaultProduct?.cost_price || 0,
      markup: defaultProduct?.markup || DEFAULT_MARKUP,
      sell_price: defaultProduct?.sell_price || 0,
      notes: [isWallSpeaker && count !== orderQty ? `${count} speakers (sold in pairs)` : '', lifecycleNote]
        .filter(Boolean)
        .join(' · '),
      auto_added: false,
      rule_description: null,
    })
  })

  // Step 2: Run dependency rules
  if (dependencyRules.length > 0) {
    const autoItems = evaluateDependencyRules(dependencyRules, deviceCounts, products, siteInfo, elecOptions)
    const autoAddBOM = autoAddItemsToBOM(autoItems)

    // Lifecycle: rule-added products that are discontinued → their replacement.
    autoAddBOM.forEach((autoItem) => {
      if (!autoItem.product_id) return
      const original = products.find((p) => p.id === autoItem.product_id)
      const live = resolveLiveProduct(original, products)
      if (live.product && live.replacedSku && live.product.id !== autoItem.product_id) {
        autoItem.product_id = live.product.id
        autoItem.product_name = live.product.name
        autoItem.sku = live.product.sku || ''
        autoItem.supplier = live.product.supplier || ''
        autoItem.cost_price = live.product.cost_price || 0
        autoItem.markup = live.product.markup || DEFAULT_MARKUP
        autoItem.sell_price = live.product.sell_price || 0
        autoItem.notes = [autoItem.notes, `replaces ${live.replacedSku}`].filter(Boolean).join(' · ')
      }
    })

    autoAddBOM.forEach((autoItem) => {
      const existing = bomItems.find((b) => b.product_id === autoItem.product_id)
      if (existing) {
        if (autoItem.quantity > existing.quantity) {
          existing.quantity = autoItem.quantity
        }
        existing.auto_added = true
        existing.rule_description = autoItem.rule_description
      } else {
        bomItems.push(autoItem)
      }
    })
  }

  // Step 2b (v2): customer-supplied device types on this template — keep the
  // line for labour and cabling, strip the price, never procure.
  let items = applyTemplateSupply(bomItems, v2.templateSupply ?? [], v2.templateId ?? null)
  bomItems.length = 0
  bomItems.push(...items)

  // Step 2c (v2): kits — "quoting X requires these components" (D1). Additive.
  if (v2.kitComponents?.length) {
    const kitResult = expandKits(bomItems, products, v2.kitComponents, {
      deviceCounts, siteInfo, kitAnswers: v2.kitAnswers ?? {}, retentionDays: v2.retentionDays, tbPerCamera: v2.tbPerCamera,
    })
    items = mergeKitLines(bomItems, kitResult.added)
    bomItems.length = 0
    bomItems.push(...items)
    diagnostics.push(...kitResult.diagnostics)
    if (v2.kitQuestions) v2.kitQuestions.push(...kitResult.questions)
  }

  // Step 3: Kits. A kit line already contains its components — net them off
  // any other line for the same product so the quote never carries both
  // (Sue, 2026-09-06: the K6000 kit ships with its MW730B enclosure).
  if (kitContents.length > 0) {
    for (const kitLine of [...bomItems]) {
      if (!kitLine.product_id) continue
      const contents = kitContents.filter((k) => k.kit_product_id === kitLine.product_id)
      if (contents.length === 0) continue
      const included: string[] = []
      for (const c of contents) {
        const covered = Number(c.quantity) * kitLine.quantity
        if (!(covered > 0)) continue
        const idx = bomItems.findIndex((b) => b !== kitLine && b.product_id === c.component_product_id)
        if (idx === -1) continue
        const comp = bomItems[idx]
        const removed = Math.min(comp.quantity, covered)
        if (removed <= 0) continue
        included.push(`${removed}× ${comp.sku || comp.product_name}`)
        comp.quantity -= removed
        if (comp.quantity <= 0) {
          bomItems.splice(idx, 1)
        } else {
          comp.notes = [comp.notes, `${removed} covered by ${kitLine.sku || kitLine.product_name} kit`].filter(Boolean).join(' · ')
        }
      }
      if (included.length > 0) {
        kitLine.notes = [kitLine.notes, `kit includes ${included.join(', ')}`].filter(Boolean).join(' · ')
      }
    }
  }

  return bomItems
}

/**
 * Update a BOM item when the user changes the product selection.
 */
export function updateBOMProduct(bomItem: BOMItem, newProduct: Product): BOMItem {
  return {
    ...bomItem,
    product_id: newProduct.id,
    product_name: newProduct.name,
    sku: newProduct.sku || '',
    supplier: newProduct.supplier || '',
    cost_price: newProduct.cost_price,
    markup: newProduct.markup || DEFAULT_MARKUP,
    sell_price: newProduct.sell_price || newProduct.cost_price * (1 + (newProduct.markup || DEFAULT_MARKUP)),
  }
}

/**
 * Calculate BOM totals.
 */
export function calculateBOMTotals(bomItems: BOMItem[]): BOMTotals {
  let totalCost = 0
  let totalSell = 0

  bomItems.forEach((item) => {
    totalCost += (item.cost_price || 0) * (item.quantity || 0)
    totalSell += (item.sell_price || 0) * (item.quantity || 0)
  })

  return {
    totalCost,
    totalSell,
    totalProfit: totalSell - totalCost,
    itemCount: bomItems.reduce((sum, item) => sum + (item.quantity || 0), 0),
  }
}
