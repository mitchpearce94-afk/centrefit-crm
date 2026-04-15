import { PDFDocument, PDFPage, PDFImage, PDFFont, StandardFonts, rgb, degrees } from 'pdf-lib';
import { usePlanStore } from '@/store/planStore';
import { getDeviceById } from '@/lib/plan-builder/devices';
import { PlacedDevice, TitleBlockInfo, FloorData, RevisionEntry, DeviceCategory } from '@/types/plan-builder';

type PlanView = 'master' | 'cat6' | 'sixcore' | 'speaker';

interface PageDef { view: PlanView; svgPage: number; }

const DEVICE_PAGES: PageDef[] = [
  { view: 'master', svgPage: 1 },
  { view: 'cat6', svgPage: 2 },
  { view: 'sixcore', svgPage: 3 },
  { view: 'speaker', svgPage: 4 },
];

const TOTAL_TEMPLATE_PAGES = 6;
const SVG_VB_W = 21260;
const SVG_VB_H = 14174;
const PDF_PAGE_W = SVG_VB_W / 8.33333;
const PDF_PAGE_H = SVG_VB_H / 8.33333;

const PLAN_AREA = { xPct: 0.008, topPct: 0.012, wPct: 0.855, hPct: 0.875 };
const COVERAGE_RADIUS = 80;
const SYMBOL_SIZE = 42;
const SVG_RENDER_W = 5000;
const SVG_RENDER_H = Math.round(SVG_RENDER_W * SVG_VB_H / SVG_VB_W);

const TB = {
  mainFieldX: 19787, rightColX: 20464,
  clientY: 11500, projectY: 11960, addressY: 12500,
  dateY: 13310, drawingNoY: 13642, revisionY: 13930,
  mainFontSize: 130, smallFontSize: 80,
  // Client logo box — the "CLIENT" cell in the title block grid
  // PDF coords: x=1180-1623, y=1536-1686 → SVG viewBox (×8.333)
  logoBoxX: 9833, logoBoxY: 12800, logoBoxW: 3692, logoBoxH: 1250,
};

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return rgb(r, g, b);
}

async function dataUrlToBytes(dataUrl: string): Promise<Uint8Array> {
  const response = await fetch(dataUrl);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

function isPngDataUrl(dataUrl: string): boolean { return dataUrl.startsWith('data:image/png'); }

async function fetchImageBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function getVisibleDevices(devices: PlacedDevice[], view: PlanView, commsRackId: string | null): PlacedDevice[] {
  if (view === 'master') return devices;
  return devices.filter(d => {
    const def = getDeviceById(d.deviceId);
    if (!def) return false;
    if (d.instanceId === commsRackId) return true;
    if (view === 'cat6') return def.cableType === 'cat6';
    if (view === 'sixcore') return def.cableType === 'sixcore';
    if (view === 'speaker') return def.cableType === 'speaker';
    return true;
  });
}

function buildDaisyChain(deviceList: PlacedDevice[], startX: number, startY: number): PlacedDevice[] {
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

async function loadAndInjectSvg(pageNum: number, titleBlock: TitleBlockInfo, clientLogo?: string | null, revisions?: RevisionEntry[], notes?: string): Promise<string> {
  const response = await fetch(`/plan-builder/templates/page-${pageNum}.svg`);
  let svgText = await response.text();

  const fields: Array<{ x: number; y: number; text: string; fontSize: number; bold: boolean; anchor: 'middle' | 'end' | 'start' }> = [];
  if (titleBlock.client) fields.push({ x: TB.mainFieldX, y: TB.clientY, text: titleBlock.client, fontSize: TB.mainFontSize, bold: true, anchor: 'middle' });
  if (titleBlock.projectName) fields.push({ x: TB.mainFieldX, y: TB.projectY, text: titleBlock.projectName, fontSize: TB.mainFontSize, bold: true, anchor: 'middle' });
  if (titleBlock.worksAddress) fields.push({ x: TB.mainFieldX, y: TB.addressY, text: titleBlock.worksAddress, fontSize: TB.mainFontSize, bold: true, anchor: 'middle' });
  if (titleBlock.date) fields.push({ x: TB.rightColX, y: TB.dateY, text: titleBlock.date, fontSize: TB.smallFontSize, bold: true, anchor: 'middle' });
  if (titleBlock.drawingNumber) fields.push({ x: 20655, y: TB.drawingNoY, text: titleBlock.drawingNumber, fontSize: TB.smallFontSize, bold: true, anchor: 'end' });
  if (titleBlock.revision) fields.push({ x: TB.rightColX, y: TB.revisionY, text: titleBlock.revision, fontSize: TB.smallFontSize, bold: true, anchor: 'middle' });

  let injection = '';
  for (const f of fields) {
    const weight = f.bold ? ' font-weight="bold"' : '';
    injection += `<text x="${f.x}" y="${f.y}" font-family="Arial, sans-serif" font-size="${f.fontSize}"${weight} text-anchor="${f.anchor}" fill="black">${escapeXml(f.text)}</text>\n`;
  }
  if (clientLogo) {
    // Constrain logo to the title block box — centered within, never overflows
    const clipId = `logo-clip-${pageNum}`;
    const pad = 80; // padding inside box
    const lx = TB.logoBoxX + pad;
    const ly = TB.logoBoxY + pad;
    const lw = TB.logoBoxW - pad * 2;
    const lh = TB.logoBoxH - pad * 2;
    injection += `<clipPath id="${clipId}"><rect x="${TB.logoBoxX}" y="${TB.logoBoxY}" width="${TB.logoBoxW}" height="${TB.logoBoxH}"/></clipPath>\n`;
    injection += `<image x="${lx}" y="${ly}" width="${lw}" height="${lh}" href="${clientLogo}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${clipId})"/>\n`;
  }

  injection += `<rect x="160" y="13150" width="5750" height="900" fill="white"/>\n`;
  if (revisions && revisions.length > 0) {
    const revStartY = 13280, revLineH = 150, maxRevisions = 5;
    const revsToShow = revisions.slice(-maxRevisions);
    for (let ri = 0; ri < revsToShow.length; ri++) {
      const rev = revsToShow[ri];
      injection += `<text x="200" y="${revStartY + ri * revLineH}" font-family="Arial, sans-serif" font-size="112" fill="black">${escapeXml(`${rev.revision} - ${rev.notes}`)}</text>\n`;
    }
  }

  // Notes — injected into the right panel notes area (heading already on template)
  // Box bounds: x 18500–21100, approx 2600 units wide
  if (notes && notes.trim()) {
    const noteStartY = 9350;
    const noteLineH = 130;
    const noteX = 18600;
    const noteFontSize = 95;
    const noteBoxRight = 21300; // right edge of notes box — pulled in 10% from border
    const maxLineWidth = noteBoxRight - noteX;
    const charsPerLine = Math.floor(maxLineWidth / (noteFontSize * 0.52));

    // Word-wrap each line to fit within the box
    const wrappedLines: string[] = [];
    for (const rawLine of notes.trim().split('\n')) {
      if (rawLine.length <= charsPerLine) {
        wrappedLines.push(rawLine);
      } else {
        const words = rawLine.split(' ');
        let current = '';
        for (const word of words) {
          if ((current + ' ' + word).trim().length > charsPerLine) {
            if (current) wrappedLines.push(current);
            current = word;
          } else {
            current = current ? current + ' ' + word : word;
          }
        }
        if (current) wrappedLines.push(current);
      }
    }

    for (let ni = 0; ni < wrappedLines.length && ni < 14; ni++) {
      injection += `<text x="${noteX}" y="${noteStartY + ni * noteLineH}" font-family="Arial, sans-serif" font-size="${noteFontSize}" fill="black">${escapeXml(wrappedLines[ni])}</text>\n`;
    }
  }

  svgText = svgText.replace('</svg>', injection + '</svg>');
  return svgText;
}

async function renderSvgToPng(svgText: string): Promise<string> {
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('Failed to load SVG')); });
  const canvas = document.createElement('canvas');
  canvas.width = SVG_RENDER_W;
  canvas.height = SVG_RENDER_H;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, SVG_RENDER_W, SVG_RENDER_H);
  URL.revokeObjectURL(url);
  return canvas.toDataURL('image/png');
}

interface CoordMapper { toX(cx: number): number; toY(cy: number): number; toSize(s: number): number; imgX: number; imgY: number; imgW: number; imgH: number; }

function createCoordMapper(pageWidth: number, pageHeight: number, bgWidth: number, bgHeight: number, bgOffsetX = 0, bgOffsetY = 0, bgScale = 1): CoordMapper {
  const planX = pageWidth * PLAN_AREA.xPct;
  const planW = pageWidth * PLAN_AREA.wPct;
  const planH = pageHeight * PLAN_AREA.hPct;
  const planBottomY = pageHeight * (1 - PLAN_AREA.topPct - PLAN_AREA.hPct);
  const scale = Math.min(planW / bgWidth, planH / bgHeight);
  const imgW = bgWidth * scale, imgH = bgHeight * scale;
  const imgX = planX + (planW - imgW) / 2;
  const imgY = planBottomY + (planH - imgH) / 2;
  // Device coords are in canvas space; background is at (bgOffsetX, bgOffsetY) scaled by bgScale.
  // Map device position relative to the scaled background image origin.
  const scaledW = bgWidth * bgScale, scaledH = bgHeight * bgScale;
  return { toX: (cx) => imgX + ((cx - bgOffsetX) / scaledW) * imgW, toY: (cy) => imgY + imgH - ((cy - bgOffsetY) / scaledH) * imgH, toSize: (s) => s * scale, imgX, imgY, imgW, imgH };
}

function drawRunBadge(page: PDFPage, x: number, y: number, label: string, color: ReturnType<typeof rgb>, mapper: CoordMapper, font: PDFFont) {
  const badgeR = mapper.toSize(11);
  page.drawCircle({ x, y, size: badgeR, color: rgb(0.1, 0.1, 0.18), borderColor: color, borderWidth: 0.8 });
  const fontSize = mapper.toSize(7);
  const textW = font.widthOfTextAtSize(label, fontSize);
  page.drawText(label, { x: x - textW / 2, y: y - fontSize / 3, size: fontSize, font, color });
}

const LEGEND_CATEGORY_ORDER: DeviceCategory[] = ['cameras', 'security', 'audio', 'data', 'av'];
const LEGEND_CATEGORY_COLORS: Record<string, ReturnType<typeof rgb>> = {
  cameras: rgb(0.2, 0.6, 1), security: rgb(1, 0.27, 0.27), audio: rgb(0.27, 0.8, 0.27),
  data: rgb(0.2, 0.6, 1), av: rgb(0.2, 0.6, 1),
};
const LEGEND_CATEGORY_NAMES: Record<string, string> = {
  cameras: 'CAMERAS', security: 'SECURITY', audio: 'AUDIO', data: 'DATA / COMMS', av: 'AV / INTERCOM',
};

function drawDynamicLegend(
  page: PDFPage, allDevices: PlacedDevice[], view: PlanView, commsRackId: string | null,
  symbolCache: Map<string, PDFImage>, fontBold: PDFFont, fontRegular: PDFFont,
) {
  const pageH = page.getHeight();
  // Coordinates matched to the template legend area (PDF coords, origin bottom-left)
  // Legend header "LEGEND" sits at y≈130 from top → pageH - 130 from bottom
  // Notes header "NOTES" sits at y≈1076 from top → pageH - 1076 from bottom
  const iconSize = 18;
  const rowHeight = 27;       // matches ~27px spacing between legend items in template
  const iconX = 2249;         // left edge of icon column
  const textX = 2275;         // left edge of text column (tighter to icon)
  const startY = pageH - 155; // first item row (below LEGEND header)
  const minY = pageH - 1050;  // stop before NOTES area
  const fontSize = 11;        // 50% larger than original 7.5

  // Collect unique device types visible on this page view
  // Infrastructure devices (cableType 'none') appear on every page
  const visible = getVisibleDevices(allDevices, view, commsRackId);
  const seen = new Set<string>();
  const deviceIds: string[] = [];
  for (const d of visible) {
    if (d.instanceId === commsRackId) continue;
    if (seen.has(d.deviceId)) continue;
    seen.add(d.deviceId);
    deviceIds.push(d.deviceId);
  }
  for (const d of allDevices) {
    if (seen.has(d.deviceId)) continue;
    const def = getDeviceById(d.deviceId);
    if (def && def.cableType === 'none' && !def.isCommsRack) {
      seen.add(d.deviceId);
      deviceIds.push(d.deviceId);
    }
  }
  if (deviceIds.length === 0) return;

  // Group by category
  const grouped = new Map<DeviceCategory, Array<{ id: string; name: string; symbolImage?: string }>>();
  for (const id of deviceIds) {
    const def = getDeviceById(id);
    if (!def) continue;
    const list = grouped.get(def.category) || [];
    list.push({ id, name: def.name, symbolImage: def.symbolImage });
    grouped.set(def.category, list);
  }

  let y = startY;
  for (const cat of LEGEND_CATEGORY_ORDER) {
    const items = grouped.get(cat);
    if (!items || items.length === 0) continue;

    for (const item of items) {
      if (y - rowHeight < minY) break;

      // Vertically center icon and text within the row
      const rowCenterY = y - rowHeight / 2;

      // Draw symbol image centered on row
      if (item.symbolImage && symbolCache.has(item.symbolImage)) {
        const img = symbolCache.get(item.symbolImage)!;
        page.drawImage(img, { x: iconX, y: rowCenterY - iconSize / 2, width: iconSize, height: iconSize });
      }

      // Draw device name — baseline aligned to icon center
      page.drawText(item.name, { x: textX, y: rowCenterY - fontSize / 3, size: fontSize, font: fontRegular, color: rgb(0, 0, 0) });
      y -= rowHeight;
    }
  }
}

export async function exportToPdf(): Promise<Blob | null> {
  const store = usePlanStore.getState();
  const { titleBlock, clientLogo, revisions } = store;

  const syncedFloors: FloorData[] = store.floors.map(f =>
    f.id === store.activeFloorId
      ? { ...f, backgroundImage: store.backgroundImage, backgroundWidth: store.backgroundWidth, backgroundHeight: store.backgroundHeight, backgroundOffsetX: store.backgroundOffsetX, backgroundOffsetY: store.backgroundOffsetY, backgroundScale: store.backgroundScale, backgroundLocked: store.backgroundLocked, pdfFileName: store.pdfFileName, devices: store.devices, commsRackId: store.commsRackId, whitewashRects: store.whitewashRects }
      : f
  );

  const exportFloors = syncedFloors.filter(f => f.backgroundImage);
  if (exportFloors.length === 0) { alert('No plan loaded. Please upload a floor plan PDF first.'); return null; }

  const multiFloor = exportFloors.length > 1;
  const outputDoc = await PDFDocument.create();
  const fontBold = await outputDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await outputDoc.embedFont(StandardFonts.Helvetica);

  // Collect all devices across all floors for legend
  const allDevicesForLegend: PlacedDevice[] = [];
  const allCommsRackIds: string[] = [];
  for (const f of exportFloors) {
    allDevicesForLegend.push(...f.devices);
    if (f.commsRackId) allCommsRackIds.push(f.commsRackId);
  }

  const symbolCache = new Map<string, PDFImage>();
  const uniqueSymbols = new Set<string>();
  for (const floor of exportFloors) for (const d of floor.devices) { const def = getDeviceById(d.deviceId); if (def?.symbolImage) uniqueSymbols.add(def.symbolImage); }
  for (const symbolPath of uniqueSymbols) {
    try { const bytes = await fetchImageBytes(symbolPath); const img = await outputDoc.embedPng(bytes); symbolCache.set(symbolPath, img); }
    catch (err) { console.warn(`Failed to load symbol ${symbolPath}:`, err); }
  }

  function getFloorSpeakerZones(f: FloorData): Set<number> {
    const zones = new Set<number>();
    for (const d of f.devices) { const def = getDeviceById(d.deviceId); if (def?.cableType === 'speaker') zones.add(d.speakerZone || 1); }
    return zones;
  }
  const floorZoneSets = exportFloors.map(f => ({ id: f.id, zones: getFloorSpeakerZones(f) }));
  const zoneLinksUp: Map<string, Set<number>> = new Map();
  const zoneLinksDown: Map<string, Set<number>> = new Map();
  for (let i = 0; i < floorZoneSets.length; i++) {
    const up = new Set<number>(), down = new Set<number>();
    if (i > 0) for (const z of floorZoneSets[i].zones) if (floorZoneSets[i - 1].zones.has(z)) up.add(z);
    if (i < floorZoneSets.length - 1) for (const z of floorZoneSets[i].zones) if (floorZoneSets[i + 1].zones.has(z)) down.add(z);
    zoneLinksUp.set(floorZoneSets[i].id, up);
    zoneLinksDown.set(floorZoneSets[i].id, down);
  }

  const { NUMBERED_GROUPS } = await import('@/types/plan-builder');
  const speakerGroupIds = NUMBERED_GROUPS['speakers'] || [];
  // For cameras/PIRs: running count across floors
  // For speakers: running count per zone across floors
  const floorLabelOffsets: Map<string, Record<string, number>> = new Map();
  const floorSpeakerZoneOffsets: Map<string, Map<number, number>> = new Map();
  const runningGroupCounts: Record<string, number> = {};
  const runningZoneCounts: Map<number, number> = new Map();
  for (const floor of exportFloors) {
    const offsets: Record<string, number> = {};
    for (const groupName of Object.keys(NUMBERED_GROUPS)) {
      if (groupName === 'speakers') continue; // handled per-zone
      offsets[groupName] = runningGroupCounts[groupName] || 0;
    }
    floorLabelOffsets.set(floor.id, offsets);
    floorSpeakerZoneOffsets.set(floor.id, new Map(runningZoneCounts));

    for (const [groupName, groupIds] of Object.entries(NUMBERED_GROUPS)) {
      if (groupName === 'speakers') {
        // Count per zone
        for (const d of floor.devices) {
          if (!groupIds.includes(d.deviceId)) continue;
          const zone = d.speakerZone || 1;
          runningZoneCounts.set(zone, (runningZoneCounts.get(zone) || 0) + 1);
        }
      } else {
        const count = floor.devices.filter(d => groupIds.includes(d.deviceId)).length;
        runningGroupCounts[groupName] = (runningGroupCounts[groupName] || 0) + count;
      }
    }
  }

  for (const floor of exportFloors) {
    const bgBytes = await dataUrlToBytes(floor.backgroundImage!);
    const bgImage = isPngDataUrl(floor.backgroundImage!) ? await outputDoc.embedPng(bgBytes) : await outputDoc.embedJpg(bgBytes);
    const { devices, commsRackId, whitewashRects } = floor;
    const labelOffsets = floorLabelOffsets.get(floor.id) || {};

    for (const pageDef of DEVICE_PAGES) {
      // Skip non-master pages that have no cable-run devices (only comms rack or empty)
      if (pageDef.view !== 'master') {
        const preCheck = getVisibleDevices(devices, pageDef.view, commsRackId);
        const hasCableDevices = preCheck.some(d => d.instanceId !== commsRackId);
        if (!hasCableDevices) continue;
      }

      const svgText = await loadAndInjectSvg(pageDef.svgPage, titleBlock, clientLogo, revisions, titleBlock.notes);
      const templatePng = await renderSvgToPng(svgText);
      const templateBytes = await dataUrlToBytes(templatePng);
      const templateImage = await outputDoc.embedPng(templateBytes);
      const page = outputDoc.addPage([PDF_PAGE_W, PDF_PAGE_H]);
      const pageW = page.getWidth(), pageH = page.getHeight();
      page.drawImage(templateImage, { x: 0, y: 0, width: pageW, height: pageH });
      const mapper = createCoordMapper(pageW, pageH, floor.backgroundWidth, floor.backgroundHeight, floor.backgroundOffsetX ?? 0, floor.backgroundOffsetY ?? 0, floor.backgroundScale ?? 1);
      page.drawImage(bgImage, { x: mapper.imgX, y: mapper.imgY, width: mapper.imgW, height: mapper.imgH });

      for (const wr of whitewashRects) {
        page.drawRectangle({ x: mapper.toX(wr.x), y: mapper.toY(wr.y + wr.height), width: mapper.toSize(wr.width), height: mapper.toSize(wr.height), color: rgb(1, 1, 1) });
      }

      const visibleDevices = getVisibleDevices(devices, pageDef.view, commsRackId);
      const dScale = usePlanStore.getState().deviceScale;

      if (pageDef.view !== 'master') {
        for (const device of visibleDevices) {
          if (device.instanceId === commsRackId) continue;
          page.drawCircle({ x: mapper.toX(device.x), y: mapper.toY(device.y), size: mapper.toSize(COVERAGE_RADIUS * dScale), color: rgb(1, 0.59, 0.59), opacity: 0.22, borderColor: rgb(1, 0.59, 0.59), borderWidth: 1, borderOpacity: 0.45 });
        }
      }

      const rackDevice = commsRackId ? devices.find(d => d.instanceId === commsRackId) : null;
      const hasLinksUp = (zoneLinksUp.get(floor.id)?.size || 0) > 0;
      if (pageDef.view === 'speaker' && (rackDevice || hasLinksUp)) {
        const speakerDevices = devices.filter(d => { if (d.instanceId === commsRackId) return false; const def = getDeviceById(d.deviceId); return def?.cableType === 'speaker'; });
        const zoneMap = new Map<number, PlacedDevice[]>();
        for (const d of speakerDevices) { const zone = d.speakerZone || 1; if (!zoneMap.has(zone)) zoneMap.set(zone, []); zoneMap.get(zone)!.push(d); }
        const zoneColors = ['#44cc44', '#22aaff', '#ff8844', '#cc44ff', '#ffcc00', '#ff4488'];
        const linksUp = zoneLinksUp.get(floor.id) || new Set();
        const linksDown = zoneLinksDown.get(floor.id) || new Set();

        for (const [zone, zoneSpeakers] of zoneMap) {
          const comesFromPrevFloor = linksUp.has(zone);
          const goesToNextFloor = linksDown.has(zone);
          const zoneColor = hexToRgb(zoneColors[(zone - 1) % zoneColors.length]);
          const zoneLabel = String.fromCharCode(64 + zone);
          let prevX: number, prevY: number, startIdx: number, chain: PlacedDevice[];

          // Volume controls go first in the chain (inline before speakers)
          const volumeControls = zoneSpeakers.filter(d => { const def = getDeviceById(d.deviceId); return def?.isVolumeControl; });
          const speakers = zoneSpeakers.filter(d => { const def = getDeviceById(d.deviceId); return !def?.isVolumeControl; });

          if (comesFromPrevFloor) {
            const first = zoneSpeakers[0];
            const vcChain = buildDaisyChain(volumeControls, first.x, first.y);
            const lastVc = vcChain[vcChain.length - 1];
            const spkChain = buildDaisyChain(speakers, lastVc?.x ?? first.x, lastVc?.y ?? first.y);
            chain = [...vcChain, ...spkChain];
            prevX = mapper.toX(chain[0].x); prevY = mapper.toY(chain[0].y); startIdx = 1;
          } else if (rackDevice) {
            const vcChain = buildDaisyChain(volumeControls, rackDevice.x, rackDevice.y);
            const lastVc = vcChain[vcChain.length - 1];
            const spkChain = buildDaisyChain(speakers, lastVc?.x ?? rackDevice.x, lastVc?.y ?? rackDevice.y);
            chain = [...vcChain, ...spkChain];
            prevX = mapper.toX(rackDevice.x); prevY = mapper.toY(rackDevice.y); startIdx = 0;
          } else {
            const first = zoneSpeakers[0];
            chain = buildDaisyChain(zoneSpeakers, first.x, first.y);
            prevX = mapper.toX(chain[0].x); prevY = mapper.toY(chain[0].y); startIdx = 1;
          }

          for (let si = startIdx; si < chain.length; si++) {
            const chainDevice = chain[si]; const dx = mapper.toX(chainDevice.x); const dy = mapper.toY(chainDevice.y);
            page.drawLine({ start: { x: prevX, y: prevY }, end: { x: dx, y: dy }, thickness: 2.5, color: zoneColor, opacity: 0.8 });
            prevX = dx; prevY = dy;
          }

          if (comesFromPrevFloor && chain.length > 0) {
            const first = chain[0]; const fx = mapper.toX(first.x); const fy = mapper.toY(first.y);
            const noteSize = mapper.toSize(18); const noteText = 'LINK FROM PREVIOUS LEVEL';
            const noteW = fontBold.widthOfTextAtSize(noteText, noteSize); const noteBoxH = noteSize + 6;
            const noteY = fy + mapper.toSize(SYMBOL_SIZE) + mapper.toSize(50);
            page.drawLine({ start: { x: fx, y: fy + mapper.toSize(SYMBOL_SIZE / 2) }, end: { x: fx, y: noteY }, thickness: 0.8, color: zoneColor, dashArray: [3, 2] });
            page.drawRectangle({ x: fx - noteW / 2 - 4, y: noteY - 1, width: noteW + 8, height: noteBoxH, color: rgb(1, 1, 1), borderColor: zoneColor, borderWidth: 0.8 });
            page.drawText(noteText, { x: fx - noteW / 2, y: noteY + 2, size: noteSize, font: fontBold, color: zoneColor });
          }
          if (goesToNextFloor && chain.length > 0) {
            const last = chain[chain.length - 1]; const lx2 = mapper.toX(last.x); const ly2 = mapper.toY(last.y);
            const noteSize = mapper.toSize(18); const noteText = 'LINK TO NEXT LEVEL';
            const noteW = fontBold.widthOfTextAtSize(noteText, noteSize); const noteBoxH = noteSize + 6;
            const noteY = ly2 + mapper.toSize(SYMBOL_SIZE) + mapper.toSize(50);
            page.drawLine({ start: { x: lx2, y: ly2 + mapper.toSize(SYMBOL_SIZE / 2) }, end: { x: lx2, y: noteY }, thickness: 0.8, color: zoneColor, dashArray: [3, 2] });
            page.drawRectangle({ x: lx2 - noteW / 2 - 4, y: noteY - 1, width: noteW + 8, height: noteBoxH, color: rgb(1, 1, 1), borderColor: zoneColor, borderWidth: 0.8 });
            page.drawText(noteText, { x: lx2 - noteW / 2, y: noteY + 2, size: noteSize, font: fontBold, color: zoneColor });
          }
        }
      }

      for (const device of visibleDevices) {
        const def = getDeviceById(device.deviceId); if (!def) continue;
        const px = mapper.toX(device.x); const py = mapper.toY(device.y);
        const sz = mapper.toSize(SYMBOL_SIZE * (def.symbolScale || 1) * dScale);
        if (def.symbolImage && symbolCache.has(def.symbolImage)) {
          const img = symbolCache.get(def.symbolImage)!;
          if (device.rotation && device.rotation !== 0) {
            const angle = -device.rotation; const rad = (angle * Math.PI) / 180;
            const cos = Math.cos(rad); const sin = Math.sin(rad);
            const ddx = -sz / 2; const ddy = -sz / 2;
            page.drawImage(img, { x: px + ddx * cos - ddy * sin, y: py + ddx * sin + ddy * cos, width: sz, height: sz, rotate: degrees(angle) });
          } else {
            page.drawImage(img, { x: px - sz / 2, y: py - sz / 2, width: sz, height: sz });
          }
        } else if (def.symbolType === 'comms-rack') {
          const rackW = sz * 1.7; const rackH = sz * 2;
          page.drawRectangle({ x: px - rackW / 2, y: py - rackH / 2, width: rackW, height: rackH, color: hexToRgb(def.fillColor || '#334455'), borderColor: hexToRgb(def.strokeColor || '#66aaff'), borderWidth: 1.5 });
          const rackFontSize = sz * 0.3; const rackLabelW = fontBold.widthOfTextAtSize('RACK', rackFontSize);
          page.drawText('RACK', { x: px - rackLabelW / 2, y: py - rackH / 2 + rackFontSize * 0.5, size: rackFontSize, font: fontBold, color: hexToRgb(def.strokeColor || '#66aaff') });
        } else {
          page.drawCircle({ x: px, y: py, size: sz / 2, color: hexToRgb(def.fillColor || '#888888'), borderColor: hexToRgb(def.strokeColor || '#ffffff'), borderWidth: 1 });
        }

        if (pageDef.view !== 'master' && device.labelNum && device.labelNum > 0 && device.instanceId !== commsRackId) {
          let globalNum = device.labelNum;
          if (speakerGroupIds.includes(device.deviceId)) {
            // Speakers: offset by zone count from previous floors
            const zoneOffsets = floorSpeakerZoneOffsets.get(floor.id);
            const zone = device.speakerZone || 1;
            globalNum = device.labelNum + (zoneOffsets?.get(zone) || 0);
          } else {
            for (const [groupName, groupIds] of Object.entries(NUMBERED_GROUPS)) {
              if (groupIds.includes(device.deviceId)) { globalNum = device.labelNum + (labelOffsets[groupName] || 0); break; }
            }
          }
          const labelText = String(globalNum);
          const labelSize = mapper.toSize(40 * dScale);
          const bubbleR = mapper.toSize(32 * dScale);
          // Position label center on the edge of the coverage circle, in the device's facing direction
          // Device PNGs face RIGHT at rotation 0. Konva rotation is CW in screen coords (Y-down).
          // Rotating the "right" vector (1, 0) by θ: x' = cos(θ), y' = sin(θ)
          const rotRad = ((device.rotation || 0) * Math.PI) / 180;
          const canvasLabelX = device.x + COVERAGE_RADIUS * dScale * Math.cos(rotRad);
          const canvasLabelY = device.y + COVERAGE_RADIUS * dScale * Math.sin(rotRad);
          const bubbleX = mapper.toX(canvasLabelX);
          const bubbleY = mapper.toY(canvasLabelY);
          page.drawCircle({ x: bubbleX, y: bubbleY, size: bubbleR, color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 2 });
          const labelW = fontBold.widthOfTextAtSize(labelText, labelSize);
          page.drawText(labelText, { x: bubbleX - labelW / 2, y: bubbleY - labelSize * 0.35, size: labelSize, font: fontBold, color: rgb(0, 0, 0) });
        }

        // Concrete mounted badge
        if (device.concreteMounted && pageDef.view !== 'master') {
          const cBadgeR = mapper.toSize(12 * dScale);
          const cBadgeX = px + sz / 2 + cBadgeR * 0.3;
          const cBadgeY = py - sz / 2 - cBadgeR * 0.3;
          page.drawCircle({ x: cBadgeX, y: cBadgeY, size: cBadgeR, color: rgb(0.2, 0.6, 1), borderColor: rgb(1, 1, 1), borderWidth: 0.5 });
          const cSize = cBadgeR * 1.2;
          const cW = fontBold.widthOfTextAtSize('C', cSize);
          page.drawText('C', { x: cBadgeX - cW / 2, y: cBadgeY - cSize * 0.35, size: cSize, font: fontBold, color: rgb(1, 1, 1) });
        }

        // Provisional label
        if (device.provisional && pageDef.view !== 'master') {
          const provText = 'Provisional Cable Run Only';
          const provSize = mapper.toSize(18);
          const provW = fontBold.widthOfTextAtSize(provText, provSize);
          const provBoxH = provSize + 6;
          const provY = py - sz / 2 - mapper.toSize(20) - provBoxH;
          page.drawRectangle({ x: px - provW / 2 - 4, y: provY, width: provW + 8, height: provBoxH, color: rgb(1, 1, 1), borderColor: rgb(0.95, 0.6, 0.1), borderWidth: 0.8 });
          page.drawText(provText, { x: px - provW / 2, y: provY + 2, size: provSize, font: fontBold, color: rgb(0.95, 0.6, 0.1) });
        }
      }

      if (multiFloor) {
        const headingText = floor.name.toUpperCase(); const headingSize = 24;
        const headingW = fontBold.widthOfTextAtSize(headingText, headingSize);
        const planCentreX = pageW * (PLAN_AREA.xPct + PLAN_AREA.wPct / 2);
        const headingY = pageH * (1 - PLAN_AREA.topPct) - 10;
        page.drawRectangle({ x: planCentreX - headingW / 2 - 12, y: headingY - 6, width: headingW + 24, height: headingSize + 12, color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 0.8 });
        page.drawText(headingText, { x: planCentreX - headingW / 2, y: headingY + 2, size: headingSize, font: fontBold, color: rgb(0, 0, 0) });
      }

      // Dynamic legend — auto-populated from devices on the plan
      drawDynamicLegend(page, allDevicesForLegend, pageDef.view, commsRackId, symbolCache, fontBold, fontRegular);
    }
  }

  for (let p = 5; p <= TOTAL_TEMPLATE_PAGES; p++) {
    try {
      const svgText = await loadAndInjectSvg(p, titleBlock, clientLogo, revisions, titleBlock.notes);
      const templatePng = await renderSvgToPng(svgText);
      const templateBytes = await dataUrlToBytes(templatePng);
      const templateImage = await outputDoc.embedPng(templateBytes);
      const page = outputDoc.addPage([PDF_PAGE_W, PDF_PAGE_H]);
      page.drawImage(templateImage, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      // Dynamic legend on every page
      drawDynamicLegend(page, allDevicesForLegend, 'master', null, symbolCache, fontBold, fontRegular);
    } catch (err) { console.warn(`Failed to render static template page ${p}:`, err); }
  }

  const pdfBytes = await outputDoc.save();
  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const filenameParts = [titleBlock.state, titleBlock.client, titleBlock.projectName, titleBlock.revision, titleBlock.date].filter(Boolean);
  a.download = filenameParts.length > 0 ? `${filenameParts.join(' - ').replace(/[^a-zA-Z0-9\-_ \/]/g, '')}.pdf` : 'centrefit-plan.pdf';
  a.click();
  URL.revokeObjectURL(url);

  return blob;
}
