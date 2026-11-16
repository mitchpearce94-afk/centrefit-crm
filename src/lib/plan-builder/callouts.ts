import { Callout, PlacedDevice } from '@/types/plan-builder';

/** Shared geometry for on-plan note boxes — editor, PDF export and job plan view all use the same wrap/box/arrow maths. */
export const CALLOUT_FONT = 9;       // × deviceScale
export const CALLOUT_PAD = 4;        // × deviceScale
export const CALLOUT_LINE = 1.25;    // line-height multiplier

/** Rough word-wrap so the box height matches what Konva/pdf-lib will draw. */
export function wrapCalloutText(text: string, widthPx: number, fontPx: number, measure?: (s: string) => number): string[] {
  const w = measure ?? ((s: string) => s.length * fontPx * 0.52);
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const words = raw.split(' ');
    let cur = '';
    for (const word of words) {
      const next = cur ? cur + ' ' + word : word;
      if (w(next) > widthPx && cur) { out.push(cur); cur = word; }
      else cur = next;
    }
    out.push(cur);
  }
  return out;
}

export function calloutBox(c: Callout, dScale: number, measure?: (s: string) => number) {
  const font = CALLOUT_FONT * dScale, pad = CALLOUT_PAD * dScale;
  const lines = wrapCalloutText(c.text || ' ', c.width - pad * 2, font, measure);
  const height = lines.length * font * CALLOUT_LINE + pad * 2;
  return { font, pad, lines, width: c.width, height };
}

/** Arrow start = the box edge midpoint closest to the target; end = target pulled back by `gap`. */
export function calloutArrow(c: Callout, box: { width: number; height: number }, target: { x: number; y: number }, gap: number) {
  const mids = [
    { x: c.x + box.width / 2, y: c.y },               // top
    { x: c.x + box.width / 2, y: c.y + box.height },  // bottom
    { x: c.x, y: c.y + box.height / 2 },              // left
    { x: c.x + box.width, y: c.y + box.height / 2 },  // right
  ];
  let start = mids[0], best = Infinity;
  for (const m of mids) { const d = (m.x - target.x) ** 2 + (m.y - target.y) ** 2; if (d < best) { best = d; start = m; } }
  const dx = target.x - start.x, dy = target.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const end = { x: target.x - (dx / len) * gap, y: target.y - (dy / len) * gap };
  return { start, end };
}

export function calloutTarget(c: Callout, devices: PlacedDevice[]): { x: number; y: number } | null {
  if (c.targetInstanceId) {
    const d = devices.find(dv => dv.instanceId === c.targetInstanceId);
    if (d) return { x: d.x, y: d.y };
  }
  if (c.tx !== undefined && c.ty !== undefined) return { x: c.tx, y: c.ty };
  return null;
}

