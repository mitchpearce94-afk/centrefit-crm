import { PdfElement, PdfElementGeometry } from '@/types/plan-builder';

// pdf.js OPS constants — exact values from pdfjs-dist v5.5.207
const OPS = {
  setLineWidth: 2,
  save: 10,
  restore: 11,
  transform: 12,
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  clip: 29,
  eoClip: 30,
  beginText: 31,
  endText: 32,
  setFont: 37,
  setTextRenderingMode: 38,
  setTextRise: 39,
  moveText: 40,
  setLeadingMoveText: 41,
  setTextMatrix: 42,
  showText: 44,
  showSpacedText: 45,
  nextLineShowText: 46,
  nextLineSetSpacingShowText: 47,
  setStrokeColor: 52,
  setStrokeColorN: 53,
  setFillColor: 54,
  setFillColorN: 55,
  setStrokeGray: 56,
  setFillGray: 57,
  setStrokeRGBColor: 58,
  setFillRGBColor: 59,
  setStrokeCMYKColor: 60,
  setFillCMYKColor: 61,
  paintXObject: 66,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  paintImageMaskXObject: 83,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  constructPath: 91,
};

// pdf.js DrawOPS — the packed path encoding used in constructPath args
const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 };

const STROKE_OPS = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
const FILL_OPS = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
const PATH_RENDER_OPS = new Set([...STROKE_OPS, ...FILL_OPS, OPS.endPath]);
const LEGACY_PATH_OPS = new Set([OPS.moveTo, OPS.lineTo, OPS.curveTo, OPS.curveTo2, OPS.curveTo3, OPS.closePath, OPS.rectangle]);
const SHOW_TEXT_OPS = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);
const IMAGE_OPS = new Set([OPS.paintXObject, OPS.paintImageXObject, OPS.paintImageMaskXObject, OPS.paintInlineImageXObject]);
const STROKE_COLOR_OPS = new Set([OPS.setStrokeColor, OPS.setStrokeColorN, OPS.setStrokeGray, OPS.setStrokeRGBColor, OPS.setStrokeCMYKColor]);
const FILL_COLOR_OPS = new Set([OPS.setFillColor, OPS.setFillColorN, OPS.setFillGray, OPS.setFillRGBColor, OPS.setFillCMYKColor]);

type Mat = [number, number, number, number, number, number];

function matMul(m1: Mat, m2: ArrayLike<number>): Mat {
  // Row-vector convention as used by PDF / canvas: result = m2 ∘ m1
  return [
    m2[0] * m1[0] + m2[1] * m1[2],
    m2[0] * m1[1] + m2[1] * m1[3],
    m2[2] * m1[0] + m2[3] * m1[2],
    m2[2] * m1[1] + m2[3] * m1[3],
    m2[4] * m1[0] + m2[5] * m1[2] + m1[4],
    m2[4] * m1[1] + m2[5] * m1[3] + m1[5],
  ];
}

function applyMat(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

interface GfxState {
  ctm: Mat;
  lineWidth: number;
  strokeColor: string;
  fillColor: string;
}

interface BBoxReader {
  length: number;
  isEmpty(i: number): boolean;
  minX(i: number): number;
  minY(i: number): number;
  maxX(i: number): number;
  maxY(i: number): number;
}

interface TextContentItem {
  str: string;
}

/**
 * Extract selectable elements from a PDF page's operator list — Serif/Affinity
 * model: one element per AUTHORED object (a multi-subpath path is ONE thing),
 * form XObjects become groups you can drill into, and runs of small adjacent
 * paths (flattened CAD symbols — a door, a toilet) are clustered into pseudo-
 * groups. Each path leaf carries its exact geometry + CTM so hit-testing and
 * highlighting work against the real ink, not the bounding box.
 */
export function extractElements(
  operatorList: { fnArray: number[]; argsArray: any[] },
  bboxReader: BBoxReader,
  textContent: { items: any[] },
  canvasWidth: number,
  canvasHeight: number,
  viewportTransform: ArrayLike<number>,
): PdfElement[] {
  const { fnArray, argsArray } = operatorList;
  const pageArea = canvasWidth * canvasHeight;
  const maxDim = Math.max(canvasWidth, canvasHeight);
  let elementCounter = 0;
  const nextId = () => `el-${elementCounter++}`;

  const textItems: TextContentItem[] = textContent.items.filter(
    (item: any) => typeof item.str === 'string' && item.str.trim().length > 0,
  );
  let textItemIndex = 0;

  // Graphics state walk — mirrors what the renderer does so each element's
  // geometry can be mapped from path space to canvas device pixels.
  let gfx: GfxState = {
    ctm: [
      viewportTransform[0], viewportTransform[1], viewportTransform[2],
      viewportTransform[3], viewportTransform[4], viewportTransform[5],
    ],
    lineWidth: 1,
    strokeColor: 'k',
    fillColor: 'k',
  };
  const gfxStack: GfxState[] = [];

  // Collector frames: the root list, plus one frame per open form XObject.
  interface Frame { elements: PdfElement[]; startIdx: number }
  const root: Frame = { elements: [], startIdx: 0 };
  const frames: Frame[] = [root];
  const top = () => frames[frames.length - 1];

  const recordedBBox = (indices: number[]) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasAny = false;
    for (const idx of indices) {
      if (idx >= bboxReader.length || bboxReader.isEmpty(idx)) continue;
      hasAny = true;
      minX = Math.min(minX, bboxReader.minX(idx) * canvasWidth);
      minY = Math.min(minY, bboxReader.minY(idx) * canvasHeight);
      maxX = Math.max(maxX, bboxReader.maxX(idx) * canvasWidth);
      maxY = Math.max(maxY, bboxReader.maxY(idx) * canvasHeight);
    }
    if (!hasAny) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  };

  const keepBBox = (bbox: { x: number; y: number; width: number; height: number } | null) => {
    if (!bbox) return false;
    if (bbox.width * bbox.height > pageArea * 0.85) return false; // background fill
    if (bbox.width < 0.5 && bbox.height < 0.5) return false;      // sub-pixel noise
    if (bbox.width * bbox.height < 1) return false;
    return true;
  };

  /** Device-space bbox from path-space minMax via the current CTM (fallback when no recorded bbox). */
  const bboxFromMinMax = (minMax: ArrayLike<number>, ctm: Mat, strokePad: number) => {
    const corners = [
      applyMat(ctm, minMax[0], minMax[1]),
      applyMat(ctm, minMax[2], minMax[1]),
      applyMat(ctm, minMax[0], minMax[3]),
      applyMat(ctm, minMax[2], minMax[3]),
    ];
    const xs = corners.map(c => c[0]);
    const ys = corners.map(c => c[1]);
    const minX = Math.min(...xs) - strokePad;
    const minY = Math.min(...ys) - strokePad;
    return {
      x: minX,
      y: minY,
      width: Math.max(...xs) + strokePad - minX,
      height: Math.max(...ys) + strokePad - minY,
    };
  };

  const ctmScale = (m: Mat) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

  const makePathLeaf = (
    opIndices: number[],
    drawOps: number[] | null,
    renderOp: number,
    ctm: Mat,
    minMax: ArrayLike<number> | null,
  ): PdfElement | null => {
    if (renderOp === OPS.endPath) return null; // clip-only path, no ink
    const strokes = STROKE_OPS.has(renderOp);
    const fills = FILL_OPS.has(renderOp);
    if (!strokes && !fills) return null;

    const strokePad = strokes ? (gfx.lineWidth * ctmScale(ctm)) / 2 : 0;
    const bbox = recordedBBox(opIndices)
      ?? (minMax ? bboxFromMinMax(minMax, ctm, strokePad) : null);
    if (!keepBBox(bbox)) return null;

    const geometry: PdfElementGeometry | undefined = drawOps && drawOps.length > 0
      ? {
          drawOps,
          ctm,
          lineWidth: gfx.lineWidth,
          strokes,
          fills,
          styleKey: `${strokes ? gfx.strokeColor : ''}|${fills ? gfx.fillColor : ''}|${gfx.lineWidth.toFixed(3)}|${strokes ? 's' : ''}${fills ? 'f' : ''}`,
        }
      : undefined;

    return { id: nextId(), type: 'path', label: 'Shape', opIndices, bbox: bbox!, geometry };
  };

  let i = 0;
  while (i < fnArray.length) {
    const op = fnArray[i];
    const args = argsArray[i];

    // ── Graphics state ──────────────────────────────────────────────
    if (op === OPS.save) { gfxStack.push({ ...gfx, ctm: [...gfx.ctm] as Mat }); i++; continue; }
    if (op === OPS.restore) { gfx = gfxStack.pop() ?? gfx; i++; continue; }
    if (op === OPS.transform) { gfx.ctm = matMul(gfx.ctm, args as number[]); i++; continue; }
    if (op === OPS.setLineWidth) { gfx.lineWidth = Number(args?.[0]) || 1; i++; continue; }
    if (STROKE_COLOR_OPS.has(op)) { gfx.strokeColor = safeStyle(args); i++; continue; }
    if (FILL_COLOR_OPS.has(op)) { gfx.fillColor = safeStyle(args); i++; continue; }

    // ── Text block: BT … ET → one element ──────────────────────────
    if (op === OPS.beginText) {
      const opIndices: number[] = [];
      const showTextIndices: number[] = [];
      let textLabel = '';
      while (i < fnArray.length && fnArray[i] !== OPS.endText) {
        opIndices.push(i);
        if (SHOW_TEXT_OPS.has(fnArray[i])) {
          showTextIndices.push(i);
          if (textItemIndex < textItems.length) {
            if (textLabel) textLabel += ' ';
            textLabel += textItems[textItemIndex].str;
            textItemIndex++;
          }
        }
        i++;
      }
      if (i < fnArray.length) { opIndices.push(i); i++; } // ET
      // Tight bbox from the show-text ops only — state ops (moveText etc.)
      // have recorded bboxes spanning "where the cursor moved", which would
      // inflate the highlight to half the page.
      const bbox = showTextIndices.length > 0 ? recordedBBox(showTextIndices) : recordedBBox(opIndices);
      if (keepBBox(bbox)) {
        top().elements.push({
          id: nextId(),
          type: 'text',
          label: textLabel.trim().substring(0, 80) || 'Text',
          opIndices,
          bbox: bbox!,
        });
      }
      continue;
    }

    // ── Images ──────────────────────────────────────────────────────
    if (IMAGE_OPS.has(op)) {
      const bbox = recordedBBox([i]);
      if (keepBBox(bbox)) {
        top().elements.push({ id: nextId(), type: 'image', label: 'Image', opIndices: [i], bbox: bbox! });
      }
      i++;
      continue;
    }

    // ── constructPath: one authored object, geometry included ───────
    if (op === OPS.constructPath) {
      // args = [renderOp, data, minMax]; data[0] is the packed DrawOPS array
      // (or a Path2D if this operator list was already consumed by a render —
      // in that case we keep bbox-only behaviour for the element).
      const renderOp: number = args?.[0];
      const data = args?.[1];
      const minMax = args?.[2] ?? null;
      const raw = data?.[0];
      const drawOps: number[] | null =
        raw && typeof (raw as any).length === 'number' && !(typeof Path2D !== 'undefined' && raw instanceof Path2D)
          ? Array.from(raw as ArrayLike<number>)
          : null;
      const leaf = makePathLeaf([i], drawOps, renderOp, [...gfx.ctm] as Mat, minMax);
      if (leaf) top().elements.push(leaf);
      i++;
      continue;
    }

    // ── Legacy path run: moveTo/rectangle/… → stroke/fill ───────────
    // One element for the WHOLE painted path (multi-subpath = one authored
    // object — the old per-subpath split is what shattered symbols into
    // dozens of slivers).
    if (LEGACY_PATH_OPS.has(op)) {
      const opIndices: number[] = [];
      const drawOps: number[] = [];
      let cx = 0, cy = 0; // current point, for curveTo2/curveTo3 expansion
      let renderOp = OPS.endPath;
      while (i < fnArray.length) {
        const cur = fnArray[i];
        const a = argsArray[i];
        if (LEGACY_PATH_OPS.has(cur)) {
          opIndices.push(i);
          switch (cur) {
            case OPS.moveTo: drawOps.push(DRAW.moveTo, a[0], a[1]); cx = a[0]; cy = a[1]; break;
            case OPS.lineTo: drawOps.push(DRAW.lineTo, a[0], a[1]); cx = a[0]; cy = a[1]; break;
            case OPS.curveTo: drawOps.push(DRAW.curveTo, a[0], a[1], a[2], a[3], a[4], a[5]); cx = a[4]; cy = a[5]; break;
            case OPS.curveTo2: drawOps.push(DRAW.curveTo, cx, cy, a[0], a[1], a[2], a[3]); cx = a[2]; cy = a[3]; break;
            case OPS.curveTo3: drawOps.push(DRAW.curveTo, a[0], a[1], a[2], a[3], a[2], a[3]); cx = a[2]; cy = a[3]; break;
            case OPS.closePath: drawOps.push(DRAW.closePath); break;
            case OPS.rectangle:
              drawOps.push(
                DRAW.moveTo, a[0], a[1],
                DRAW.lineTo, a[0] + a[2], a[1],
                DRAW.lineTo, a[0] + a[2], a[1] + a[3],
                DRAW.lineTo, a[0], a[1] + a[3],
                DRAW.closePath,
              );
              cx = a[0]; cy = a[1];
              break;
          }
          i++;
          continue;
        }
        if (PATH_RENDER_OPS.has(cur)) {
          opIndices.push(i);
          renderOp = cur;
          i++;
        }
        break;
      }
      const leaf = makePathLeaf(opIndices, drawOps, renderOp, [...gfx.ctm] as Mat, null);
      if (leaf) top().elements.push(leaf);
      continue;
    }

    // ── Form XObject: a real authored group ─────────────────────────
    if (op === OPS.paintFormXObjectBegin) {
      gfxStack.push({ ...gfx, ctm: [...gfx.ctm] as Mat });
      const matrix = args?.[0];
      if (matrix && matrix.length === 6) gfx.ctm = matMul(gfx.ctm, matrix);
      frames.push({ elements: [], startIdx: i });
      i++;
      continue;
    }
    if (op === OPS.paintFormXObjectEnd) {
      gfx = gfxStack.pop() ?? gfx;
      if (frames.length > 1) {
        const frame = frames.pop()!;
        const children = frame.elements;
        const parent = top();
        if (children.length === 1) {
          // A group of one is just that thing.
          parent.elements.push(children[0]);
        } else if (children.length > 1) {
          const bbox = unionBBox(children.map(c => c.bbox));
          // Full op range so deletion removes the group's state ops too.
          const opIndices: number[] = [];
          for (let k = frame.startIdx; k <= i; k++) opIndices.push(k);
          parent.elements.push({
            id: nextId(),
            type: 'group',
            label: `Group (${children.length})`,
            opIndices,
            bbox,
            children,
          });
        }
      }
      i++;
      continue;
    }

    i++; // anything else: state we don't track
  }

  // Unclosed XObject frames (malformed PDF) — fold children back into root.
  while (frames.length > 1) {
    const frame = frames.pop()!;
    root.elements.push(...frame.elements);
  }

  // ── Cluster flattened CAD symbols into pseudo-groups ──────────────
  const result = clusterSymbols(root.elements, maxDim, pageArea, nextId);

  const leafCount = result.reduce((n, el) => n + (el.children?.length ?? 1), 0);
  console.log(`[Plan Builder] Extracted ${result.length} top-level elements (${leafCount} leaves)`);
  return result;
}

/**
 * CAD exports usually flatten everything — a door symbol arrives as 12
 * consecutive tiny paths, not a group. Cluster runs of stream-adjacent small
 * elements whose bboxes touch into a pseudo-group so one click selects the
 * symbol (double-click drills into the pieces).
 *
 * Guards keep walls/borders out of clusters: long elements never join, and a
 * cluster stops growing past a bbox-area cap so proximity chains can't swallow
 * the whole drawing.
 */
function clusterSymbols(
  elements: PdfElement[],
  maxDim: number,
  pageArea: number,
  nextId: () => string,
): PdfElement[] {
  const PAD = maxDim * 0.004;            // "touching" tolerance
  const LONG_SIDE_LIMIT = maxDim * 0.22; // walls/borders never join clusters
  const CLUSTER_AREA_CAP = pageArea * 0.06;
  const MEMBER_CAP = 400;

  const canJoin = (el: PdfElement) =>
    el.type === 'path' && Math.max(el.bbox.width, el.bbox.height) < LONG_SIDE_LIMIT;

  const near = (a: PdfElement['bbox'], b: PdfElement['bbox']) =>
    a.x - PAD <= b.x + b.width && a.x + a.width + PAD >= b.x &&
    a.y - PAD <= b.y + b.height && a.y + a.height + PAD >= b.y;

  const out: PdfElement[] = [];
  let cluster: PdfElement[] = [];
  let clusterBBox: PdfElement['bbox'] | null = null;

  const flush = () => {
    if (cluster.length >= 2) {
      out.push({
        id: nextId(),
        type: 'group',
        label: `Symbol (${cluster.length} parts)`,
        opIndices: cluster.flatMap(c => c.opIndices),
        bbox: clusterBBox!,
        children: cluster,
      });
    } else if (cluster.length === 1) {
      out.push(cluster[0]);
    }
    cluster = [];
    clusterBBox = null;
  };

  for (const el of elements) {
    if (!canJoin(el)) { flush(); out.push(el); continue; }
    if (cluster.length === 0) { cluster.push(el); clusterBBox = { ...el.bbox }; continue; }

    const candidate = unionBBox([clusterBBox!, el.bbox]);
    if (
      near(clusterBBox!, el.bbox) &&
      candidate.width * candidate.height <= CLUSTER_AREA_CAP &&
      cluster.length < MEMBER_CAP
    ) {
      cluster.push(el);
      clusterBBox = candidate;
    } else {
      flush();
      cluster = [el];
      clusterBBox = { ...el.bbox };
    }
  }
  flush();
  return out;
}

function unionBBox(boxes: { x: number; y: number; width: number; height: number }[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Stable fingerprint of a colour op's args, for select-similar matching. */
function safeStyle(args: unknown): string {
  try {
    if (args == null) return '?';
    return JSON.stringify(Array.from(args as ArrayLike<number>)).slice(0, 40);
  } catch {
    return '?';
  }
}
