import { DeviceDefinition, CustomDevice } from '@/types/plan-builder';

export const DEVICE_CATALOG: DeviceDefinition[] = [
  // CAMERAS
  { id: 'cam-black', name: 'Black Digital Surveillance Camera', category: 'cameras', cableType: 'cat6', symbolType: 'camera-circle', fillColor: '#1a1a1a', strokeColor: '#666666', symbolImage: '/plan-builder/symbols/cam-black.png', symbolScale: 1.5 },
  { id: 'cam-white', name: 'White Digital Surveillance Camera', category: 'cameras', cableType: 'cat6', symbolType: 'camera-circle', fillColor: '#ffffff', strokeColor: '#333333', symbolImage: '/plan-builder/symbols/cam-white.png', symbolScale: 1.5 },
  { id: 'cam-tg', name: 'Tail Gating Camera', category: 'cameras', cableType: 'cat6', symbolType: 'labeled-circle', fillColor: '#2d2d2d', strokeColor: '#00bfff', label: 'TG', symbolImage: '/plan-builder/symbols/tail-gating-camera.png', symbolScale: 1.5 },
  { id: 'sensor-tg', name: 'Tail Gating Sensor', category: 'cameras', cableType: 'cat6', symbolType: 'radar-circle', fillColor: '#2d2d2d', strokeColor: '#00bfff', label: 'TS', symbolImage: '/plan-builder/symbols/tail-gating-sensor.png', symbolScale: 1.5 },

  // SECURITY
  { id: 'alarm-panel', name: 'Alarm Panel', category: 'security', cableType: 'sixcore', symbolType: 'dot-circle', fillColor: '#ff4444', strokeColor: '#ff4444', symbolImage: '/plan-builder/symbols/alarm-panel.png' },
  { id: 'alarm-keypad', name: 'Alarm Keypad', category: 'security', cableType: 'sixcore', symbolType: 'triangle-filled', fillColor: '#ff8800', strokeColor: '#ff8800', symbolImage: '/plan-builder/symbols/alarm-keypad.png' },
  { id: 'pir-wall', name: 'PIR Wall Mount', category: 'security', cableType: 'sixcore', symbolType: 'circle-arrow', fillColor: '#1a1a1a', strokeColor: '#1a1a1a', symbolImage: '/plan-builder/symbols/pir-wall.png' },
  { id: 'pir-ceiling', name: 'PIR 360° Ceiling', category: 'security', cableType: 'sixcore', symbolType: 'open-circle', strokeColor: '#ff4444', symbolImage: '/plan-builder/symbols/pir-360.png' },
  { id: 'reed-switch', name: 'Reed Switch', category: 'security', cableType: 'sixcore', symbolType: 'gold-circle', fillColor: '#FFD700', strokeColor: '#b8860b', symbolImage: '/plan-builder/symbols/reed-switch.png' },
  { id: 'rf-receiver', name: 'RF Receiver', category: 'security', cableType: 'sixcore', symbolType: 'wifi', fillColor: '#ff8800', strokeColor: '#ff8800', symbolImage: '/plan-builder/symbols/rf-receiver.png' },
  { id: 'door-lock', name: 'Door Lock - Striker/Mag', category: 'security', cableType: 'sixcore', symbolType: 'labeled-square', fillColor: '#cc0000', strokeColor: '#ff4444', label: 'H', symbolImage: '/plan-builder/symbols/door-lock.png' },
  { id: 'duress-btn', name: 'Duress Button (wall mount)', category: 'security', cableType: 'sixcore', symbolType: 'labeled-circle', fillColor: '#cc0000', strokeColor: '#ff4444', label: 'D', symbolImage: '/plan-builder/symbols/duress-button.png' },
  { id: 'duress-pendant', name: 'Duress Pendant (wireless)', category: 'security', cableType: 'none', symbolType: 'labeled-circle', fillColor: '#cc0000', strokeColor: '#ff4444', label: 'DP', symbolImage: '/plan-builder/symbols/duress-button.png' },
  { id: 'duress-intercom', name: 'Duress Intercom', category: 'security', cableType: 'sixcore', symbolType: 'duress-circle', fillColor: '#cc0000', strokeColor: '#ff4444', label: 'D', symbolImage: '/plan-builder/symbols/duress-intercom.png' },
  { id: 'break-glass', name: 'Break Glass', category: 'security', cableType: 'sixcore', symbolType: 'labeled-square', fillColor: '#cc0000', strokeColor: '#ff4444', label: 'BG', symbolImage: '/plan-builder/symbols/break-glass.png' },
  { id: 'ext-siren', name: 'External Light & Siren', category: 'security', cableType: 'sixcore', symbolType: 'outline-square', fillColor: '#0066cc', strokeColor: '#3399ff', symbolImage: '/plan-builder/symbols/ext-light-siren.png' },

  // ACCESS CONTROL
  { id: 'bio-access', name: 'BIO Access Control Unit', category: 'security', cableType: 'sixcore', symbolType: 'labeled-circle', fillColor: '#005577', strokeColor: '#00bfff', label: 'B', symbolImage: '/plan-builder/symbols/bio-access.png' },
  { id: 'swipe-card', name: 'Swipe Card Reader', category: 'security', cableType: 'sixcore', symbolType: 'grid', fillColor: '#006600', strokeColor: '#00cc00', symbolImage: '/plan-builder/symbols/swipe-card.png' },
  { id: 'rex', name: 'REX Request to Exit', category: 'security', cableType: 'sixcore', symbolType: 'flag', fillColor: '#1a1a1a', strokeColor: '#1a1a1a', symbolImage: '/plan-builder/symbols/rex.png' },

  // AUDIO
  { id: 'volume-control', name: 'Volume Control', category: 'audio', cableType: 'speaker', symbolType: 'volume-control', fillColor: '#6600cc', strokeColor: '#9933ff', isVolumeControl: true, symbolImage: '/plan-builder/symbols/volume-control.png' },
  // Speakers are split by colour — each maps to a distinct product in the quote
  { id: 'speaker-roof-white', name: 'Speaker Roof Mount (White)', category: 'audio', cableType: 'speaker', symbolType: 'speaker-circle', fillColor: '#6600cc', strokeColor: '#9933ff', symbolImage: '/plan-builder/symbols/speaker-roof-1.png' },
  { id: 'speaker-roof-black', name: 'Speaker Roof Mount (Black)', category: 'audio', cableType: 'speaker', symbolType: 'speaker-gear', fillColor: '#6600cc', strokeColor: '#9933ff', symbolImage: '/plan-builder/symbols/speaker-roof-2.png' },
  { id: 'speaker-wall-white', name: 'Speaker Wall Mount (White)', category: 'audio', cableType: 'speaker', symbolType: 'speaker-wall-outline', fillColor: '#6600cc', strokeColor: '#9933ff', symbolImage: '/plan-builder/symbols/speaker-wall-1.png' },
  { id: 'speaker-wall-black', name: 'Speaker Wall Mount (Black)', category: 'audio', cableType: 'speaker', symbolType: 'speaker-wall-filled', fillColor: '#6600cc', strokeColor: '#9933ff', symbolImage: '/plan-builder/symbols/speaker-wall-2.png' },

  // DATA/COMMS
  { id: 'wifi-ap', name: 'Wi-Fi Access Point', category: 'data', cableType: 'cat6', symbolType: 'wifi-circle', fillColor: '#0066cc', strokeColor: '#3399ff', symbolImage: '/plan-builder/symbols/wifi-ap.png' },
  { id: 'cat6-data', name: 'Cat6 Ethernet Data Point', category: 'data', cableType: 'cat6', symbolType: 'triangle-open', strokeColor: '#3399ff', symbolImage: '/plan-builder/symbols/cat6-ethernet.png' },
  { id: 'rg6-coax', name: 'RG6 Coaxial Point', category: 'data', cableType: 'cat6', symbolType: 'triangle-filled', fillColor: '#cc0000', strokeColor: '#ff4444', symbolImage: '/plan-builder/symbols/rg6-coaxial.png' },
  { id: 'integration-cable', name: 'Integration Cable', category: 'security', cableType: 'sixcore', symbolType: 'arrows-square', fillColor: '#0066cc', strokeColor: '#3399ff', symbolImage: '/plan-builder/symbols/cable-integration.png' },
  { id: 'server-9ru', name: 'Server Cabinet 9RU', category: 'data', cableType: 'none', symbolType: 'x-square', fillColor: '#0055aa', strokeColor: '#3399ff', label: '9RU', symbolImage: '/plan-builder/symbols/server-9ru.png', symbolScale: 2.0 },
  { id: 'server-27ru', name: 'Server Cabinet 27RU', category: 'data', cableType: 'none', symbolType: 'x-square', fillColor: '#aa0000', strokeColor: '#ff4444', label: '27RU', symbolImage: '/plan-builder/symbols/server-27ru.png', symbolScale: 2.0 },
  { id: 'server-32ru', name: 'Server Cabinet 32RU', category: 'data', cableType: 'none', symbolType: 'x-square', fillColor: '#006600', strokeColor: '#00cc00', label: '32RU', symbolImage: '/plan-builder/symbols/server-32ru.png', symbolScale: 2.0 },
  { id: 'server-42ru', name: 'Server Cabinet 42RU', category: 'data', cableType: 'none', symbolType: 'x-square', fillColor: '#884400', strokeColor: '#ff8800', label: '42RU', symbolImage: '/plan-builder/symbols/server-42ru.png', symbolScale: 2.0 },

  // AV
  { id: 'intercom-master', name: 'Video Intercom Master', category: 'av', cableType: 'cat6', symbolType: 'intercom-grid', fillColor: '#cc1166', strokeColor: '#ff66aa', label: 'M', symbolImage: '/plan-builder/symbols/intercom-master.png' },
  { id: 'intercom-slave', name: 'Video Intercom Slave', category: 'av', cableType: 'cat6', symbolType: 'intercom-grid', fillColor: '#1155cc', strokeColor: '#4499ff', label: 'S', symbolImage: '/plan-builder/symbols/intercom-slave.png' },

  // COMMS RACK
  { id: 'comms-rack', name: 'Comms Rack', category: 'data', cableType: 'none', symbolType: 'comms-rack', fillColor: '#334455', strokeColor: '#66aaff', isCommsRack: true },
];

export const CATEGORY_LABELS: Record<string, string> = {
  cameras: 'Cameras',
  security: 'Security',
  audio: 'Audio',
  data: 'Data / Comms',
  av: 'AV / Intercom',
};

export const CABLE_COLORS: Record<string, string> = {
  cat6: '#3399ff',
  sixcore: '#ff4444',
  speaker: '#44cc44',
};

// Runtime custom device definitions (synced from store)
let _customDeviceDefs: DeviceDefinition[] = [];

export function customDeviceToDefinition(custom: CustomDevice): DeviceDefinition {
  return {
    id: custom.id,
    name: custom.name,
    category: custom.category,
    cableType: custom.cableType,
    symbolType: 'labeled-circle',
    symbolImage: custom.symbolImage,
    symbolScale: 1.5,
  };
}

export function setCustomDeviceDefs(customs: CustomDevice[]): void {
  _customDeviceDefs = customs.map(customDeviceToDefinition);
}

export function getAllDevices(): DeviceDefinition[] {
  return [...DEVICE_CATALOG, ..._customDeviceDefs];
}

// Backward-compatibility for plans saved before the speaker colour split.
// Old IDs fall back to the black variants (which were the de-facto product
// before the split), keeping existing plans loadable.
const LEGACY_DEVICE_ALIAS: Record<string, string> = {
  'speaker-roof': 'speaker-roof-white',
  'speaker-roof-gear': 'speaker-roof-black',
  'speaker-wall': 'speaker-wall-white',
  'speaker-wall-filled': 'speaker-wall-black',
};

export function getDeviceById(id: string): DeviceDefinition | undefined {
  const aliased = LEGACY_DEVICE_ALIAS[id] ?? id;
  return DEVICE_CATALOG.find(d => d.id === aliased) || _customDeviceDefs.find(d => d.id === aliased);
}
