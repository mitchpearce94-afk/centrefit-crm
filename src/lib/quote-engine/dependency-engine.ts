/**
 * Product Dependency Rules Engine.
 *
 * Evaluates "if this, then that" rules against device counts and site info,
 * returning a list of products to auto-add to the BOM.
 *
 * Ported exactly from centrefit-quote-engine/src/lib/dependency-engine.js
 */

import { DEFAULT_MARKUP } from './constants'
import type { DeviceCounts, SiteInfo } from './constants'

// ── Types ──

export interface DependencyRule {
  id: string
  preset: string
  description: string
  is_active: boolean
  trigger_code: string | null
  trigger_condition: string // 'always' | 'greater_than' | 'greater_than_or_equal' | 'equals' | 'range' | 'compound' | 'site_conditional' | 'site_boolean'
  trigger_value?: number
  trigger_min?: number
  trigger_max?: number
  trigger_site_field?: string
  trigger_site_value?: number
  trigger_site_op?: string
  quantity_mode: string // 'fixed' | 'match_trigger' | 'match_site_field' | 'per_n' | 'ceil_formula' | 'formula' | 'custom'
  quantity_value?: number
  quantity_site_field?: string
  quantity_multiplier?: number
  quantity_divisor?: number
  quantity_formula?: string
  quantity_custom_key?: string
  auto_add_product_id?: string
  auto_add_product_sku?: string | null
  auto_add_product_name?: string | null
  sort_order?: number
  // internal
  _needs_studio_zone?: boolean
}

export interface Product {
  id: string
  name: string
  sku: string
  category: string
  supplier: string
  cost_price: number
  markup: number
  sell_price: number
  device_type: string | null
  is_default: boolean
  is_active: boolean
}

export interface AutoAddItem {
  product: Product
  quantity: number
  ruleId: string
  ruleDescriptions: string[]
}

export interface BOMItem {
  device_type_code: string | null
  device_type_legend: string | null
  category: string
  product_id: string | null
  product_name: string
  sku: string
  supplier: string
  quantity: number
  cost_price: number
  markup: number
  sell_price: number
  notes: string
  auto_added: boolean
  rule_description: string | null
}

// ── Site Info Fields ──

const SITE_INFO_FIELDS = [
  'site_sqm', 'door_count', 'external_camera_count',
  'concrete_mount_black', 'concrete_mount_white',
  'cardio_count', 'tv_count', 'ceiling_tv_count',
  'wall_tv_mount_count', 'ceiling_tv_mount_count',
  'separate_studio_zone',
]

// ── Resolve trigger code → numeric count ──

// Legacy rule trigger codes that pre-date the speaker colour split. The
// device catalogue now emits four codes (speaker_roof_black/white,
// speaker_wall_black/white) but rules seeded earlier still reference the
// old singular codes. Resolve them transparently so the 240W amp / 120W
// amp / speaker cable / Clipsal bracket rules keep firing without a
// DB migration.
const LEGACY_CODE_ALIASES: Record<string, string[]> = {
  speaker_roof: ['speaker_roof_black', 'speaker_roof_white'],
  speaker_wall: ['speaker_wall_black', 'speaker_wall_white'],
}

function resolveTriggerCount(triggerCode: string | null, deviceCounts: DeviceCounts, siteInfo: SiteInfo = {}): number {
  if (!triggerCode) return 0
  const codes = triggerCode.split('+').map((c) => c.trim())
  return codes.reduce((sum, code) => {
    if (SITE_INFO_FIELDS.includes(code)) {
      return sum + (Number((siteInfo as Record<string, unknown>)[code]) || 0)
    }
    const expanded = LEGACY_CODE_ALIASES[code] ?? [code]
    let codeSum = 0
    for (const ec of expanded) {
      let count = deviceCounts[ec] || 0
      // Uncabled reed switches don't need cable runs — subtract from cable formulas
      if (ec === 'reed_switch' && siteInfo.reed_switch_uncabled) {
        count = Math.max(0, count - siteInfo.reed_switch_uncabled)
      }
      codeSum += count
    }
    return sum + codeSum
  }, 0)
}

// ── Custom quantity calculations ──

function calculateCustomQuantity(key: string, deviceCounts: DeviceCounts, siteInfo: SiteInfo = {}): number {
  const dc = deviceCounts
  const si = siteInfo

  switch (key) {
    case 'security_4w_plugs': {
      const doors = si.door_count || 0
      const pirs = (dc.pir_360_roof || 0) + (dc.pir_wall || 0)
      return doors + pirs + 2
    }
    case 'security_2w_plugs': {
      const doors = si.door_count || 0
      return doors + 6
    }
    case 'security_6w_plugs': {
      const doors = si.door_count || 0
      return doors
    }
    case 'av_8way_splitter': {
      const cardio = si.cardio_count || 0
      const tvs = si.tv_count || 0
      const ceilingTvs = si.ceiling_tv_count || 0
      const total = cardio + tvs + ceilingTvs
      return total > 0 ? Math.ceil(total / 8) : 0
    }
    case 'av_rg6_crimps': {
      const total = (si.cardio_count || 0) + (si.tv_count || 0) + (si.ceiling_tv_count || 0)
      return total > 0 ? Math.max(1, Math.ceil(total / 50)) : 1
    }
    case 'av_pal_adapters': {
      return ((si.tv_count || 0) + (si.ceiling_tv_count || 0)) * 2
    }
    case 'av_fly_leads': {
      return (si.tv_count || 0) + (si.ceiling_tv_count || 0)
    }
    case 'av_wall_tv_mounts': {
      return si.wall_tv_mount_count || 0
    }
    case 'av_ceiling_tv_mounts': {
      return si.ceiling_tv_mount_count || 0
    }
    case 'av_active_tap': {
      const total = (si.cardio_count || 0) + (si.tv_count || 0) + (si.ceiling_tv_count || 0)
      return total > 8 ? 1 : 0
    }
    case 'cabinet_500mm_patch_leads': {
      // Base of 2 per cabinet + 1 extra for every (up to) 2 card readers.
      // 0 readers → 2, 1 reader → 3, 2 readers → 3, 3 readers → 4.
      const readers = dc.card_reader || 0
      return 2 + Math.ceil(readers / 2)
    }
    default:
      return 0
  }
}

// ── Condition evaluation ──

function evaluateCondition(rule: DependencyRule, deviceCounts: DeviceCounts, siteInfo: SiteInfo = {}): boolean {
  if (rule.trigger_condition === 'always') return true

  if (rule.trigger_condition === 'site_conditional') {
    const fieldVal = Number((siteInfo as Record<string, unknown>)[rule.trigger_site_field!]) || 0
    const target = Number(rule.trigger_site_value) || 0
    switch (rule.trigger_site_op) {
      case '<=': return fieldVal <= target
      case '<':  return fieldVal < target
      case '>=': return fieldVal >= target
      case '>':  return fieldVal > target
      case '==': return fieldVal === target
      case '!=': return fieldVal !== target
      default:   return false
    }
  }

  if (rule.trigger_condition === 'site_boolean') {
    return !!(siteInfo as Record<string, unknown>)[rule.trigger_site_field!]
  }

  if (rule.trigger_condition === 'compound') {
    const count = resolveTriggerCount(rule.trigger_code, deviceCounts, siteInfo)
    const deviceMet = count > (rule.trigger_value || 0)

    const fieldVal = Number((siteInfo as Record<string, unknown>)[rule.trigger_site_field!]) || 0
    const target = Number(rule.trigger_site_value) || 0
    let siteMet = false
    switch (rule.trigger_site_op) {
      case '<=': siteMet = fieldVal <= target; break
      case '<':  siteMet = fieldVal < target; break
      case '>=': siteMet = fieldVal >= target; break
      case '>':  siteMet = fieldVal > target; break
      case '==': siteMet = fieldVal === target; break
      case '!=': siteMet = fieldVal !== target; break
      default:   siteMet = false
    }
    return deviceMet && siteMet
  }

  const count = resolveTriggerCount(rule.trigger_code, deviceCounts, siteInfo)

  switch (rule.trigger_condition) {
    case 'greater_than':
      return count > (rule.trigger_value || 0)
    case 'greater_than_or_equal':
      return count >= (rule.trigger_value || 0)
    case 'equals':
      return count === (rule.trigger_value || 0)
    case 'range':
      return count >= (rule.trigger_min || 0) && count <= (rule.trigger_max || Infinity)
    default:
      return count > 0
  }
}

// ── Quantity calculation ──

function calculateQuantity(rule: DependencyRule, deviceCounts: DeviceCounts, siteInfo: SiteInfo = {}): number {
  const triggerCount = resolveTriggerCount(rule.trigger_code, deviceCounts, siteInfo)

  switch (rule.quantity_mode) {
    case 'fixed':
      return rule.quantity_value || 1

    case 'match_trigger':
      return triggerCount

    case 'match_site_field':
      return Number((siteInfo as Record<string, unknown>)[rule.quantity_site_field!]) || 0

    case 'per_n': {
      const n = rule.quantity_value || 1
      return Math.ceil(triggerCount / n)
    }

    case 'ceil_formula': {
      const multiplier = rule.quantity_multiplier || 1
      const divisor = rule.quantity_divisor || 1
      return Math.ceil(triggerCount * multiplier / divisor)
    }

    case 'formula': {
      const tiers = (rule.quantity_formula || '').split(',').map((t) => t.trim())
      for (const tier of tiers) {
        const match = tier.match(/^(<=?|>=?|==?)(\d+):(\d+)$/)
        if (!match) continue
        const [, op, threshold, qty] = match
        const th = parseInt(threshold)
        const q = parseInt(qty)
        if (op === '<=' && triggerCount <= th) return q
        if (op === '<' && triggerCount < th) return q
        if (op === '>=' && triggerCount >= th) return q
        if (op === '>' && triggerCount > th) return q
        if ((op === '=' || op === '==') && triggerCount === th) return q
      }
      return rule.quantity_value || 1
    }

    case 'custom': {
      return calculateCustomQuantity(rule.quantity_custom_key!, deviceCounts, siteInfo)
    }

    default:
      return rule.quantity_value || 1
  }
}

// ── Main evaluation ──

export function evaluateDependencyRules(
  rules: DependencyRule[],
  deviceCounts: DeviceCounts,
  products: Product[],
  siteInfo: SiteInfo = {}
): AutoAddItem[] {
  const autoAddItems: AutoAddItem[] = []

  for (const rule of rules) {
    if (!rule.is_active) continue
    const conditionMet = evaluateCondition(rule, deviceCounts, siteInfo)
    if (!conditionMet) continue

    const qty = calculateQuantity(rule, deviceCounts, siteInfo)
    if (qty <= 0) continue

    // Find the product — try ID first, then SKU fallback, then name fallback
    let product = products.find((p) => p.id === rule.auto_add_product_id)
    if (!product && rule.auto_add_product_sku) {
      product = products.find(
        (p) => p.sku && p.sku.toUpperCase() === rule.auto_add_product_sku!.toUpperCase() && p.is_active !== false
      )
    }
    if (!product && rule.auto_add_product_name) {
      const frag = rule.auto_add_product_name.toLowerCase()
      product = products.find(
        (p) => p.name && p.name.toLowerCase() === frag && p.is_active !== false
      )
    }
    if (!product) continue

    const existing = autoAddItems.find((item) => item.product.id === product!.id)
    if (existing) {
      existing.quantity = Math.max(existing.quantity, qty)
      existing.ruleDescriptions.push(rule.description || rule.id)
    } else {
      autoAddItems.push({
        product,
        quantity: qty,
        ruleId: rule.id,
        ruleDescriptions: [rule.description || rule.id],
      })
    }
  }

  return autoAddItems
}

// ── Convert auto-add items → BOM line items ──

export function autoAddItemsToBOM(autoAddItems: AutoAddItem[]): BOMItem[] {
  return autoAddItems.map((item) => ({
    device_type_code: null,
    device_type_legend: null,
    category: item.product.category || 'Uncategorised',
    product_id: item.product.id,
    product_name: item.product.name,
    sku: item.product.sku || '',
    supplier: item.product.supplier || '',
    quantity: item.quantity,
    cost_price: item.product.cost_price || 0,
    markup: item.product.markup || DEFAULT_MARKUP,
    sell_price:
      item.product.sell_price ||
      item.product.cost_price * (1 + (item.product.markup || DEFAULT_MARKUP)),
    notes: '',
    auto_added: true,
    rule_description: item.ruleDescriptions.join('; '),
  }))
}

// ── Product finder helper ──

function fp(products: Product[], nameFragment: string | null, sku: string | null): Product | undefined {
  if (sku) {
    const bySku = products.find(
      (p) => p.sku && p.sku.toUpperCase() === sku.toUpperCase() && p.is_active !== false
    )
    if (bySku) return bySku
  }
  if (nameFragment) {
    const frag = nameFragment.toLowerCase()
    const byName = products.find(
      (p) => p.name && p.name.toLowerCase().includes(frag) && p.is_active !== false
    )
    if (byName) return byName
  }
  return undefined
}

function pushRule(rules: DependencyRule[], product: Product | undefined, ruleObj: Partial<DependencyRule> & { id: string; description: string }) {
  if (!product) return
  rules.push({
    ...ruleObj,
    auto_add_product_id: product.id,
    auto_add_product_sku: product.sku || null,
    auto_add_product_name: product.name || null,
  } as DependencyRule)
}

// ── Rule ID counter ──

let _ruleIdCounter = 0
function ruleId(): string {
  _ruleIdCounter += 1
  return `snap_rule_${_ruleIdCounter}`
}

// ── Snap Fitness preset rules ──

export function getSnapFitnessRules(products: Product[]): DependencyRule[] {
  _ruleIdCounter = 0
  const rules: DependencyRule[] = []
  const preset = 'snap_fitness'
  const find = (name: string | null, sku: string | null) => fp(products, name, sku)

  // === SECURITY SYSTEM (alarm_panel > 0) ===
  const securityTrigger = {
    trigger_code: 'alarm_panel',
    trigger_condition: 'greater_than',
    trigger_value: 0,
    preset,
    is_active: true,
  }

  pushRule(rules, find('Solution 6000', 'K6000NODET'), { ...securityTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 1, description: 'Bosch Solution 6000 alarm kit' })
  pushRule(rules, find('MW730B', 'MW730B'), { ...securityTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 1, description: 'Metal enclosure for alarm panel' })
  pushRule(rules, find('LARGE Connector Board', 'CFLGE2022'), { ...securityTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 1, description: 'CentreFit large connector board for alarm panel' })
  pushRule(rules, find('CM710B', 'CM710B'), { ...securityTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 1, description: 'Output expansion module for alarm panel' })
  pushRule(rules, find('MY368AU', 'MY368AU'), { ...securityTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 1, description: '4G modem for alarm panel (1x)' })
  pushRule(rules, find('CM444B', 'CM444B'), { ...securityTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 3, description: '2 amp relay modules for alarm (3x)' })
  pushRule(rules, find('5 Port', 'ANDDEAR-DG9'), { ...securityTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 1, description: '5 port switch for alarm comms' })
  pushRule(rules, find('Reporting Lite Plus - SIM', null), { ...securityTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 1, description: 'MyAlarm monitoring subscription' })
  pushRule(rules, find('ETHM-A', 'S-COM-ETHM-A'), { ...securityTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 1, description: 'Ethernet relay module for alarm comms' })
  pushRule(rules, find('Finder Relay', 'FID55.32.007412VDC'), { ...securityTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 2, description: 'Finder relay for alarm automation (2x)' })
  pushRule(rules, find('Relay Mount', 'FID9402'), { ...securityTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 2, description: 'Finder relay mount socket (2x)' })
  pushRule(rules, find('Power Adaptor', 'MP3560'), { ...securityTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 1, description: 'Power adaptor for alarm system' })
  pushRule(rules, find('Mounting Tape', 'SCOTCH-TAPE-25'), { ...securityTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 1, description: 'Scotch mounting tape for alarm panel' })
  pushRule(rules, find('Crimp Ferrule', 'RS-FERRULE-20AWG'), { ...securityTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 3, description: 'Crimp ferrules 20AWG for alarm wiring (3x)' })

  // === PIR ZONE EXPANSION ===
  const pirTrigger = 'pir_360_roof + pir_wall'
  const zoneExp = find('CM704B', 'CM704B')
  const smallConn = find('SMALL', 'CFSML2022')
  const mw350 = find('MW350', 'MW350')

  pushRule(rules, zoneExp, { id: ruleId(), trigger_code: pirTrigger, trigger_condition: 'range', trigger_min: 1, trigger_max: 12, quantity_mode: 'fixed', quantity_value: 1, description: 'Zone expansion (1x) for 1-12 PIRs', preset, is_active: true })
  pushRule(rules, zoneExp, { id: ruleId(), trigger_code: pirTrigger, trigger_condition: 'range', trigger_min: 13, trigger_max: 20, quantity_mode: 'fixed', quantity_value: 2, description: 'Zone expansion (2x) for 13-20 PIRs', preset, is_active: true })
  pushRule(rules, smallConn, { id: ruleId(), trigger_code: pirTrigger, trigger_condition: 'range', trigger_min: 13, trigger_max: 20, quantity_mode: 'fixed', quantity_value: 1, description: 'Small connector board for 13-20 PIRs', preset, is_active: true })
  pushRule(rules, zoneExp, { id: ruleId(), trigger_code: pirTrigger, trigger_condition: 'range', trigger_min: 21, trigger_max: 28, quantity_mode: 'fixed', quantity_value: 3, description: 'Zone expansion (3x) for 21-28 PIRs', preset, is_active: true })
  pushRule(rules, smallConn, { id: ruleId(), trigger_code: pirTrigger, trigger_condition: 'range', trigger_min: 21, trigger_max: 28, quantity_mode: 'fixed', quantity_value: 2, description: 'Small connector board (2x) for 21-28 PIRs', preset, is_active: true })
  pushRule(rules, zoneExp, { id: ruleId(), trigger_code: pirTrigger, trigger_condition: 'range', trigger_min: 29, trigger_max: 36, quantity_mode: 'fixed', quantity_value: 4, description: 'Zone expansion (4x) for 29-36 PIRs', preset, is_active: true })
  pushRule(rules, smallConn, { id: ruleId(), trigger_code: pirTrigger, trigger_condition: 'range', trigger_min: 29, trigger_max: 36, quantity_mode: 'fixed', quantity_value: 3, description: 'Small connector board (3x) for 29-36 PIRs', preset, is_active: true })
  pushRule(rules, mw350, { id: ruleId(), trigger_code: pirTrigger, trigger_condition: 'range', trigger_min: 29, trigger_max: 36, quantity_mode: 'fixed', quantity_value: 1, description: 'MW350 additional enclosure for 29-36 PIRs', preset, is_active: true })

  // === PENDANT RULES ===
  const pendant = find('Duress Single Button Pendant', 'RFPB-SB')
  pushRule(rules, pendant, { id: ruleId(), trigger_code: 'rf_receiver', trigger_condition: 'compound', trigger_value: 0, trigger_site_field: 'site_sqm', trigger_site_op: '<=', trigger_site_value: 400, quantity_mode: 'fixed', quantity_value: 3, description: 'Duress pendants (3x) for sites ≤ 400 sqm', preset, is_active: true })
  pushRule(rules, pendant, { id: ruleId(), trigger_code: 'rf_receiver', trigger_condition: 'compound', trigger_value: 0, trigger_site_field: 'site_sqm', trigger_site_op: '>', trigger_site_value: 400, quantity_mode: 'fixed', quantity_value: 5, description: 'Duress pendants (5x) for sites > 400 sqm', preset, is_active: true })

  // === DURESS ===
  pushRule(rules, find('Duress Faceplate', 'WEL2210R-DURE'), { id: ruleId(), trigger_code: 'duress_button', trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'match_trigger', description: 'Duress faceplate per duress button', preset, is_active: true })
  pushRule(rules, find('ECA2010', 'ECA2010'), { id: ruleId(), trigger_code: 'duress_intercom', trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'match_trigger', description: 'GSM intercom unit per duress intercom point', preset, is_active: true })
  pushRule(rules, find('OPTUS Mobile SIM', null), { id: ruleId(), trigger_code: 'duress_intercom', trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'match_trigger', description: 'OPTUS SIM per duress intercom', preset, is_active: true })

  // === SECURITY CABLE ===
  const totalSecurityCode = 'pir_360_roof + pir_wall + reed_switch + alarm_panel + door_lock + duress_button + duress_intercom + light_siren + rf_receiver'
  const secCableTrigger = { trigger_code: totalSecurityCode, trigger_condition: 'greater_than', trigger_value: 0, preset, is_active: true }

  pushRule(rules, find('6 Core Security Cable', 'EC6C14020300B'), { ...secCableTrigger, id: ruleId(), quantity_mode: 'ceil_formula', quantity_multiplier: 45, quantity_divisor: 300, description: '6-core security cable — CEIL(total_security_devices × 45m / 300m rolls)' })
  pushRule(rules, find('4 Way Plug', 'EC381V-04P'), { ...secCableTrigger, id: ruleId(), quantity_mode: 'custom', quantity_custom_key: 'security_4w_plugs', description: '4-way security plugs — door_count + PIR_count + 2' })
  pushRule(rules, find('3 Way Plug', 'EC381V-03P'), { ...secCableTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 2, description: '3-way security plugs (2x fixed)' })
  pushRule(rules, find('2 Way Plug', 'EC381V-02P'), { ...secCableTrigger, id: ruleId(), quantity_mode: 'custom', quantity_custom_key: 'security_2w_plugs', description: '2-way security plugs — door_count + 6' })
  pushRule(rules, find('6 Way Plug', 'EC381V-06P'), { ...secCableTrigger, id: ruleId(), quantity_mode: 'custom', quantity_custom_key: 'security_6w_plugs', description: '6-way security plugs — matches door_count' })

  // === CAMERAS ===
  const cameraTrigger = 'camera_black + camera_white'
  const nvr16 = find('16CH NVR', 'NVR4216-16P-A') || find('16CH', null)

  pushRule(rules, nvr16, { id: ruleId(), trigger_code: cameraTrigger, trigger_condition: 'range', trigger_min: 1, trigger_max: 16, quantity_mode: 'fixed', quantity_value: 1, description: '16-channel NVR for 1-16 cameras', preset, is_active: true })
  pushRule(rules, find('32CH NVR', 'DHU10568'), { id: ruleId(), trigger_code: cameraTrigger, trigger_condition: 'range', trigger_min: 17, trigger_max: 32, quantity_mode: 'fixed', quantity_value: 1, description: '32-channel NVR for 17-32 cameras', preset, is_active: true })
  pushRule(rules, find('64CH NVR', 'DHU6276'), { id: ruleId(), trigger_code: cameraTrigger, trigger_condition: 'range', trigger_min: 33, trigger_max: 64, quantity_mode: 'fixed', quantity_value: 1, description: '64-channel NVR for 33-64 cameras', preset, is_active: true })
  pushRule(rules, find('FHD LED Monitor', 'DHI-LM22-H200'), { id: ruleId(), trigger_code: cameraTrigger, trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'fixed', quantity_value: 1, description: 'Monitoring display for NVR', preset, is_active: true })
  pushRule(rules, find('6TB Surveillance HDD', 'WD60PURX'), { id: ruleId(), trigger_code: cameraTrigger, trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'ceil_formula', quantity_multiplier: 1, quantity_divisor: 6, description: 'HDDs — CEIL(camera_count / 6)', preset, is_active: true })
  pushRule(rules, find('Wall Mount', 'PFB204W'), { id: ruleId(), trigger_code: 'external_camera_count', trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'match_trigger', description: 'Wall mount bracket per external camera', preset, is_active: true })
  pushRule(rules, find('Roof Mount Black', 'DH-PFA139-B'), { id: ruleId(), trigger_code: 'concrete_mount_black', trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'match_trigger', description: 'Concrete roof mount (black) per specified location', preset, is_active: true })
  pushRule(rules, find('Roof Mount', 'PFA-139'), { id: ruleId(), trigger_code: 'concrete_mount_white', trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'match_trigger', description: 'Concrete roof mount (white) per specified location', preset, is_active: true })

  // === CAMERA CABLE ===
  const totalCameraCode = 'camera_black + camera_white + tailgate_system'
  pushRule(rules, find('Cat6 UTP Cable 305m', 'ECC6UB305B'), { id: ruleId(), trigger_code: totalCameraCode, trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'ceil_formula', quantity_multiplier: 50, quantity_divisor: 305, description: 'Cat6 cable for cameras — CEIL(total_camera_devices × 50m / 305m boxes)', preset, is_active: true })

  // === ACCESS CONTROL ===
  pushRule(rules, find('Door Loop', 'SECDWM300'), { id: ruleId(), trigger_code: 'door_lock', trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'match_trigger', description: 'Door loop with box ends per door strike', preset, is_active: true })
  pushRule(rules, find('Striker', 'FSHFES20'), { id: ruleId(), trigger_code: 'door_lock', trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'match_trigger', description: 'FES20 electric striker per door lock', preset, is_active: true })
  pushRule(rules, find('REX', 'WEL1911'), { id: ruleId(), trigger_code: 'door_lock', trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'fixed', quantity_value: 1, description: 'REX button (1x) when door locks present', preset, is_active: true })

  // === AUDIO ===
  const speakerTrigger = 'speaker_roof_black + speaker_roof_white + speaker_wall_black + speaker_wall_white'
  pushRule(rules, find('Mixer-Amplifier 240W', 'PRM240'), { id: ruleId(), trigger_code: speakerTrigger, trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'fixed', quantity_value: 1, description: '240W amplifier for speakers', preset, is_active: true })

  // 120W amp — compound: speakers > 0 AND separate_studio_zone
  pushRule(rules, find('Mixer-Amplifier 120W', 'PRM120'), { id: ruleId(), trigger_code: speakerTrigger, trigger_condition: 'compound', trigger_value: 0, trigger_site_field: 'separate_studio_zone', trigger_site_op: '>=', trigger_site_value: 1, quantity_mode: 'fixed', quantity_value: 1, description: '120W amplifier for separate studio zone', preset, is_active: true })

  pushRule(rules, find('Speaker Cable', 'ESC-2C16AWG'), { id: ruleId(), trigger_code: speakerTrigger, trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'ceil_formula', quantity_multiplier: 20, quantity_divisor: 100, description: 'Speaker cable — CEIL(speakers × 20m / 100m rolls)', preset, is_active: true })

  // === AV SYSTEM (always on every Snap Fitness job) ===
  const avAlways = { trigger_code: null, trigger_condition: 'always', preset, is_active: true }

  pushRule(rules, find('Modulator', 'EPS-HDM1001M4'), { ...avAlways, id: ruleId(), quantity_mode: 'fixed', quantity_value: 2, description: 'HDMI modulators (2x) for AV distribution' })
  pushRule(rules, find('3 Way Splitter', 'KSP3F'), { ...avAlways, id: ruleId(), quantity_mode: 'fixed', quantity_value: 1, description: '3-way splitter for AV distribution' })
  pushRule(rules, find('DA44', 'DA44'), { ...avAlways, id: ruleId(), quantity_mode: 'fixed', quantity_value: 1, description: 'DA44 amplifier for AV distribution' })
  pushRule(rules, find('PSK18M', 'PSK18M'), { ...avAlways, id: ruleId(), quantity_mode: 'fixed', quantity_value: 1, description: 'Kingray 18V power supply for DA44 amplifier' })
  pushRule(rules, find('18VDC', '18VDC1600F'), { ...avAlways, id: ruleId(), quantity_mode: 'fixed', quantity_value: 1, description: '18VDC 1.6A power supply for active tap' })
  pushRule(rules, find('COMP CRIMP', 'APFTRSF6L'), { ...avAlways, id: ruleId(), quantity_mode: 'custom', quantity_custom_key: 'av_rg6_crimps', description: 'F-type crimp connectors — CEIL((cardio + TVs) / 50), min 1' })
  pushRule(rules, find('Attenuator', 'ATF20PP'), { ...avAlways, id: ruleId(), quantity_mode: 'fixed', quantity_value: 4, description: 'Attenuator 20db (4x standard)' })
  pushRule(rules, find('Attenuator 10db', 'ATF10PP'), { ...avAlways, id: ruleId(), quantity_mode: 'fixed', quantity_value: 2, description: 'Attenuator 10db (2x standard)' })

  // RG6 cable — only if coax points on plan
  pushRule(rules, find('305 M RG6', 'EC6QS305B'), { trigger_code: 'coax_point', trigger_condition: 'greater_than', trigger_value: 0, preset, is_active: true, id: ruleId(), quantity_mode: 'fixed', quantity_value: 1, description: '305m RG6 coaxial cable — only if RG6 points on plan' })

  // Variable AV items
  pushRule(rules, find('8 way Coaxial Splitter', 'DSU8'), { ...avAlways, id: ruleId(), quantity_mode: 'custom', quantity_custom_key: 'av_8way_splitter', description: '8-way splitter — CEIL((cardio + TVs) / 8)' })
  pushRule(rules, find('8 Port Active Tap', 'KAT8F'), { ...avAlways, id: ruleId(), quantity_mode: 'custom', quantity_custom_key: 'av_active_tap', description: '8-port active tap — needed when TV/cardio count > 8' })
  pushRule(rules, find('PAL Male', 'EADT-FFPM'), { ...avAlways, id: ruleId(), quantity_mode: 'custom', quantity_custom_key: 'av_pal_adapters', description: 'PAL adapter per TV + cardio connection' })
  pushRule(rules, find('1.5M Coaxial', 'WV7386'), { ...avAlways, id: ruleId(), quantity_mode: 'custom', quantity_custom_key: 'av_fly_leads', description: 'Coax fly lead per TV' })

  // TV Mounts
  pushRule(rules, find('Articulated Wall Mount', 'TIXX-AR500'), { ...avAlways, id: ruleId(), quantity_mode: 'custom', quantity_custom_key: 'av_wall_tv_mounts', description: 'Articulated wall mount per wall TV' })
  pushRule(rules, find('Ceiling Mount', 'TIXX-CM600'), { ...avAlways, id: ruleId(), quantity_mode: 'custom', quantity_custom_key: 'av_ceiling_tv_mounts', description: 'Ceiling mount per ceiling TV' })

  // Nightlife
  pushRule(rules, find('Nightlife Server', null), { id: ruleId(), trigger_code: null, trigger_condition: 'always', quantity_mode: 'fixed', quantity_value: 1, description: 'Nightlife Server — supplied by Nightlife ($0 cost, must be on BOM)', preset, is_active: true })
  pushRule(rules, find('Nightlife 24" Kiosk', null), { id: ruleId(), trigger_code: null, trigger_condition: 'always', quantity_mode: 'fixed', quantity_value: 1, description: 'Nightlife Kiosk — supplied by Nightlife ($0 cost, must be on BOM)', preset, is_active: true })

  // === DATA ===
  pushRule(rules, find('Router', 'DSL-X3052E'), { id: ruleId(), trigger_code: null, trigger_condition: 'always', quantity_mode: 'fixed', quantity_value: 1, description: 'D-Link router — required on EVERY job', preset, is_active: true })
  pushRule(rules, find('DGS-1210-52MP', 'DGS-1210-52MP'), { id: ruleId(), trigger_code: null, trigger_condition: 'always', quantity_mode: 'fixed', quantity_value: 1, description: 'DGS-1210-52MP PoE switch — required on EVERY job', preset, is_active: true })
  pushRule(rules, find('Nuclias Hub', 'DNH-100'), { id: ruleId(), trigger_code: 'wap', trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'fixed', quantity_value: 1, description: 'Nuclias hub for WAP management', preset, is_active: true })

  // === CABINET ACCESSORIES ===
  const cabinetTrigger = { trigger_code: 'cabinet_9ru + cabinet_27ru + cabinet_32ru + cabinet_42ru', trigger_condition: 'greater_than', trigger_value: 0, preset, is_active: true }

  pushRule(rules, find('Pass-through 24', 'EPP24KS'), { ...cabinetTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 2, description: '24-port pass-through patch panels (2x)' })
  pushRule(rules, find('Cable Management', 'ECM-1RUDS15'), { ...cabinetTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 3, description: '1RU cable management (3x)' })
  pushRule(rules, find('Power Board', 'EPRPBH8'), { ...cabinetTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 2, description: 'Rack power boards (2x)' })
  pushRule(rules, find('UPS', 'PSD2000'), { ...cabinetTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 1, description: 'UPS for server cabinet' })
  pushRule(rules, find('Shelf', 'EPR-FS600'), { ...cabinetTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 1, description: 'Cantilever shelf for cabinet' })
  pushRule(rules, find('250mm', 'ECPLS-C6B0.25'), { ...cabinetTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 48, description: '250mm Cat6 patch leads (48x)' })
  pushRule(rules, find('500mm', 'ECPLS-C6B0.5'), { ...cabinetTrigger, id: ruleId(), quantity_mode: 'custom', quantity_custom_key: 'cabinet_500mm_patch_leads', description: '500mm Cat6 patch leads — base 2 + CEIL(card_reader / 2)' })
  pushRule(rules, find('Snap Plug', 'EMP-CAT6UTPST'), { ...cabinetTrigger, id: ruleId(), quantity_mode: 'fixed', quantity_value: 1, description: 'Cat6 snap-in plugs (1 pack)' })

  // Clipsal mounting brackets
  const bracketTriggerCode = 'pir_360_roof + pir_wall + speaker_roof_black + speaker_roof_white + speaker_wall_black + speaker_wall_white + camera_black + camera_white + duress_button + wap + duress_intercom + rf_receiver'
  pushRule(rules, find('Mounting Bracket', 'CLI155N'), { id: ruleId(), trigger_code: bracketTriggerCode, trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'match_trigger', description: 'Clipsal mounting brackets — 1 per PIR, speaker, camera, duress, WAP, RF receiver', preset, is_active: true })

  // Bosch PIR wall brackets — sold in packs of 3. CEIL(pir_wall / 3)
  pushRule(rules, find('PIR Wall Mounts Pack of 3', 'B335-3'), { id: ruleId(), trigger_code: 'pir_wall', trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'ceil_formula', quantity_multiplier: 1, quantity_divisor: 3, description: 'PIR wall brackets — CEIL(pir_wall / 3) packs of 3', preset, is_active: true })

  // === DATA CABLE ===
  const totalDataCode = 'camera_black + camera_white + tailgate_system + wap + data_point'
  pushRule(rules, find('Cat6 UTP Cable 305m', 'ECC6UB305B'), { id: ruleId(), trigger_code: totalDataCode, trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'ceil_formula', quantity_multiplier: 50, quantity_divisor: 305, description: 'Cat6 cable for all data devices — CEIL(total_data_devices × 50m / 305m boxes)', preset, is_active: true })

  return rules
}

// ── Basic rules (Total Fusion / 9Rounds) ──

export function getBasicRules(products: Product[]): DependencyRule[] {
  _ruleIdCounter = 0
  const rules: DependencyRule[] = []
  const preset = 'basic'
  const find = (name: string | null, sku: string | null) => fp(products, name, sku)

  const cameraTrigger = 'camera_black + camera_white'
  const nvr16 = find('16CH NVR', 'NVR4216-16P-A') || find('16CH', null)

  pushRule(rules, nvr16, { id: ruleId(), trigger_code: cameraTrigger, trigger_condition: 'range', trigger_min: 1, trigger_max: 16, quantity_mode: 'fixed', quantity_value: 1, description: '16-channel NVR for 1-16 cameras', preset, is_active: true })
  pushRule(rules, find('32CH NVR', 'DHU10568'), { id: ruleId(), trigger_code: cameraTrigger, trigger_condition: 'range', trigger_min: 17, trigger_max: 32, quantity_mode: 'fixed', quantity_value: 1, description: '32-channel NVR for 17-32 cameras', preset, is_active: true })
  pushRule(rules, find('64CH NVR', 'DHU6276'), { id: ruleId(), trigger_code: cameraTrigger, trigger_condition: 'range', trigger_min: 33, trigger_max: 64, quantity_mode: 'fixed', quantity_value: 1, description: '64-channel NVR for 33-64 cameras', preset, is_active: true })
  pushRule(rules, find('FHD LED Monitor', 'DHI-LM22-H200'), { id: ruleId(), trigger_code: cameraTrigger, trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'fixed', quantity_value: 1, description: 'Monitoring display for NVR', preset, is_active: true })
  pushRule(rules, find('6TB Surveillance HDD', 'WD60PURX'), { id: ruleId(), trigger_code: cameraTrigger, trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'ceil_formula', quantity_multiplier: 1, quantity_divisor: 6, description: 'HDDs — CEIL(camera_count / 6)', preset, is_active: true })

  const totalCameraCode = 'camera_black + camera_white + tailgate_system'
  pushRule(rules, find('Cat6 UTP Cable 305m', 'ECC6UB305B'), { id: ruleId(), trigger_code: totalCameraCode, trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'ceil_formula', quantity_multiplier: 50, quantity_divisor: 305, description: 'Cat6 cable for cameras — CEIL(total × 50m / 305m boxes)', preset, is_active: true })

  const totalDataCode = 'camera_black + camera_white + tailgate_system + wap + data_point'
  pushRule(rules, find('Cat6 UTP Cable 305m', 'ECC6UB305B'), { id: ruleId(), trigger_code: totalDataCode, trigger_condition: 'greater_than', trigger_value: 0, quantity_mode: 'ceil_formula', quantity_multiplier: 50, quantity_divisor: 305, description: 'Cat6 cable for all data devices — CEIL(total × 50m / 305m boxes)', preset, is_active: true })

  return rules
}

export const getDefaultDependencyRules = getSnapFitnessRules
