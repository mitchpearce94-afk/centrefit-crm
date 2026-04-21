/**
 * BOM Engine — generates BOM from device counts + product catalog + dependency rules.
 * Ported exactly from centrefit-quote-engine/src/lib/bom-engine.js
 */

import { DEVICE_TYPES, DEFAULT_MARKUP } from './constants'
import type { DeviceCounts, SiteInfo } from './constants'
import { evaluateDependencyRules, autoAddItemsToBOM } from './dependency-engine'
import type { DependencyRule, Product, BOMItem } from './dependency-engine'

export type { Product, DependencyRule, BOMItem } from './dependency-engine'

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
  siteInfo: SiteInfo = {}
): BOMItem[] {
  const bomItems: BOMItem[] = []

  // Step 1: Map device types to products
  DEVICE_TYPES.forEach((deviceType) => {
    const count = deviceCounts[deviceType.code] || 0
    if (count === 0) return

    const defaultProduct = products.find(
      (p) => p.device_type === deviceType.code && p.is_default
    ) || products.find(
      (p) => p.device_type === deviceType.code
    )

    // Wall speakers come in boxes of 2 (both colour variants)
    const isWallSpeaker = deviceType.code === 'speaker_wall_black' || deviceType.code === 'speaker_wall_white'
    const orderQty = isWallSpeaker ? Math.ceil(count / 2) : count

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
      notes: isWallSpeaker && count !== orderQty
        ? `${count} speakers (sold in pairs)`
        : '',
      auto_added: false,
      rule_description: null,
    })
  })

  // Step 2: Run dependency rules
  if (dependencyRules.length > 0) {
    const autoItems = evaluateDependencyRules(dependencyRules, deviceCounts, products, siteInfo)
    const autoAddBOM = autoAddItemsToBOM(autoItems)

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
