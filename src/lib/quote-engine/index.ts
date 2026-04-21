// Centrefit Quote Engine — Public API

// Constants & types
export {
  DEVICE_TYPES,
  PRODUCT_CATEGORIES,
  DEFAULT_EXTRAS,
  LABOUR_COST_RATE,
  LABOUR_SELL_RATE,
  GST_RATE,
  DEFAULT_MARKUP,
} from './constants'
export type {
  DeviceType,
  ExtraItem,
  DeviceCounts,
  SiteInfo,
} from './constants'

// Labour engine
export {
  calculateLabour,
  recalcLabour,
  checkMandatoryLabour,
} from './labour-engine'
export type {
  LabourItem,
  FixedCost,
  LabourSection,
  LabourData,
  RateOverrides,
  LabourTimingOverrides,
  ElecOptions,
} from './labour-engine'

// BOM engine
export {
  generateBOM,
  updateBOMProduct,
  calculateBOMTotals,
} from './bom-engine'
export type {
  Product,
  BOMItem,
  BOMTotals,
} from './bom-engine'

// Dependency engine
export {
  evaluateDependencyRules,
  autoAddItemsToBOM,
  getSnapFitnessRules,
  getBasicRules,
  getDefaultDependencyRules,
} from './dependency-engine'
export type {
  DependencyRule,
  AutoAddItem,
} from './dependency-engine'

// Pricing
export { calculateQuoteSummary } from './pricing'
export type { QuoteSummary } from './pricing'

// Scope of Works
export { generateScopeOfWorks } from './scope-of-works'
export type {
  ScopeItem,
  ScopeNote,
  ScopeSection,
  ScopeDocument,
  ScopeOverrides,
  ScopeOverrideMap,
} from './scope-of-works'
