import React from 'react';
import { create } from 'zustand';
import { PlacedDevice, CableRun, TitleBlockInfo, LayerVisibility, ActiveTool, WhitewashRect, NUMBERED_GROUPS, FloorData, RevisionEntry, PdfElement, CustomDevice } from '@/types/plan-builder';
import { getDeviceById, setCustomDeviceDefs } from '@/lib/plan-builder/devices';
import { renderPdfPageFiltered } from '@/lib/plan-builder/pdfUtils';

interface HistoryEntry {
  devices: PlacedDevice[];
  commsRackId: string | null;
  whitewashRects: WhitewashRect[];
}

interface PlanState {
  backgroundImage: string | null;
  backgroundWidth: number;
  backgroundHeight: number;
  backgroundOffsetX: number;
  backgroundOffsetY: number;
  backgroundScale: number;
  backgroundLocked: boolean;
  pdfFileName: string;
  stageScale: number;
  stageX: number;
  stageY: number;
  stageRef: React.RefObject<any> | null;
  devices: PlacedDevice[];
  commsRackId: string | null;
  cableRuns: CableRun[];
  whitewashRects: WhitewashRect[];
  selectedDeviceId: string | null;
  activeTool: ActiveTool;
  deviceToPlace: string | null;
  deviceScale: number;
  layers: LayerVisibility;
  activePlan: 'master' | 'cat6' | 'sixcore' | 'speaker';
  titleBlock: TitleBlockInfo;
  clientLogo: string | null;
  floors: FloorData[];
  activeFloorId: string;
  linkedJobId: string | null;
  linkedJobNumber: string | null;
  planFileId: string | null;
  isDirty: boolean;
  // PDF element selection
  pdfFile: File | null;
  pdfPageNumber: number;
  pdfElements: PdfElement[];
  deletedOpIndices: number[];
  selectedElementIds: string[];
  hoveredElementId: string | null;

  customDevices: CustomDevice[];
  revisions: RevisionEntry[];
  history: HistoryEntry[];
  historyIndex: number;

  addCustomDevice: (device: CustomDevice) => void;
  removeCustomDevice: (id: string) => void;
  setLinkedJob: (jobId: string | null, jobNumber: string | null) => void;
  setPdfSource: (file: File, pageNumber: number) => void;
  setPdfElements: (elements: PdfElement[]) => void;
  setSelectedElements: (ids: string[]) => void;
  toggleElementSelection: (id: string) => void;
  setHoveredElement: (id: string | null) => void;
  deleteSelectedElements: () => Promise<void>;
  setBackground: (image: string, width: number, height: number, fileName: string) => void;
  setBackgroundOffset: (x: number, y: number) => void;
  setBackgroundScale: (scale: number) => void;
  toggleBackgroundLock: () => void;
  cropBackground: (x: number, y: number, width: number, height: number) => void;
  setStageTransform: (scale: number, x: number, y: number) => void;
  setStageRef: (ref: React.RefObject<any>) => void;
  setActiveTool: (tool: ActiveTool) => void;
  setDeviceScale: (scale: number) => void;
  setDeviceToPlace: (deviceId: string | null) => void;
  placeDevice: (deviceId: string, x: number, y: number) => void;
  moveDevice: (instanceId: string, x: number, y: number) => void;
  rotateDevice: (instanceId: string, rotation: number) => void;
  deleteDevice: (instanceId: string) => void;
  selectDevice: (instanceId: string | null) => void;
  setCommsRack: (instanceId: string | null) => void;
  toggleLayer: (layer: keyof LayerVisibility) => void;
  setActivePlan: (plan: 'master' | 'cat6' | 'sixcore' | 'speaker') => void;
  updateTitleBlock: (info: Partial<TitleBlockInfo>) => void;
  setClientLogo: (logo: string | null) => void;
  setSpeakerZone: (instanceId: string, zone: number) => void;
  setConcreteMounted: (instanceId: string, value: boolean) => void;
  setProvisional: (instanceId: string, value: boolean) => void;
  setCabled: (instanceId: string, value: boolean) => void;
  addWhitewashRect: (x: number, y: number, width: number, height: number) => void;
  removeWhitewashRect: (id: string) => void;
  addFloor: (name: string) => void;
  switchFloor: (floorId: string) => void;
  renameFloor: (floorId: string, name: string) => void;
  removeFloor: (floorId: string) => void;
  bumpRevision: (notes: string) => void;
  undo: () => void;
  redo: () => void;
  markClean: () => void;
  saveProject: () => void;
  loadProject: (data: string) => void;
  clearProject: () => void;
}

const DEFAULT_TITLE_BLOCK: TitleBlockInfo = {
  client: 'Snap Fitness',
  projectName: '',
  worksAddress: '',
  state: 'QLD',
  drawingNumber: 'CF-001',
  revision: 'A',
  date: new Date().toLocaleDateString('en-AU'),
  notes: '',
};

function nearestNeighbourChain(deviceList: PlacedDevice[], startX: number, startY: number): PlacedDevice[] {
  if (deviceList.length === 0) return [];
  const remaining = [...deviceList];
  const chain: PlacedDevice[] = [];
  let cx = startX, cy = startY;
  while (remaining.length > 0) {
    let nearestIdx = 0, nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dx = remaining[i].x - cx, dy = remaining[i].y - cy;
      const dist = dx * dx + dy * dy;
      if (dist < nearestDist) { nearestDist = dist; nearestIdx = i; }
    }
    const nearest = remaining.splice(nearestIdx, 1)[0];
    chain.push(nearest);
    cx = nearest.x; cy = nearest.y;
  }
  return chain;
}

function renumberDevices(devices: PlacedDevice[], commsRackId?: string | null): PlacedDevice[] {
  const labelMap = new Map<string, number>(); // instanceId -> labelNum

  for (const [groupName, groupIds] of Object.entries(NUMBERED_GROUPS)) {
    if (groupName === 'speakers') {
      // Speakers: number per zone, following cable run order
      const speakerDevices = devices.filter(d => groupIds.includes(d.deviceId));
      const rackDevice = commsRackId ? devices.find(d => d.instanceId === commsRackId) : null;
      const startX = rackDevice?.x ?? 0;
      const startY = rackDevice?.y ?? 0;

      // Group by zone
      const zoneMap = new Map<number, PlacedDevice[]>();
      for (const d of speakerDevices) {
        const zone = d.speakerZone || 1;
        if (!zoneMap.has(zone)) zoneMap.set(zone, []);
        zoneMap.get(zone)!.push(d);
      }

      // Number each zone's speakers in cable run order, starting at 1
      for (const [, zoneSpeakers] of zoneMap) {
        // Volume controls first, then speakers — same as CableLines
        const vcs = zoneSpeakers.filter(d => { const def = getDeviceById(d.deviceId); return def?.isVolumeControl; });
        const spks = zoneSpeakers.filter(d => { const def = getDeviceById(d.deviceId); return !def?.isVolumeControl; });
        const vcChain = nearestNeighbourChain(vcs, startX, startY);
        const lastVc = vcChain[vcChain.length - 1];
        const spkChain = nearestNeighbourChain(spks, lastVc?.x ?? startX, lastVc?.y ?? startY);
        const chain = [...vcChain, ...spkChain];
        chain.forEach((d, i) => labelMap.set(d.instanceId, i + 1));
      }
    } else {
      // Cameras, PIRs: left-to-right by X position
      const groupDevices = devices.filter(d => groupIds.includes(d.deviceId));
      const sorted = [...groupDevices].sort((a, b) => a.x - b.x);
      sorted.forEach((d, i) => labelMap.set(d.instanceId, i + 1));
    }
  }

  return devices.map(d => {
    const num = labelMap.get(d.instanceId);
    if (num !== undefined) return { ...d, labelNum: num };
    return d;
  });
}

function buildCableRuns(
  devices: PlacedDevice[],
  commsRackId: string | null,
  getDeviceFn: (id: string) => ReturnType<typeof getDeviceById>
): CableRun[] {
  if (!commsRackId) return [];
  const runs: CableRun[] = [];
  let runNum = 1;
  devices.forEach(d => {
    if (d.instanceId === commsRackId) return;
    const def = getDeviceFn(d.deviceId);
    if (def && def.cableType !== 'none') {
      runs.push({
        id: `run-${d.instanceId}`,
        deviceInstanceId: d.instanceId,
        runNumber: runNum++,
        cableType: def.cableType,
      });
    }
  });
  return runs;
}

export const usePlanStore = create<PlanState>((set, get) => ({
  backgroundImage: null,
  backgroundWidth: 1200,
  backgroundHeight: 800,
  backgroundOffsetX: 0,
  backgroundOffsetY: 0,
  backgroundScale: 1,
  backgroundLocked: true,
  pdfFileName: '',
  stageScale: 1,
  stageX: 0,
  stageY: 0,
  stageRef: null,
  devices: [],
  commsRackId: null,
  cableRuns: [],
  whitewashRects: [],
  selectedDeviceId: null,
  activeTool: 'select',
  deviceScale: 1,
  deviceToPlace: null,
  layers: { master: true, cat6: true, sixcore: true, speaker: true },
  activePlan: 'master',
  titleBlock: DEFAULT_TITLE_BLOCK,
  clientLogo: null,
  linkedJobId: null,
  linkedJobNumber: null,
  planFileId: crypto.randomUUID(),
  isDirty: false,
  pdfFile: null,
  pdfPageNumber: 1,
  pdfElements: [],
  deletedOpIndices: [],
  selectedElementIds: [],
  hoveredElementId: null,
  floors: [{ id: 'floor-1', name: 'Ground Floor', backgroundImage: null, backgroundWidth: 1200, backgroundHeight: 800, backgroundOffsetX: 0, backgroundOffsetY: 0, backgroundScale: 1, backgroundLocked: true, pdfFileName: '', devices: [], commsRackId: null, whitewashRects: [] }],
  activeFloorId: 'floor-1',
  customDevices: [],
  revisions: [],
  history: [{ devices: [], commsRackId: null, whitewashRects: [] }],
  historyIndex: 0,

  addCustomDevice: (device) => {
    const newCustomDevices = [...get().customDevices, device];
    setCustomDeviceDefs(newCustomDevices);
    set({ customDevices: newCustomDevices, isDirty: true });
  },

  removeCustomDevice: (id) => {
    const state = get();
    const newCustomDevices = state.customDevices.filter(d => d.id !== id);
    setCustomDeviceDefs(newCustomDevices);
    set({
      customDevices: newCustomDevices,
      devices: state.devices.filter(d => d.deviceId !== id),
      isDirty: true,
    });
  },

  setBackground: (image, width, height, fileName) => {
    const state = get();
    // If devices already exist, unlock so user can reposition the new plan
    const hasDevices = state.devices.length > 0;
    set({
      backgroundImage: image, backgroundWidth: width, backgroundHeight: height, pdfFileName: fileName,
      backgroundOffsetX: 0, backgroundOffsetY: 0, backgroundScale: 1,
      backgroundLocked: !hasDevices,
      activeTool: hasDevices ? 'moveBackground' : state.activeTool,
      isDirty: true,
    });
  },

  setBackgroundOffset: (x, y) => set({ backgroundOffsetX: x, backgroundOffsetY: y, isDirty: true }),

  setBackgroundScale: (scale) => set({ backgroundScale: Math.max(0.1, Math.min(5, scale)), isDirty: true }),

  toggleBackgroundLock: () => {
    const state = get();
    const newLocked = !state.backgroundLocked;
    set({
      backgroundLocked: newLocked,
      activeTool: newLocked ? 'select' : 'moveBackground',
    });
  },

  cropBackground: (cx, cy, cw, ch) => {
    const state = get();
    if (!state.backgroundImage) return;
    const img = new window.Image();
    img.src = state.backgroundImage;
    img.onload = () => {
      // Convert canvas-space crop coords to image-relative coords
      const imgCx = cx - state.backgroundOffsetX;
      const imgCy = cy - state.backgroundOffsetY;
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, imgCx, imgCy, cw, ch, 0, 0, cw, ch);
      const croppedDataUrl = canvas.toDataURL('image/png');
      const newDevices = state.devices.map(d => ({ ...d, x: d.x - cx, y: d.y - cy }));
      const newWhitewash = state.whitewashRects.map(wr => ({ ...wr, x: wr.x - cx, y: wr.y - cy }));
      const cableRuns = buildCableRuns(newDevices, state.commsRackId, getDeviceById);
      set({
        backgroundImage: croppedDataUrl,
        backgroundWidth: cw,
        backgroundHeight: ch,
        backgroundOffsetX: 0,
        backgroundOffsetY: 0,
        backgroundScale: 1,
        backgroundLocked: true,
        devices: newDevices,
        whitewashRects: newWhitewash,
        cableRuns,
        activeTool: 'select',
        isDirty: true,
      });
    };
  },

  setLinkedJob: (jobId, jobNumber) => set({ linkedJobId: jobId, linkedJobNumber: jobNumber }),

  setPdfSource: (file, pageNumber) => set({ pdfFile: file, pdfPageNumber: pageNumber }),
  setPdfElements: (elements) => set({ pdfElements: elements, selectedElementIds: [], hoveredElementId: null }),
  setSelectedElements: (ids) => set({ selectedElementIds: ids }),
  toggleElementSelection: (id) => {
    const state = get();
    const current = state.selectedElementIds;
    if (current.includes(id)) {
      set({ selectedElementIds: current.filter(x => x !== id) });
    } else {
      set({ selectedElementIds: [...current, id] });
    }
  },
  setHoveredElement: (id) => set({ hoveredElementId: id }),

  deleteSelectedElements: async () => {
    const state = get();
    if (state.selectedElementIds.length === 0 || !state.pdfFile) return;

    // Collect all operator indices from selected elements
    const newDeletedIndices = new Set(state.deletedOpIndices);
    const selectedElements = state.pdfElements.filter(el => state.selectedElementIds.includes(el.id));
    for (const el of selectedElements) {
      for (const idx of el.opIndices) {
        newDeletedIndices.add(idx);
      }
    }

    // Re-render the PDF without the deleted operators
    const result = await renderPdfPageFiltered(state.pdfFile, state.pdfPageNumber, newDeletedIndices);

    // Remove deleted elements from the list
    const remainingElements = state.pdfElements.filter(el => !state.selectedElementIds.includes(el.id));

    set({
      backgroundImage: result.dataUrl,
      backgroundWidth: result.width,
      backgroundHeight: result.height,
      deletedOpIndices: Array.from(newDeletedIndices),
      pdfElements: remainingElements,
      selectedElementIds: [],
      hoveredElementId: null,
    });
  },

  setStageTransform: (scale, x, y) => set({ stageScale: scale, stageX: x, stageY: y }),
  setStageRef: (ref) => set({ stageRef: ref }),
  setActiveTool: (tool) => set({ activeTool: tool, deviceToPlace: null }),
  setDeviceScale: (scale) => set({ deviceScale: scale }),
  setDeviceToPlace: (deviceId) => set({ deviceToPlace: deviceId, activeTool: deviceId ? 'place' : 'select' }),

  placeDevice: (deviceId, x, y) => {
    const state = get();
    const instanceId = `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newDevice: PlacedDevice = { instanceId, deviceId, x, y, rotation: 0, labelNum: 0 };
    const def = getDeviceById(deviceId);
    const isCommsRack = def?.isCommsRack ?? false;
    const newCommsRackId = isCommsRack ? instanceId : state.commsRackId;
    const newDevices = renumberDevices([...state.devices, newDevice], newCommsRackId);
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push({ devices: newDevices, commsRackId: newCommsRackId, whitewashRects: state.whitewashRects });
    const cableRuns = buildCableRuns(newDevices, newCommsRackId, getDeviceById);
    set({ devices: newDevices, commsRackId: newCommsRackId, cableRuns, history: newHistory, historyIndex: newHistory.length - 1, isDirty: true });
  },

  moveDevice: (instanceId, x, y) => {
    const state = get();
    const newDevices = renumberDevices(state.devices.map(d => d.instanceId === instanceId ? { ...d, x, y } : d), state.commsRackId);
    const cableRuns = buildCableRuns(newDevices, state.commsRackId, getDeviceById);
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push({ devices: newDevices, commsRackId: state.commsRackId, whitewashRects: state.whitewashRects });
    set({ devices: newDevices, cableRuns, history: newHistory, historyIndex: newHistory.length - 1, isDirty: true });
  },

  rotateDevice: (instanceId, rotation) => {
    const state = get();
    const newDevices = state.devices.map(d => d.instanceId === instanceId ? { ...d, rotation } : d);
    set({ devices: newDevices, isDirty: true });
  },

  deleteDevice: (instanceId) => {
    const state = get();
    const filtered = state.devices.filter(d => d.instanceId !== instanceId);
    const newCommsRackId = state.commsRackId === instanceId ? null : state.commsRackId;
    const newDevices = renumberDevices(filtered, newCommsRackId);
    const cableRuns = buildCableRuns(newDevices, newCommsRackId, getDeviceById);
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push({ devices: newDevices, commsRackId: newCommsRackId, whitewashRects: state.whitewashRects });
    set({
      devices: newDevices, commsRackId: newCommsRackId, cableRuns,
      selectedDeviceId: state.selectedDeviceId === instanceId ? null : state.selectedDeviceId,
      history: newHistory, historyIndex: newHistory.length - 1, isDirty: true,
    });
  },

  selectDevice: (instanceId) => set({ selectedDeviceId: instanceId }),

  setCommsRack: (instanceId) => {
    const state = get();
    const cableRuns = buildCableRuns(state.devices, instanceId, getDeviceById);
    set({ commsRackId: instanceId, cableRuns });
  },

  toggleLayer: (layer) => {
    const state = get();
    set({ layers: { ...state.layers, [layer]: !state.layers[layer] } });
  },

  setActivePlan: (plan) => set({ activePlan: plan }),

  addWhitewashRect: (x, y, width, height) => {
    const state = get();
    const id = `ww-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newWhitewashRects = [...state.whitewashRects, { id, x, y, width, height }];
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push({ devices: state.devices, commsRackId: state.commsRackId, whitewashRects: newWhitewashRects });
    set({ whitewashRects: newWhitewashRects, history: newHistory, historyIndex: newHistory.length - 1, isDirty: true });
  },

  removeWhitewashRect: (id) => {
    const state = get();
    set({ whitewashRects: state.whitewashRects.filter(r => r.id !== id), isDirty: true });
  },

  setClientLogo: (logo) => set({ clientLogo: logo, isDirty: true }),

  setSpeakerZone: (instanceId, zone) => {
    const state = get();
    const updated = state.devices.map(d => d.instanceId === instanceId ? { ...d, speakerZone: zone } : d);
    set({ devices: renumberDevices(updated, state.commsRackId), isDirty: true });
  },

  setConcreteMounted: (instanceId, value) => {
    const state = get();
    set({ devices: state.devices.map(d => d.instanceId === instanceId ? { ...d, concreteMounted: value } : d), isDirty: true });
  },

  setProvisional: (instanceId, value) => {
    const state = get();
    set({ devices: state.devices.map(d => d.instanceId === instanceId ? { ...d, provisional: value } : d), isDirty: true });
  },

  setCabled: (instanceId, value) => {
    const state = get();
    set({ devices: state.devices.map(d => d.instanceId === instanceId ? { ...d, cabled: value } : d), isDirty: true });
  },

  updateTitleBlock: (info) => {
    const state = get();
    set({ titleBlock: { ...state.titleBlock, ...info }, isDirty: true });
  },

  addFloor: (name) => {
    const state = get();
    const newId = `floor-${Date.now()}`;
    const updatedFloors = state.floors.map(f =>
      f.id === state.activeFloorId
        ? { ...f, backgroundImage: state.backgroundImage, backgroundWidth: state.backgroundWidth, backgroundHeight: state.backgroundHeight, backgroundOffsetX: state.backgroundOffsetX, backgroundOffsetY: state.backgroundOffsetY, backgroundScale: state.backgroundScale, backgroundLocked: state.backgroundLocked, pdfFileName: state.pdfFileName, devices: state.devices, commsRackId: state.commsRackId, whitewashRects: state.whitewashRects }
        : f
    );
    const newFloor: FloorData = { id: newId, name, backgroundImage: null, backgroundWidth: 1200, backgroundHeight: 800, backgroundOffsetX: 0, backgroundOffsetY: 0, backgroundScale: 1, backgroundLocked: true, pdfFileName: '', devices: [], commsRackId: null, whitewashRects: [] };
    set({
      floors: [...updatedFloors, newFloor], activeFloorId: newId,
      backgroundImage: null, backgroundWidth: 1200, backgroundHeight: 800, backgroundOffsetX: 0, backgroundOffsetY: 0, backgroundScale: 1, backgroundLocked: true, pdfFileName: '',
      devices: [], commsRackId: null, cableRuns: [], whitewashRects: [],
      selectedDeviceId: null, history: [{ devices: [], commsRackId: null, whitewashRects: [] }], historyIndex: 0, isDirty: true,
    });
  },

  switchFloor: (floorId) => {
    const state = get();
    if (floorId === state.activeFloorId) return;
    const updatedFloors = state.floors.map(f =>
      f.id === state.activeFloorId
        ? { ...f, backgroundImage: state.backgroundImage, backgroundWidth: state.backgroundWidth, backgroundHeight: state.backgroundHeight, backgroundOffsetX: state.backgroundOffsetX, backgroundOffsetY: state.backgroundOffsetY, backgroundScale: state.backgroundScale, backgroundLocked: state.backgroundLocked, pdfFileName: state.pdfFileName, devices: state.devices, commsRackId: state.commsRackId, whitewashRects: state.whitewashRects }
        : f
    );
    const target = updatedFloors.find(f => f.id === floorId);
    if (!target) return;
    const targetDevices = renumberDevices(target.devices, target.commsRackId);
    const cableRuns = buildCableRuns(targetDevices, target.commsRackId, getDeviceById);
    set({
      floors: updatedFloors, activeFloorId: floorId,
      backgroundImage: target.backgroundImage, backgroundWidth: target.backgroundWidth, backgroundHeight: target.backgroundHeight,
      backgroundOffsetX: target.backgroundOffsetX ?? 0, backgroundOffsetY: target.backgroundOffsetY ?? 0, backgroundScale: target.backgroundScale ?? 1, backgroundLocked: target.backgroundLocked ?? true,
      pdfFileName: target.pdfFileName, devices: targetDevices, commsRackId: target.commsRackId, cableRuns,
      whitewashRects: target.whitewashRects, selectedDeviceId: null,
      history: [{ devices: target.devices, commsRackId: target.commsRackId, whitewashRects: target.whitewashRects }], historyIndex: 0, isDirty: true,
    });
  },

  renameFloor: (floorId, name) => {
    const state = get();
    set({ floors: state.floors.map(f => f.id === floorId ? { ...f, name } : f) });
  },

  removeFloor: (floorId) => {
    const state = get();
    if (state.floors.length <= 1) return;
    const remaining = state.floors.filter(f => f.id !== floorId);
    if (floorId === state.activeFloorId) {
      const target = remaining[0];
      const cableRuns = buildCableRuns(target.devices, target.commsRackId, getDeviceById);
      set({
        floors: remaining, activeFloorId: target.id,
        backgroundImage: target.backgroundImage, backgroundWidth: target.backgroundWidth, backgroundHeight: target.backgroundHeight,
        backgroundOffsetX: target.backgroundOffsetX ?? 0, backgroundOffsetY: target.backgroundOffsetY ?? 0, backgroundScale: target.backgroundScale ?? 1, backgroundLocked: target.backgroundLocked ?? true,
        pdfFileName: target.pdfFileName, devices: target.devices, commsRackId: target.commsRackId, cableRuns,
        whitewashRects: target.whitewashRects, selectedDeviceId: null,
        history: [{ devices: target.devices, commsRackId: target.commsRackId, whitewashRects: target.whitewashRects }], historyIndex: 0, isDirty: true,
      });
    } else {
      set({ floors: remaining, isDirty: true });
    }
  },

  bumpRevision: (notes) => {
    const state = get();
    const currentRev = state.titleBlock.revision || 'A';
    const newEntry: RevisionEntry = { revision: currentRev, date: new Date().toLocaleDateString('en-AU'), notes };
    const nextRev = String.fromCharCode(currentRev.charCodeAt(0) + 1);
    set({
      revisions: [...state.revisions, newEntry],
      titleBlock: { ...state.titleBlock, revision: nextRev, date: new Date().toLocaleDateString('en-AU') },
    });
  },

  undo: () => {
    const state = get();
    if (state.historyIndex <= 0) return;
    const newIndex = state.historyIndex - 1;
    const entry = state.history[newIndex];
    const cableRuns = buildCableRuns(entry.devices, entry.commsRackId, getDeviceById);
    set({ devices: entry.devices, commsRackId: entry.commsRackId, whitewashRects: entry.whitewashRects, historyIndex: newIndex, cableRuns });
  },

  redo: () => {
    const state = get();
    if (state.historyIndex >= state.history.length - 1) return;
    const newIndex = state.historyIndex + 1;
    const entry = state.history[newIndex];
    const cableRuns = buildCableRuns(entry.devices, entry.commsRackId, getDeviceById);
    set({ devices: entry.devices, commsRackId: entry.commsRackId, whitewashRects: entry.whitewashRects, historyIndex: newIndex, cableRuns });
  },

  markClean: () => set({ isDirty: false }),

  saveProject: () => {
    const state = get();
    const syncedFloors = state.floors.map(f =>
      f.id === state.activeFloorId
        ? { ...f, backgroundImage: state.backgroundImage, backgroundWidth: state.backgroundWidth, backgroundHeight: state.backgroundHeight, backgroundOffsetX: state.backgroundOffsetX, backgroundOffsetY: state.backgroundOffsetY, backgroundScale: state.backgroundScale, backgroundLocked: state.backgroundLocked, pdfFileName: state.pdfFileName, devices: state.devices, commsRackId: state.commsRackId, whitewashRects: state.whitewashRects }
        : f
    );
    const data = JSON.stringify({
      version: 2,
      floors: syncedFloors,
      activeFloorId: state.activeFloorId,
      titleBlock: state.titleBlock,
      clientLogo: state.clientLogo,
      revisions: state.revisions,
      deviceScale: state.deviceScale,
      linkedJobId: state.linkedJobId,
      linkedJobNumber: state.linkedJobNumber,
      planFileId: state.planFileId,
      customDevices: state.customDevices,
    });
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const tb = state.titleBlock;
    const parts = [tb.state, tb.client, tb.projectName, tb.revision, tb.date].filter(Boolean);
    a.download = `${parts.join(' - ') || 'centrefit-plan'}.cfp`;
    a.click();
    URL.revokeObjectURL(url);
    set({ isDirty: false });
  },

  loadProject: (data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.version === 2 && parsed.floors) {
        // Backfill offset fields for old .cfp files
        const floors: FloorData[] = parsed.floors.map((f: any) => ({
          ...f,
          backgroundOffsetX: f.backgroundOffsetX ?? 0,
          backgroundOffsetY: f.backgroundOffsetY ?? 0,
          backgroundScale: f.backgroundScale ?? 1,
          backgroundLocked: f.backgroundLocked ?? true,
        }));
        const activeId = parsed.activeFloorId || floors[0]?.id || 'floor-1';
        const active = floors.find(f => f.id === activeId) || floors[0];
        const loadedCustomDevices: CustomDevice[] = parsed.customDevices || [];
        setCustomDeviceDefs(loadedCustomDevices);
        const activeDevices = renumberDevices(active.devices || [], active.commsRackId || null);
        const cableRuns = buildCableRuns(activeDevices, active.commsRackId || null, getDeviceById);
        set({
          floors, activeFloorId: activeId,
          backgroundImage: active.backgroundImage || null, backgroundWidth: active.backgroundWidth || 1200, backgroundHeight: active.backgroundHeight || 800,
          backgroundOffsetX: active.backgroundOffsetX ?? 0, backgroundOffsetY: active.backgroundOffsetY ?? 0, backgroundScale: active.backgroundScale ?? 1, backgroundLocked: active.backgroundLocked ?? true,
          pdfFileName: active.pdfFileName || '', devices: activeDevices, commsRackId: active.commsRackId || null,
          whitewashRects: active.whitewashRects || [], titleBlock: { ...DEFAULT_TITLE_BLOCK, ...(parsed.titleBlock || {}) },
          clientLogo: parsed.clientLogo || null, revisions: parsed.revisions || [], cableRuns,
          deviceScale: parsed.deviceScale || 1,
          linkedJobId: parsed.linkedJobId || null, linkedJobNumber: parsed.linkedJobNumber || null, planFileId: parsed.planFileId || crypto.randomUUID(),
          customDevices: loadedCustomDevices,
          isDirty: false,
          history: [{ devices: active.devices || [], commsRackId: active.commsRackId || null, whitewashRects: active.whitewashRects || [] }], historyIndex: 0,
        });
      } else {
        const v1Devices = renumberDevices(parsed.devices || [], parsed.commsRackId || null);
        const cableRuns = buildCableRuns(v1Devices, parsed.commsRackId || null, getDeviceById);
        const floor: FloorData = {
          id: 'floor-1', name: 'Ground Floor',
          backgroundImage: parsed.backgroundImage || null, backgroundWidth: parsed.backgroundWidth || 1200, backgroundHeight: parsed.backgroundHeight || 800,
          backgroundOffsetX: 0, backgroundOffsetY: 0, backgroundScale: 1, backgroundLocked: true,
          pdfFileName: parsed.pdfFileName || '', devices: v1Devices, commsRackId: parsed.commsRackId || null, whitewashRects: parsed.whitewashRects || [],
        };
        set({
          floors: [floor], activeFloorId: 'floor-1',
          devices: floor.devices, commsRackId: floor.commsRackId, whitewashRects: floor.whitewashRects,
          backgroundImage: floor.backgroundImage, backgroundWidth: floor.backgroundWidth, backgroundHeight: floor.backgroundHeight,
          backgroundOffsetX: 0, backgroundOffsetY: 0, backgroundScale: 1, backgroundLocked: true,
          pdfFileName: floor.pdfFileName, titleBlock: { ...DEFAULT_TITLE_BLOCK, ...(parsed.titleBlock || {}) },
          clientLogo: parsed.clientLogo || null, revisions: [], cableRuns,
          linkedJobId: parsed.linkedJobId || null, linkedJobNumber: parsed.linkedJobNumber || null, planFileId: parsed.planFileId || crypto.randomUUID(),
          isDirty: false,
          history: [{ devices: floor.devices, commsRackId: floor.commsRackId, whitewashRects: floor.whitewashRects }], historyIndex: 0,
        });
      }
    } catch (e) {
      console.error('Failed to load project:', e);
    }
  },

  clearProject: () => {
    setCustomDeviceDefs([]);
    set({
      backgroundImage: null, backgroundWidth: 1200, backgroundHeight: 800, backgroundOffsetX: 0, backgroundOffsetY: 0, backgroundScale: 1, backgroundLocked: true, pdfFileName: '',
      devices: [], commsRackId: null, cableRuns: [], whitewashRects: [],
      selectedDeviceId: null, activeTool: 'select', deviceToPlace: null, clientLogo: null,
      linkedJobId: null, linkedJobNumber: null, planFileId: crypto.randomUUID(),
      isDirty: false,
      pdfFile: null, pdfPageNumber: 1, pdfElements: [], deletedOpIndices: [],
      selectedElementIds: [], hoveredElementId: null,
      customDevices: [],
      titleBlock: DEFAULT_TITLE_BLOCK, deviceScale: 1,
      floors: [{ id: 'floor-1', name: 'Ground Floor', backgroundImage: null, backgroundWidth: 1200, backgroundHeight: 800, backgroundOffsetX: 0, backgroundOffsetY: 0, backgroundScale: 1, backgroundLocked: true, pdfFileName: '', devices: [], commsRackId: null, whitewashRects: [] }],
      activeFloorId: 'floor-1', revisions: [],
      history: [{ devices: [], commsRackId: null, whitewashRects: [] }], historyIndex: 0,
    });
  },
}));
