export type DeviceCategory = 'cameras' | 'security' | 'audio' | 'data' | 'av';
export type CableType = 'cat6' | 'sixcore' | 'speaker' | 'none';

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
  cabled?: boolean;
  /**
   * For data outlets (Cat6 / RG6): how many physical points at this
   * marker. Rendered as a small ×N badge so the electrician knows how
   * many drops to terminate. Undefined or 1 = no badge.
   */
  dataCount?: number;
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

export interface PdfElement {
  id: string;
  type: 'text' | 'path' | 'image' | 'group';
  label: string;
  opIndices: number[];
  bbox: { x: number; y: number; width: number; height: number };
}

export type NumberedDeviceGroup = 'cameras' | 'pir' | 'speakers' | 'data';

export const NUMBERED_GROUPS: Record<NumberedDeviceGroup, string[]> = {
  cameras: ['cam-black', 'cam-white'],
  pir: ['pir-wall', 'pir-ceiling'],
  speakers: ['speaker-roof', 'speaker-roof-gear', 'speaker-wall', 'speaker-wall-filled'],
  // Data outlets are numbered in PLACEMENT order (not left-to-right) so
  // cable labels match the installation sequence the electrician
  // physically runs them in. Wi-Fi APs are excluded — they're devices,
  // not data drops.
  data: ['cat6-data', 'rg6-coax'],
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
