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
  BomLabourLine,
  LabourTimingMeta,
  LabourTimingsMap,
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
  isElecSupplied,
  getSnapFitnessRules,
  getBasicRules,
  getPlanetFitnessRules,
  getDefaultDependencyRules,
} from './dependency-engine'
export type {
  DependencyRule,
  AutoAddItem,
  ElecMaterialOptions,
} from './dependency-engine'

// Pricing
export { calculateQuoteSummary } from './pricing'
export type { QuoteSummary } from './pricing'

// Scope of Works (BOM-driven, system-card layout)
export {
  generateScopeOfWorks,
  manualScopeDocument,
  renderScopeAsHtml,
  renderScopeAsText,
  parseScopeItem,
  SCOPE_ROLE_SYSTEM,
  BOMRollup,
} from './scope-of-works'
export type {
  ScopeDocument,
  ScopeSystemBlock,
  ScopeByOthersBlock,
  ScopeOngoingCost,
  ScopeSummary,
  ScopeOverrides,
  ScopePriceBreakdownLine,
  BOMLineForScope,
  ProductForScope,
} from './scope-of-works'

// Quoting v2 (2026-09-23): kits, device types as data, lint
export { expandKits, mergeKitLines, applyTemplateSupply, hddPack, evalKitFormula } from './kits'
export type { KitComponent, DeviceTypeRow, TemplateSupply, KitAnswers, KitDiagnostic } from './kits'
export { lintQuote, blockingFindings, findingKey } from './lint'
export type { LintFinding, LintInput, LintSeverity } from './lint'
export type { BOMv2Options } from './bom-engine'
