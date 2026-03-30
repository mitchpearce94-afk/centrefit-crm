// ============================================================================
// Centrefit Quote Engine — Constants
// Ported from original JS quote engine. DO NOT modify formulas or values.
// ============================================================================

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface DeviceType {
  code: string;
  legend: string;
  cable: 'cat6' | '6core_security' | 'speaker_cable' | 'coax' | 'n-a';
  category: string;
}

export interface ExtraItem {
  category: string;
  description: string;
  cost: number;
  sell: number;
}

/** Maps device type codes to their counts */
export type DeviceCounts = Record<string, number>;

export interface SiteInfo {
  site_sqm?: number;
  door_count?: number;
  external_camera_count?: number;
  concrete_mount_black?: number;
  concrete_mount_white?: number;
  cardio_count?: number;
  tv_count?: number;
  ceiling_tv_count?: number;
  wall_tv_mount_count?: number;
  ceiling_tv_mount_count?: number;
  separate_studio_zone?: boolean;
}

// ---------------------------------------------------------------------------
// Device Types (21 items)
// ---------------------------------------------------------------------------

export const DEVICE_TYPES: DeviceType[] = [
  // Security System (10) — tall card, column 1
  { code: 'tailgate_system', legend: 'FelixGate Tailgating System', cable: 'cat6', category: 'Security System' },
  { code: 'alarm_panel', legend: 'Alarm Panel', cable: '6core_security', category: 'Security System' },
  { code: 'pir_360_roof', legend: 'Movement Sensors 360 Roof', cable: '6core_security', category: 'Security System' },
  { code: 'pir_wall', legend: 'Movement Sensors PIR Wall', cable: '6core_security', category: 'Security System' },
  { code: 'reed_switch', legend: 'Reed Switch', cable: '6core_security', category: 'Security System' },
  { code: 'rf_receiver', legend: 'RF Receiver', cable: 'cat6', category: 'Security System' },
  { code: 'door_lock', legend: 'Door Lock - Striker / Mag', cable: '6core_security', category: 'Security System' },
  { code: 'rex_button', legend: 'REX Request to Exit', cable: '6core_security', category: 'Security System' },
  { code: 'duress_button', legend: 'Duress Button', cable: '6core_security', category: 'Security System' },
  { code: 'duress_intercom', legend: 'Duress Intercom', cable: '6core_security', category: 'Security System' },
  { code: 'light_siren', legend: 'External Light and Siren', cable: '6core_security', category: 'Security System' },
  // Digital Surveillance (2) — short card, column 2 top
  { code: 'camera_black', legend: 'Black Digital Surveillance Camera', cable: 'cat6', category: 'Digital Surveillance' },
  { code: 'camera_white', legend: 'White Digital Surveillance Camera', cable: 'cat6', category: 'Digital Surveillance' },
  // Data System (2) — column 2
  { code: 'wap', legend: 'Wi-Fi Access Point', cable: 'cat6', category: 'Data System' },
  { code: 'data_point', legend: 'Cat 6 Ethernet - DATA', cable: 'cat6', category: 'Data System' },
  // Audio System (2) — column 2
  { code: 'speaker_roof', legend: 'Speaker Roof Mount', cable: 'speaker_cable', category: 'Audio System' },
  { code: 'speaker_wall', legend: 'Speaker Wall Mount', cable: 'speaker_cable', category: 'Audio System' },
  // Infrastructure (4) — column 2
  { code: 'cabinet_9ru', legend: 'Server Cabinet 9RU', cable: 'n-a', category: 'Infrastructure' },
  { code: 'cabinet_27ru', legend: 'Server Cabinet 27RU', cable: 'n-a', category: 'Infrastructure' },
  { code: 'cabinet_32ru', legend: 'Server Cabinet 32RU', cable: 'n-a', category: 'Infrastructure' },
  { code: 'cabinet_42ru', legend: 'Server Cabinet 42RU', cable: 'n-a', category: 'Infrastructure' },
];

// ---------------------------------------------------------------------------
// Product Categories
// ---------------------------------------------------------------------------

export const PRODUCT_CATEGORIES: string[] = [
  'Digital Surveillance',
  'Security System',
  'Access Control',
  'Audio System',
  'Data System',
  'AV System',
  'Infrastructure',
];

// ---------------------------------------------------------------------------
// Default Extras
// ---------------------------------------------------------------------------

export const DEFAULT_EXTRAS: ExtraItem[] = [
  { category: 'Freight', description: 'Freight', cost: 0, sell: 0 },
  { category: 'Travel', description: 'Flights', cost: 0, sell: 0 },
  { category: 'Travel', description: 'Accommodation', cost: 0, sell: 0 },
  { category: 'Travel', description: 'Car Hire', cost: 0, sell: 0 },
  { category: 'Sundries', description: 'Ladder Hire', cost: 0, sell: 0 },
  { category: 'Travel', description: 'Going Away Allowance', cost: 0, sell: 0 },
  { category: 'Electrician', description: 'Electrician Quotation', cost: 0, sell: 0 },
];

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

export const LABOUR_COST_RATE = 75;
export const LABOUR_SELL_RATE = 150;
export const GST_RATE = 0.10;
export const DEFAULT_MARKUP = 0.50;
