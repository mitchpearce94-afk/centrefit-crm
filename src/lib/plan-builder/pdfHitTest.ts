import { PdfElement } from '@/types/plan-builder';

/**
 * Ink-accurate hit testing for extracted PDF elements — the Serif/Affinity
 * feel. Path leaves are tested against their REAL geometry with the browser's
 * native isPointInStroke / isPointInPath (a diagonal line only hits ON the
 * line, a hollow rectangle only on its border). Text/images fall back to
 * their (tight) bboxes.
 */

const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 };

// Scratch context for the native point-in-path tests.
let scratch: CanvasRenderingContext2D | null = null;
function getScratch(): CanvasRenderingContext2D | null {
  if (scratch) return scratch;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  scratch = c.getContext('2d');
  return scratch;
}

// Path2D objects are built lazily from each element's packed draw-ops and
// cached — extraction stays serialisable, hit-testing stays fast.
const pathCache = new Map<string, Path2D>();
export function clearPathCache() {
  pathCache.clear();
}

export function getPath2D(el: PdfElement): Path2D | null {
  if (!el.geometry?.drawOps?.length) return null;
  let p = pathCache.get(el.id);
  if (p) return p;
  p = new Path2D();
  const d = el.geometry.drawOps;
  for (let i = 0; i < d.length; ) {
    switch (d[i++]) {
      case DRAW.moveTo: p.moveTo(d[i++], d[i++]); break;
      case DRAW.lineTo: p.lineTo(d[i++], d[i++]); break;
      case DRAW.curveTo: p.bezierCurveTo(d[i++], d[i++], d[i++], d[i++], d[i++], d[i++]); break;
      case DRAW.quadraticCurveTo: p.quadraticCurveTo(d[i++], d[i++], d[i++], d[i++]); break;
      case DRAW.closePath: p.closePath(); break;
      default: return p; // unknown op — stop rather than misread the stream
    }
  }
  pathCache.set(el.id, p);
  return p;
}

function ctmScale(m: [number, number, number, number, number, number]): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
}

/** Does the cursor actually touch this leaf's ink? */
function hitsInk(el: PdfElement, x: number, y: number, tolCanvasPx: number): boolean {
  const geo = el.geometry;
  if (!geo) {
    // Text/images: tight bbox with thin-dimension tolerance (legacy feel).
    const { bbox } = el;
    const padX = bbox.width < tolCanvasPx ? (tolCanvasPx - bbox.width) / 2 : 0;
    const padY = bbox.height < tolCanvasPx ? (tolCanvasPx - bbox.height) / 2 : 0;
    return (
      x >= bbox.x - padX && x <= bbox.x + bbox.width + padX &&
      y >= bbox.y - padY && y <= bbox.y + bbox.height + padY
    );
  }
  const ctx = getScratch();
  const path = getPath2D(el);
  if (!ctx || !path) {
    // No native testing available — bbox fallback.
    const { bbox } = el;
    return x >= bbox.x && x <= bbox.x + bbox.width && y >= bbox.y && y <= bbox.y + bbox.height;
  }

  ctx.setTransform(geo.ctm[0], geo.ctm[1], geo.ctm[2], geo.ctm[3], geo.ctm[4], geo.ctm[5]);
  try {
    if (geo.fills && ctx.isPointInPath(path, x, y)) return true;
    if (geo.strokes) {
      // Tolerance is in canvas px; lineWidth applies in path space.
      const tolPathUnits = tolCanvasPx / ctmScale(geo.ctm);
      ctx.lineWidth = Math.max(geo.lineWidth, tolPathUnits * 2);
      if (ctx.isPointInStroke(path, x, y)) return true;
    }
    // Fill-only shapes also get a thin edge-grab so hollow-looking fills with
    // hairline area are still pickable on their outline.
    if (geo.fills && !geo.strokes) {
      ctx.lineWidth = (tolCanvasPx / ctmScale(geo.ctm)) * 2;
      if (ctx.isPointInStroke(path, x, y)) return true;
    }
  } finally {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  return false;
}

export interface HitCandidate {
  /** The id to select at the CURRENT level (group id, or leaf id when drilled into that group). */
  selectId: string;
  /** The actual leaf under the cursor (for drill-down on double-click). */
  leaf: PdfElement;
  /** Top-level parent group, if the leaf lives inside one. */
  parent: PdfElement | null;
}

/**
 * All elements under the cursor, ordered best-first (smallest ink bbox wins —
 * the thing visually "on top of the pile" for plan drawings). `drilledGroupId`
 * switches selection from group level to leaf level inside that group,
 * matching Serif's click-selects-group / double-click-enters-group model.
 *
 * `screenTolerancePx / stageScale` should be passed as `tolCanvasPx` so the
 * grab distance feels constant regardless of zoom.
 */
export function hitTest(
  x: number,
  y: number,
  elements: PdfElement[],
  tolCanvasPx: number,
  drilledGroupId: string | null,
): HitCandidate[] {
  const candidates: { cand: HitCandidate; area: number }[] = [];

  const tryLeaf = (leaf: PdfElement, parent: PdfElement | null) => {
    // Broad phase: padded bbox; narrow phase: real ink.
    const { bbox } = leaf;
    const pad = tolCanvasPx;
    if (
      x < bbox.x - pad || x > bbox.x + bbox.width + pad ||
      y < bbox.y - pad || y > bbox.y + bbox.height + pad
    ) return;
    if (!hitsInk(leaf, x, y, tolCanvasPx)) return;

    const drilled = parent !== null && parent.id === drilledGroupId;
    candidates.push({
      cand: {
        selectId: parent && !drilled ? parent.id : leaf.id,
        leaf,
        parent,
      },
      area: Math.max(bbox.width * bbox.height, 1),
    });
  };

  for (const el of elements) {
    if (el.children?.length) {
      for (const child of el.children) tryLeaf(child, el);
    } else {
      tryLeaf(el, null);
    }
  }

  candidates.sort((a, b) => a.area - b.area);

  // De-dupe by selectId (a group hit via several of its leaves is one candidate).
  const seen = new Set<string>();
  const out: HitCandidate[] = [];
  for (const { cand } of candidates) {
    if (seen.has(cand.selectId)) continue;
    seen.add(cand.selectId);
    out.push(cand);
  }
  return out;
}
