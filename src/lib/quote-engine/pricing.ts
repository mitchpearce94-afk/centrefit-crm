/**
 * Quote pricing summary with Centrefit invoice structure.
 * Ported EXACTLY from centrefit-quote-engine/src/lib/pricing.js
 *
 * PP1 = Total COST (parts buy + labour cost + fixed costs + extras cost)
 * PP2 = Total SELL minus PP1 (profit/margin)
 * Discount: adds 5% to PP2 first, then shows "discounted" total
 */

import { GST_RATE } from './constants'
import type { ExtraItem } from './constants'
import type { BOMItem } from './dependency-engine'
import type { LabourData } from './labour-engine'

export interface QuoteSummary {
  materials: { cost: number; sell: number; profit: number; markup: number }
  labour: {
    byCategory: Record<string, number>
    totalSell: number
    totalCost: number
    timeCost: number
    timeSell: number
    profit: number
  }
  fixedCosts: {
    callout: number
    incidentals: number
    admin: number
    totalCost: number
    totalSell: number
  }
  extras: { cost: number; sell: number }
  pp1: {
    partsCost: number
    labourCost: number
    callout: number
    incidentals: number
    admin: number
    extrasCost: number
    total: number
  }
  pp2: {
    partsProfit: number
    labourProfit: number
    fixedProfit: number
    extrasProfit: number
    base: number
    total: number
  }
  discount: { percent: number; amount: number }
  totalExGST: number
  gst: number
  totalIncGST: number
  fullPriceExGST: number
  fullPriceIncGST: number
  targetExGST: number
  profit: number
}

export function calculateQuoteSummary(
  bomItems: BOMItem[],
  labourData: LabourData,
  extras: ExtraItem[],
  options: { discountPercent?: number; electricianCost?: number; isInterstate?: boolean } = {}
): QuoteSummary {
  const { discountPercent = 0, electricianCost = 0, isInterstate = false } = options

  // Materials
  const materialsCost = bomItems.reduce((sum, item) => sum + (item.cost_price || 0) * (item.quantity || 0), 0)
  const materialsSell = bomItems.reduce((sum, item) => sum + (item.sell_price || 0) * (item.quantity || 0), 0)
  const materialsProfit = materialsSell - materialsCost

  // Labour
  const labourByCategory: Record<string, number> = {}
  let labourTotalSell = 0
  let labourTotalCost = 0
  let fixedCostsSell = 0
  let fixedCostsCost = 0

  if (labourData && labourData.sections) {
    labourData.sections.forEach((section) => {
      if (section.totalSell > 0) {
        labourByCategory[section.name] = section.totalSell
      }
      labourTotalSell += section.totalSell
      labourTotalCost += section.totalCost
    })
    if (labourData.fixedCosts) {
      labourData.fixedCosts.forEach((fc) => {
        fixedCostsSell += fc.sell
        fixedCostsCost += fc.cost
      })
      if (fixedCostsSell > 0) {
        labourByCategory['Fixed Costs'] = fixedCostsSell
      }
      labourTotalSell += fixedCostsSell
      labourTotalCost += fixedCostsCost
    }
  }

  // Extras
  let extrasCost = 0
  let extrasSell = 0
  extras.forEach((item) => {
    extrasCost += item.cost || 0
    extrasSell += item.sell || 0
  })

  // Electrician — interstate: 2x (double), QLD: 1.3x (30% margin)
  if (electricianCost > 0) {
    const elecMultiplier = isInterstate ? 2 : 1.3
    const elecSell = Math.round(electricianCost * elecMultiplier * 100) / 100
    extrasCost += electricianCost
    extrasSell += elecSell
  }

  const labourTimeCost = labourTotalCost - fixedCostsCost
  const labourTimeSell = labourTotalSell - fixedCostsSell
  const labourProfit = labourTimeSell - labourTimeCost

  // === PROGRESS PAYMENTS ===

  const pp1Callout = labourData?.fixedCosts?.find((fc) => fc.name === 'Callout')?.cost || 0
  const pp1Incidentals = labourData?.fixedCosts?.find((fc) => fc.name === 'Hardware Incidentals')?.cost || 0
  const pp1Admin = labourData?.fixedCosts?.find((fc) => fc.name.startsWith('Administration'))?.cost || 0
  const pp1Total = materialsCost + labourTimeCost + pp1Callout + pp1Incidentals + pp1Admin + extrasCost

  const pp2PartsProfit = materialsProfit
  const pp2LabourProfit = labourProfit
  const pp2FixedProfit = fixedCostsSell - fixedCostsCost
  const pp2ExtrasProfit = extrasSell - extrasCost
  const pp2Base = pp2PartsProfit + pp2LabourProfit + pp2FixedProfit + pp2ExtrasProfit
  const pp2Total = pp2Base
  const targetExGST = pp1Total + pp2Base

  // 5% uplift
  const upliftRate = 0.05
  const fullPriceExGST = targetExGST * (1 + upliftRate)
  const fullPriceGst = fullPriceExGST * GST_RATE
  const fullPriceIncGST = fullPriceExGST + fullPriceGst
  const discountAmount = fullPriceExGST - targetExGST

  const displayExGST = discountPercent > 0 ? targetExGST : fullPriceExGST
  const displayGst = displayExGST * GST_RATE
  const displayIncGST = displayExGST + displayGst

  return {
    materials: {
      cost: materialsCost,
      sell: materialsSell,
      profit: materialsProfit,
      markup: materialsCost > 0 ? ((materialsSell - materialsCost) / materialsCost) : 0,
    },
    labour: {
      byCategory: labourByCategory,
      totalSell: labourTotalSell,
      totalCost: labourTotalCost,
      timeCost: labourTimeCost,
      timeSell: labourTimeSell,
      profit: labourProfit,
    },
    fixedCosts: {
      callout: pp1Callout,
      incidentals: pp1Incidentals,
      admin: pp1Admin,
      totalCost: fixedCostsCost,
      totalSell: fixedCostsSell,
    },
    extras: { cost: extrasCost, sell: extrasSell },
    pp1: {
      partsCost: materialsCost,
      labourCost: labourTimeCost,
      callout: pp1Callout,
      incidentals: pp1Incidentals,
      admin: pp1Admin,
      extrasCost,
      total: pp1Total,
    },
    pp2: {
      partsProfit: pp2PartsProfit,
      labourProfit: pp2LabourProfit,
      fixedProfit: pp2FixedProfit,
      extrasProfit: pp2ExtrasProfit,
      base: pp2Base,
      total: pp2Total,
    },
    discount: { percent: discountPercent, amount: discountAmount },
    totalExGST: displayExGST,
    gst: displayGst,
    totalIncGST: displayIncGST,
    fullPriceExGST,
    fullPriceIncGST,
    targetExGST,
    profit: displayExGST - pp1Total,
  }
}
