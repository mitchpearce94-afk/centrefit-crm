import { usePlanStore } from '@/store/planStore';
import { getDeviceById } from '@/lib/plan-builder/devices';
import { FloorData } from '@/types/plan-builder';

const PLAN_TO_QUOTE_MAP: Record<string, string> = {
  'cam-black': 'camera_black',
  'cam-white': 'camera_white',
  'cam-tg': 'tailgate_system',
  'sensor-tg': 'tailgate_system',
  'alarm-panel': 'alarm_panel',
  'alarm-keypad': 'alarm_keypad',
  'pir-wall': 'pir_wall',
  'pir-ceiling': 'pir_360_roof',
  'reed-switch': 'reed_switch',
  'rf-receiver': 'rf_receiver',
  'door-lock': 'door_lock',
  'duress-btn': 'duress_button',
  'duress-intercom': 'duress_intercom',
  'ext-siren': 'light_siren',
  'bio-access': 'bio_access',
  'swipe-card': 'card_reader',
  'rex': 'rex_button',
  'speaker-roof': 'speaker_roof',
  'speaker-roof-gear': 'speaker_roof',
  'speaker-wall': 'speaker_wall',
  'speaker-wall-filled': 'speaker_wall',
  'wifi-ap': 'wap',
  'cat6-data': 'data_point',
  'rg6-coax': 'coax_point',
  'integration-cable': 'integration_cable',
  'server-9ru': 'cabinet_9ru',
  'server-27ru': 'cabinet_27ru',
  'server-32ru': 'cabinet_32ru',
  'server-42ru': 'cabinet_42ru',
  'intercom-master': 'intercom_master',
  'intercom-slave': 'intercom_slave',
};

export interface QuoteExportData {
  source: 'centrefit-plan-builder';
  version: 1;
  project: {
    client: string;
    projectName: string;
    worksAddress: string;
    drawingNumber: string;
    revision: string;
    date: string;
  };
  deviceCounts: Record<string, number>;
  siteInfo: { door_count: number };
  floors: Array<{ name: string; deviceCounts: Record<string, number> }>;
}

export function generateQuoteExport(): QuoteExportData {
  const store = usePlanStore.getState();
  const { titleBlock } = store;

  const syncedFloors: FloorData[] = store.floors.map(f =>
    f.id === store.activeFloorId
      ? { ...f, devices: store.devices, commsRackId: store.commsRackId }
      : f
  );

  const globalCounts: Record<string, number> = {};
  const floorBreakdowns: QuoteExportData['floors'] = [];
  let doorCount = 0;
  let totalTgCameras = 0;
  let totalTgSensors = 0;

  for (const floor of syncedFloors) {
    const floorCounts: Record<string, number> = {};
    let floorTgCameras = 0;
    let floorTgSensors = 0;

    for (const device of floor.devices) {
      const def = getDeviceById(device.deviceId);
      if (!def || def.isCommsRack) continue;
      if (device.deviceId === 'cam-tg') { floorTgCameras++; totalTgCameras++; continue; }
      if (device.deviceId === 'sensor-tg') { floorTgSensors++; totalTgSensors++; continue; }
      const quoteCode = PLAN_TO_QUOTE_MAP[device.deviceId];
      if (!quoteCode) continue;
      globalCounts[quoteCode] = (globalCounts[quoteCode] || 0) + 1;
      floorCounts[quoteCode] = (floorCounts[quoteCode] || 0) + 1;
      if (device.deviceId === 'door-lock' || device.deviceId === 'integration-cable') doorCount++;
    }

    const floorTgSystems = Math.max(floorTgCameras, floorTgSensors);
    if (floorTgSystems > 0) floorCounts['tailgate_system'] = floorTgSystems;
    if (Object.keys(floorCounts).length > 0) floorBreakdowns.push({ name: floor.name, deviceCounts: floorCounts });
  }

  const totalTgSystems = Math.max(totalTgCameras, totalTgSensors);
  if (totalTgSystems > 0) globalCounts['tailgate_system'] = totalTgSystems;

  return {
    source: 'centrefit-plan-builder',
    version: 1,
    project: {
      client: titleBlock.client,
      projectName: titleBlock.projectName,
      worksAddress: titleBlock.worksAddress,
      drawingNumber: titleBlock.drawingNumber,
      revision: titleBlock.revision,
      date: titleBlock.date,
    },
    deviceCounts: globalCounts,
    siteInfo: { door_count: doorCount },
    floors: floorBreakdowns,
  };
}

export function exportToQuoteFile(): void {
  const data = generateQuoteExport();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const parts = [data.project.client, data.project.projectName].filter(Boolean);
  a.download = `${parts.join(' - ') || 'centrefit-plan'}.cfq`;
  a.click();
  URL.revokeObjectURL(url);
}
