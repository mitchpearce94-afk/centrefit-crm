export type DeviceCategory = 'cameras' | 'security' | 'audio' | 'data' | 'av' | 'power';
export type CableType = 'cat6' | 'sixcore' | 'speaker' | 'none';
/** Editor view / export page. 'power' = GPOs + on-plan notes only (the sparky's sheet). */
export type PlanView = 'master' | 'cat6' | 'sixcore' | 'speaker' | 'power';

export type SymbolType =
  | 'labeled-circle'
  | 'dot-circle'
  | 'triangle-filled'
  | 'triangle-open'
  | 'open-circle'
  | 'gold-circle'
  | 'wifi'
  | 'grid'
  | 'speaker-circle'
  | 'speaker-gear'
  | 'speaker-wall-outline'
  | 'speaker-wall-filled'
  | 'wifi-circle'
  | 'arrows-square'
  | 'x-square'
  | 'comms-rack'
  | 'radar-circle'
  | 'camera-circle'
  | 'outline-square'
  | 'duress-circle'
  | 'labeled-square'
  | 'intercom-grid'
  | 'circle-arrow'
  | 'flag'
  | 'volume-control';

export interface DeviceDefinition {
  id: string;
  name: string;
  category: DeviceCategory;
  cableType: CableType;
  symbolType: SymbolType;
  fillColor?: string;
  strokeColor?: string;
  label?: string;
  isCommsRack?: boolean;
  isVolumeControl?: boolean;
  symbolImage?: string;
  symbolScale?: number;
}

export interface PlacedDevice {
  instanceId: string;
  deviceId: string;
  x: number;
  y: number;
  rotation: number;
  labelNum: number;
  speakerZone?: number;
  concreteMounted?: boolean;
  provisional?: boolean;
  /**
   * Drawn on the plan for the electrician but NOT in Centrefit's scope —
   * e.g. data/coax to cardio machines and TVs when the sparky (Dane) has
   * quoted those runs. Skipped by the quote export and the install
   * checklist; still exported on every PDF page.
   */
  byOthers?: boolean;
  cabled?: boolean;
  /** Mag locks only: mounted on a glass door (armature plate instead of mounting plate). */
  glassDoor?: boolean;
  /**
   * For data outlets (Cat6 / RG6): how many physical points at this
   * marker. Rendered as a small ×N badge so the electrician knows how
   * many drops to terminate. Undefined or 1 = no badge.
   */
  dataCount?: number;
  /**
   * Short on-plan tag ("UB", "CL", "TV", "15A") drawn on the FACING side of
   * the symbol — opposite the D/C/P number. For the little notes the
   * sparky reads at the marker; longer explanations go in a Callout.
   */
  tag?: string;
  /**
   * Speaker-cable devices only: pin this device to a position in the
   * zone's cable run (1 = first after the rack). Unset = automatic chain.
   */
  runOrder?: number;
}

/**
 * Free-floating note box with a leader arrow, drawn on the plan itself
 * (Mitchell 16 Nov 2026: "arrows and text boxes actually on the plan"
 * instead of the NOTES panel). Canvas coordinates. The arrow either
 * follows a device (targetInstanceId) or points at a free point (tx, ty).
 */
export interface Callout {
  id: string;
  text: string;
  /** Top-left of the box, canvas space. */
  x: number;
  y: number;
  /** Box width in canvas units (text wraps). */
  width: number;
  targetInstanceId?: string | null;
  tx?: number;
  ty?: number;
}

export interface CableRun {
  id: string;
  deviceInstanceId: string;
  runNumber: number;
  cableType: CableType;
}

export interface TitleBlockInfo {
  client: string;
  projectName: string;
  worksAddress: string;
  state: string;
  drawingNumber: string;
  revision: string;
  date: string;
  notes: string;
}

export interface LayerVisibility {
  master: boolean;
  cat6: boolean;
  sixcore: boolean;
  speaker: boolean;
}

export type ActiveTool = 'select' | 'place' | 'pan' | 'erase' | 'crop' | 'elementSelect' | 'moveBackground';

/**
 * Exact ink geometry for a path element — lets hit-testing and highlights use
 * the browser's native isPointInStroke/isPointInPath against the real shape
 * instead of an axis-aligned bbox (a diagonal line's bbox is mostly empty
 * space, which is why bbox-only selection felt random).
 */
export interface PdfElementGeometry {
  /** Packed pdf.js DrawOPS stream (moveTo=0,lineTo=1,curveTo=2,quad=3,close=4) in path space. */
  drawOps: number[];
  /** Path space → canvas device px (viewport transform composed with the CTM at execution). */
  ctm: [number, number, number, number, number, number];
  /** Stroke width in path-space units (0 if fill-only). */
  lineWidth: number;
  strokes: boolean;
  fills: boolean;
  /** Style fingerprint (stroke colour | fill colour | line width) for select-similar. */
  styleKey: string;
}

export interface PdfElement {
  id: string;
  type: 'text' | 'path' | 'image' | 'group';
  label: string;
  opIndices: number[];
  bbox: { x: number; y: number; width: number; height: number };
  /** Present on path leaves — enables ink-accurate hit testing. */
  geometry?: PdfElementGeometry;
  /** Present on groups (PDF form XObjects + clustered CAD symbols). */
  children?: PdfElement[];
}

export type NumberedDeviceGroup = 'cameras' | 'pir' | 'speakers' | 'data' | 'coax' | 'access_points' | 'power';

export const NUMBERED_GROUPS: Record<NumberedDeviceGroup, string[]> = {
  cameras: ['cam-black', 'cam-white'],
  pir: ['pir-wall', 'pir-ceiling'],
  speakers: ['speaker-roof', 'speaker-roof-gear', 'speaker-wall', 'speaker-wall-filled'],
  // Data outlets are numbered in PLACEMENT order (not left-to-right) so
  // cable labels match the installation sequence the electrician
  // physically runs them in.
  data: ['cat6-data'],
  // Coax has its own sequence (C1, C2…) — Mitchell 16 Nov 2026: coax was
  // tabbing up in the D-sequence with the data points; they're separate
  // cable runs and need separate labels. Stacks via dataCount like data.
  coax: ['rg6-coax'],
  // WiFi APs get their own number space (AP1, AP2…) — also chronological,
  // same rationale as data: they're Cat6 drops the electrician needs to
  // label as they run them.
  access_points: ['wifi-ap'],
  // GPOs (power plan). Numbered P1, P2… in placement order so the plan
  // notes can say "P3 — 15 A dedicated, comms rack" and the sparky can
  // match note to marker. Power is by the electrical contractor, not
  // Centrefit — no cable run, no quote line, no install checklist row.
  power: ['gpo-double', 'gpo-single'],
};

export interface WhitewashRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloorData {
  id: string;
  name: string;
  backgroundImage: string | null;
  backgroundWidth: number;
  backgroundHeight: number;
  backgroundOffsetX: number;
  backgroundOffsetY: number;
  backgroundScale: number;
  backgroundLocked: boolean;
  pdfFileName: string;
  devices: PlacedDevice[];
  commsRackId: string | null;
  whitewashRects: WhitewashRect[];
  /** Optional for plans saved before 16 Nov 2026. */
  callouts?: Callout[];
}

export interface RevisionEntry {
  revision: string;
  date: string;
  notes: string;
}

export interface CustomDevice {
  id: string;           // 'custom-' + UUID
  name: string;
  category: DeviceCategory;
  cableType: CableType;
  symbolImage: string;  // data URL of uploaded PNG
  needsCableRun: boolean;
  linkedProductId?: string;
  linkedProductName?: string;
}
