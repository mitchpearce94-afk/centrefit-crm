/**
 * Formula-based Labour Engine
 * Every minute is accounted for and auditable.
 * Cost rate: $75/hr, Sell rate: $150/hr
 *
 * Ported EXACTLY from centrefit-quote-engine/src/lib/labour-engine.js
 */

import { LABOUR_COST_RATE, LABOUR_SELL_RATE } from './constants'
import type { DeviceCounts, SiteInfo } from './constants'

// ── Types ──

export interface LabourItem {
  name: string
  formula: string
  defaultHours: number
  hours: number
  unitRate?: number     // e.g. 80 — priced per unit instead of hourly rate (callout $80/day)
  unitLabel?: string    // e.g. "days" — replaces "hrs" in the UI
  isDollarInput?: boolean  // if true, "hours" field IS the dollar amount (incidentals)
}

export interface FixedCost {
  name: string
  cost: number
  sell: number
}

export interface LabourSection {
  name: string
  mandatory: boolean
  warning: string | null
  items: LabourItem[]
  totalHours: number
  totalCost: number
  totalSell: number
}

export interface LabourData {
  sections: LabourSection[]
  fixedCosts: FixedCost[]
  grandTotalHours: number
  grandTotalCost: number
  grandTotalSell: number
  costRate: number
  sellRate: number
}

export interface LabourWarning {
  name: string
  warning: string
}

// ── Helpers ──

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function fixedItem(name: string, hours: number): LabourItem {
  return { name, formula: `Fixed ${hours} hrs`, defaultHours: hours, hours }
}

function itemSell(item: LabourItem, sellRate: number): number {
  if (item.isDollarInput) return item.hours
  if (item.unitRate) return item.hours * item.unitRate
  return item.hours * sellRate
}

function itemCost(item: LabourItem, costRate: number): number {
  if (item.isDollarInput) return item.hours
  if (item.unitRate) return item.hours * item.unitRate
  return item.hours * costRate
}

function buildSectionFromItems(name: string, items: LabourItem[], mandatory: boolean, costRate = LABOUR_COST_RATE, sellRate = LABOUR_SELL_RATE): LabourSection {
  const hourItems = items.filter(i => !i.unitRate && !i.isDollarInput)
  const totalHours = round(hourItems.reduce((sum, i) => sum + i.hours, 0))
  return {
    name,
    mandatory,
    warning: null,
    items,
    totalHours,
    totalCost: round(items.reduce((sum, i) => sum + itemCost(i, costRate), 0)),
    totalSell: round(items.reduce((sum, i) => sum + itemSell(i, sellRate), 0)),
  }
}

// ── Main calculation ──

export interface RateOverrides {
  labourCostRate?: number
  labourSellRate?: number
  calloutCost?: number
  calloutSell?: number
  incidentalsCost?: number
  incidentalsSell?: number
  adminCost?: number
  adminSell?: number
}

export type LabourTimingOverrides = Record<string, number> // code → minutes_per

export interface ElecOptions {
  elecDoingRoughIn?: boolean
  elecDoingFitOff?: boolean
}

export function calculateLabour(deviceCounts: DeviceCounts, siteInfo: SiteInfo = {}, rates: RateOverrides = {}, timingOverrides: LabourTimingOverrides = {}, elecOptions: ElecOptions = {}): LabourData {
  const c = deviceCounts || {}
  const s = siteInfo || {}
  const sections: LabourSection[] = []
  const cr = rates.labourCostRate ?? LABOUR_COST_RATE
  const sr = rates.labourSellRate ?? LABOUR_SELL_RATE
  const buildSection = (name: string, items: LabourItem[], mandatory: boolean) => buildSectionFromItems(name, items, mandatory, cr, sr)
  const t = (code: string, fallback: number) => timingOverrides[code] ?? fallback

  // === 1. ROUGH IN ===

  const cabledReedSwitches = Math.max(0, (c.reed_switch || 0) - (s.reed_switch_uncabled || 0))

  const totalCableRuns =
    (c.camera_black || 0) + (c.camera_white || 0) +
    (c.pir_360_roof || 0) + (c.pir_wall || 0) +
    cabledReedSwitches +
    (c.speaker_roof || 0) + (c.speaker_wall || 0) +
    (c.wap || 0) + (c.data_point || 0) +
    (c.duress_button || 0) + (c.duress_intercom || 0) +
    (c.light_siren || 0) + (c.rex_button || 0) +
    (c.tailgate_system || 0)

  const roughInItems: LabourItem[] = []
  const elecRoughIn = elecOptions.elecDoingRoughIn || false
  const elecFitOff = elecOptions.elecDoingFitOff || false

  if (totalCableRuns > 0) {
    // Skip cable pulling if electrician is handling rough in
    if (!elecRoughIn) {
      const pullHrs = round((totalCableRuns * 60) / 60)
      roughInItems.push({
        name: 'Cable pulling',
        formula: `${totalCableRuns} runs × 60 min (1 hr per run, 2-person crew)`,
        defaultHours: pullHrs,
        hours: pullHrs,
      })
    }

    const termHrs = round((totalCableRuns * 8) / 60)
    roughInItems.push({
      name: 'Termination',
      formula: `${totalCableRuns} cables × 8 min (both ends)`,
      defaultHours: termHrs,
      hours: termHrs,
    })

    const avTermCount = (s.tv_count || 0) + (s.cardio_count || 0)
    if (avTermCount > 0) {
      const avTermHrs = round((avTermCount * 2) / 60)
      roughInItems.push({
        name: 'AV termination',
        formula: `${avTermCount} AV points (${s.tv_count || 0} TVs + ${s.cardio_count || 0} cardio) × 2 min`,
        defaultHours: avTermHrs,
        hours: avTermHrs,
      })
    }
  }

  sections.push(buildSection('Rough In', roughInItems, false))

  // === Shared flags ===

  const totalCameras = (c.camera_black || 0) + (c.camera_white || 0)
  const concreteCameras = (s.concrete_mount_black || 0) + (s.concrete_mount_white || 0)
  const plasterCameras = Math.max(0, totalCameras - concreteCameras)
  const cameras = totalCameras
  const hasAlarm = (c.alarm_panel || 0) > 0
  const hasCameras = cameras > 0
  const hasSpeakers = ((c.speaker_roof || 0) + (c.speaker_wall || 0)) > 0
  const wapCount = c.wap || 0
  const hasCabinet =
    ((c.cabinet_9ru || 0) + (c.cabinet_27ru || 0) +
     (c.cabinet_32ru || 0) + (c.cabinet_42ru || 0)) > 0

  // === 2. FIT OFF ===

  const fitOffDefs = [
    { name: 'Camera install (plaster)', minutesPer: t('camera_plaster', 30), count: plasterCameras },
    { name: 'Camera install (concrete)', minutesPer: t('camera_concrete', 45), count: concreteCameras },
    { name: 'PIR 360° ceiling', minutesPer: t('pir_360_roof', 20), count: c.pir_360_roof || 0 },
    { name: 'PIR wall', minutesPer: t('pir_wall', 20), count: c.pir_wall || 0 },
    { name: 'Reed switch', minutesPer: t('reed_switch', 25), count: c.reed_switch || 0 },
    { name: 'Duress button + faceplate', minutesPer: t('duress_button', 40), count: c.duress_button || 0 },
    { name: 'Duress intercom', minutesPer: t('duress_intercom', 30), count: c.duress_intercom || 0 },
    { name: 'REX button', minutesPer: t('rex_button', 60), count: c.rex_button || 0 },
    { name: 'External siren', minutesPer: t('light_siren', 40), count: c.light_siren || 0 },
    { name: 'WAP', minutesPer: t('wap', 30), count: c.wap || 0 },
    { name: 'Ceiling speaker', minutesPer: t('speaker_roof', 40), count: c.speaker_roof || 0 },
    { name: 'Wall speaker', minutesPer: t('speaker_wall', 30), count: c.speaker_wall || 0 },
    { name: 'Tailgate system', minutesPer: t('tailgate_system', 90), count: c.tailgate_system || 0 },
    { name: 'Card reader', minutesPer: t('card_reader', 30), count: c.card_reader || 0 },
    { name: 'Door lock', minutesPer: t('door_lock', 30), count: c.door_lock || 0 },
    { name: 'Integration cable', minutesPer: t('integration_cable', 30), count: c.integration_cable || 0 },
    { name: 'Alarm keypad', minutesPer: t('alarm_keypad', 20), count: c.alarm_keypad || 0 },
    { name: 'RF receiver', minutesPer: t('rf_receiver', 20), count: c.rf_receiver || 0 },
    { name: 'Data point', minutesPer: t('data_point', 15), count: c.data_point || 0 },
    { name: 'Coax point', minutesPer: t('coax_point', 15), count: c.coax_point || 0 },
    { name: 'Intercom master', minutesPer: t('intercom_master', 20), count: c.intercom_master || 0 },
    { name: 'Intercom slave', minutesPer: t('intercom_slave', 30), count: c.intercom_slave || 0 },
  ]

  // If electrician is doing fit off, skip all device mounting items
  const fitOffItems: LabourItem[] = elecFitOff ? [] : fitOffDefs
    .filter((d) => d.count > 0)
    .map((d) => {
      const hrs = round((d.count * d.minutesPer) / 60)
      return {
        name: d.name,
        formula: `${d.count} × ${d.minutesPer} min`,
        defaultHours: hrs,
        hours: hrs,
      }
    })

  const tvCount = s.tv_count || 0
  if (tvCount > 0) {
    const tvHrs = round(tvCount * 2)
    fitOffItems.push({
      name: 'Mount TVs',
      formula: `${tvCount} TVs × 1 hr × 2 techs`,
      defaultHours: tvHrs,
      hours: tvHrs,
    })
  }

  fitOffItems.push(fixedItem('Site setup', 2))
  fitOffItems.push(fixedItem('Cleanup', 2))
  if (hasCabinet) fitOffItems.push(fixedItem('Server rack wiring in', 12))
  if (hasAlarm) fitOffItems.push(fixedItem('Alarm panel wiring in', 4))

  const fitOffDefaultTotal = fitOffItems.reduce((sum, i) => sum + i.defaultHours, 0)
  const hasFitOffWork = fitOffDefaultTotal > 0

  const fitOffSection = buildSection('Fit Off', fitOffItems, false)
  if (fitOffSection.totalHours === 0 && hasFitOffWork) {
    fitOffSection.warning = 'THIS IS WHAT GOT MISSED ON TOTAL FUSION DOCKLANDS'
  }
  sections.push(fitOffSection)

  // === 3. COMMISSIONING & BUILD ===

  const commItems: LabourItem[] = []

  if (hasCabinet) commItems.push(fixedItem('Server rack build', 6))
  if (hasAlarm) commItems.push(fixedItem('Alarm panel build', 8))

  if (hasCameras) {
    const nvrHrs = round((20 + cameras * 5) / 60)
    commItems.push({
      name: 'NVR config',
      formula: `20 min base + ${cameras} cameras × 5 min`,
      defaultHours: nvrHrs,
      hours: nvrHrs,
    })
  }

  commItems.push(fixedItem('Switch config (VLANs, network)', 1))

  if (wapCount > 0) {
    const wapHrs = round((wapCount * 30) / 60)
    commItems.push({
      name: 'WAP config',
      formula: `${wapCount} WAPs × 30 min`,
      defaultHours: wapHrs,
      hours: wapHrs,
    })
  }

  if (hasAlarm) {
    commItems.push({
      name: 'Test & commission alarm',
      formula: 'Fixed 1.5 hrs (1hr + 0.5hr fault allowance)',
      defaultHours: 1.5,
      hours: 1.5,
    })
  }

  if (hasCameras) commItems.push(fixedItem('Test & commission CCTV', 0.5))
  if (hasSpeakers) {
    commItems.push({
      name: 'Audio system tune & balance',
      formula: 'Fixed 15 min',
      defaultHours: 0.25,
      hours: 0.25,
    })
  }

  commItems.push({
    name: 'AV/Nightlife config',
    formula: 'Fixed 10 min',
    defaultHours: round(10 / 60),
    hours: round(10 / 60),
  })

  commItems.push(fixedItem('Handover + training', 0.5))
  commItems.push(fixedItem('As-built documentation', 0.5))

  sections.push(buildSection('Commissioning & Build', commItems, false))

  // === 4. OTHER ===

  const roughInHours = sections[0]?.totalHours || 0
  const fitOffHours = sections[1]?.totalHours || 0
  const isQLD = !s.state || s.state === 'QLD'
  const calloutDays = isQLD ? Math.max(1, Math.ceil((roughInHours + fitOffHours) / 10)) : 0

  const otherItems: LabourItem[] = [
    fixedItem('Plan design & quotation', 4),
  ]
  if (isQLD) {
    otherItems.push({ name: 'Callout', formula: `(${roughInHours}h + ${fitOffHours}h) ÷ 10hr days = ${calloutDays} days × $80`, defaultHours: calloutDays, hours: calloutDays, unitRate: 80, unitLabel: 'days' })
  }
  otherItems.push(
    { name: 'Hardware Incidentals', formula: 'Flat dollar amount', defaultHours: 200, hours: 200, isDollarInput: true },
    { name: 'Administration', formula: 'Fixed 2 hrs × $120/hr', defaultHours: 2, hours: 2, unitRate: 120, unitLabel: 'hrs' },
  )

  sections.push(buildSection('Other', otherItems, false))

  // === 5. FIXED COSTS ===

  const fixedCosts: FixedCost[] = []

  // === GRAND TOTALS ===

  const fixedCostTotal = fixedCosts.reduce((sum, fc) => sum + fc.sell, 0)
  const fixedCostCostTotal = fixedCosts.reduce((sum, fc) => sum + fc.cost, 0)
  const grandTotalHours = sections.reduce((sum, sec) => sum + sec.totalHours, 0)
  const grandTotalCost = sections.reduce((sum, sec) => sum + sec.totalCost, 0) + fixedCostCostTotal
  const grandTotalSell = sections.reduce((sum, sec) => sum + sec.totalSell, 0) + fixedCostTotal

  return {
    sections,
    fixedCosts,
    grandTotalHours,
    grandTotalCost,
    grandTotalSell,
    costRate: cr,
    sellRate: sr,
  }
}

// ── Recalculate after user edits ──

export function recalcLabour(labourData: LabourData): LabourData {
  const sections = labourData.sections.map((section) => {
    const items = section.items.map((item) => ({ ...item }))
    return buildSectionFromItems(section.name, items, section.mandatory)
  })

  const fitOff = sections.find((s) => s.name === 'Fit Off')
  if (fitOff && fitOff.mandatory) {
    const hasDefaultWork = fitOff.items.some((i) => i.defaultHours > 0)
    if (hasDefaultWork && fitOff.totalHours === 0) {
      fitOff.warning = 'THIS IS WHAT GOT MISSED ON TOTAL FUSION DOCKLANDS'
    }
  }

  const fixedCosts = labourData.fixedCosts
  const fixedCostTotal = fixedCosts.reduce((sum, fc) => sum + fc.sell, 0)
  const fixedCostCostTotal = fixedCosts.reduce((sum, fc) => sum + fc.cost, 0)
  const grandTotalHours = sections.reduce((sum, sec) => sum + sec.totalHours, 0)
  const grandTotalCost = sections.reduce((sum, sec) => sum + sec.totalCost, 0) + fixedCostCostTotal
  const grandTotalSell = sections.reduce((sum, sec) => sum + sec.totalSell, 0) + fixedCostTotal

  return {
    ...labourData,
    sections,
    grandTotalHours,
    grandTotalCost,
    grandTotalSell,
  }
}

// ── Mandatory warnings ──

export function checkMandatoryLabour(labourData: LabourData): LabourWarning[] {
  if (!labourData || !labourData.sections) return []
  const warnings: LabourWarning[] = []

  for (const section of labourData.sections) {
    if (section.mandatory && section.warning) {
      warnings.push({ name: section.name, warning: section.warning })
    }
    if (section.mandatory && section.totalHours === 0) {
      const hasDefaultWork = section.items.some((i) => i.defaultHours > 0)
      if (hasDefaultWork) {
        warnings.push({
          name: `${section.name} — labour zeroed out`,
          warning: 'THIS IS WHAT GOT MISSED ON TOTAL FUSION DOCKLANDS',
        })
      }
    }
  }

  return warnings
}
