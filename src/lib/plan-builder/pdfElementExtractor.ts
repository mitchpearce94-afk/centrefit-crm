import { PdfElement } from '@/types/plan-builder';

// pdf.js OPS constants — exact values from pdfjs-dist v5.5.207
const OPS = {
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
  paintXObject: 66,
  paintImageMaskXObject: 83,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  constructPath: 91,
};

// Operators that actually render pixels (non-empty bbox expected)
const RENDERING_OPS = new Set([
  OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill,
  OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke,
  OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText,
  OPS.paintXObject, OPS.paintImageXObject, OPS.paintImageMaskXObject,
  OPS.paintInlineImageXObject,
]);

// Path-starting operators (NOT constructPath — that's self-contained)
const PATH_START_OPS = new Set([
  OPS.moveTo, OPS.rectangle,
]);

// Path-ending (rendering) operators
const PATH_RENDER_OPS = new Set([
  OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill,
  OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke,
  OPS.endPath,
]);

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
  transform: number[];
  width: number;
  height: number;
}

/**
 * Extract selectable elements from a PDF page's operator list.
 * Groups sequential operators into logical elements (text blocks, paths, images)
 * and computes bounding boxes from the recorded bbox data.
 */
export function extractElements(
  operatorList: { fnArray: number[]; argsArray: any[] },
  bboxReader: BBoxReader,
  textContent: { items: any[] },
  canvasWidth: number,
  canvasHeight: number,
): PdfElement[] {
  const { fnArray } = operatorList;
  const elements: PdfElement[] = [];
  let elementCounter = 0;
  const pageArea = canvasWidth * canvasHeight;

  // Debug: log operator type distribution
  const opCounts: Record<number, number> = {};
  for (const op of fnArray) opCounts[op] = (opCounts[op] || 0) + 1;
  console.log('[Plan Builder] Operator distribution:', JSON.stringify(opCounts));

  // Debug: count non-empty bboxes
  let nonEmptyBboxes = 0;
  for (let idx = 0; idx < Math.min(fnArray.length, bboxReader.length); idx++) {
    if (!bboxReader.isEmpty(idx)) nonEmptyBboxes++;
  }
  console.log(`[Plan Builder] Non-empty bboxes: ${nonEmptyBboxes} / ${fnArray.length}`);

  // Track text content items for labeling
  const textItems: TextContentItem[] = textContent.items.filter(
    (item: any) => typeof item.str === 'string' && item.str.trim().length > 0
  );
  let textItemIndex = 0;

  let skippedOps = 0;
  let textBlocks = 0;
  let pathBlocks = 0;
  let imageBlocks = 0;
  let filteredOut = 0;

  let i = 0;
  const SHOW_TEXT_OPS = new Set([
    OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText,
  ]);
  while (i < fnArray.length) {
    const op = fnArray[i];

    // TEXT BLOCK: BT ... ET — emit ONE element per text block so the whole
    // paragraph is selectable and deletes cleanly as a unit. The bbox
    // is built from show-text ops only (the actual rendered glyph
    // extents). State ops like moveText / setTextMatrix have recorded
    // bboxes that span "where the cursor moved to" and unioning them
    // inflates the highlight to half the page — exactly the symptom
    // you saw before. The opIndices still cover the whole block so
    // deletion strips everything cleanly.
    if (op === OPS.beginText) {
      textBlocks++;
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
      if (i < fnArray.length) {
        opIndices.push(i); // ET
        i++;
      }

      // Tight bbox: only the show-text ops, not the state ops.
      const bbox = showTextIndices.length > 0
        ? computeUnionBBox(showTextIndices, bboxReader, canvasWidth, canvasHeight)
        : computeUnionBBox(opIndices, bboxReader, canvasWidth, canvasHeight);
      if (!bbox) { filteredOut++; }
      else if (isFullPage(bbox, canvasWidth, canvasHeight, pageArea)) { filteredOut++; }
      else if (isTiny(bbox)) { filteredOut++; }
      else {
        elements.push({
          id: `el-${elementCounter++}`,
          type: 'text',
          label: textLabel.trim().substring(0, 80) || 'Text',
          opIndices,
          bbox,
        });
      }
      continue;
    }

    // IMAGE: paintXObject, paintImageXObject, etc.
    if (op === OPS.paintXObject || op === OPS.paintImageXObject ||
        op === OPS.paintImageMaskXObject || op === OPS.paintInlineImageXObject) {
      imageBlocks++;
      const opIndices = [i];
      const bbox = computeUnionBBox(opIndices, bboxReader, canvasWidth, canvasHeight);
      if (bbox && !isFullPage(bbox, canvasWidth, canvasHeight, pageArea) && !isTiny(bbox)) {
        elements.push({
          id: `el-${elementCounter++}`,
          type: 'image',
          label: 'Image',
          opIndices,
          bbox,
        });
      }
      i++;
      continue;
    }

    // CONSTRUCT PATH: self-contained path+fill/stroke bundled in one operator
    if (op === OPS.constructPath) {
      pathBlocks++;
      const opIndices = [i];
      const bbox = computeUnionBBox(opIndices, bboxReader, canvasWidth, canvasHeight);
      if (bbox && !isFullPage(bbox, canvasWidth, canvasHeight, pageArea) && !isTiny(bbox)) {
        elements.push({ id: `el-${elementCounter++}`, type: 'path', label: 'Shape', opIndices, bbox });
      } else { filteredOut++; }
      i++;
      continue;
    }

    // PATH: moveTo/rectangle ... stroke/fill — split into one element per
    // SUB-path (each moveTo / rectangle starts a new sub-path) so a single
    // multi-subpath path doesn't become one giant unselectable blob.
    // The rendering op (stroke/fill) is shared across all subpaths and
    // included in every emitted element so filtering one out leaves the
    // others rendering correctly.
    if (PATH_START_OPS.has(op) || op === OPS.lineTo || op === OPS.curveTo) {
      pathBlocks++;
      const subpaths: number[][] = [];
      let current: number[] = [];

      while (i < fnArray.length) {
        const cur = fnArray[i];
        if (current.length > 0 && (cur === OPS.moveTo || cur === OPS.rectangle)) {
          // Sub-path boundary — close the previous one
          subpaths.push(current);
          current = [];
        }
        current.push(i);
        if (PATH_RENDER_OPS.has(cur)) {
          i++;
          break;
        }
        i++;
      }
      if (current.length > 0) subpaths.push(current);

      // Identify the shared rendering op (last index of the last subpath
      // if it's a render op) — every emitted element keeps it so deletion
      // doesn't break the surviving subpaths' rendering.
      let renderOpIdx: number | null = null;
      const lastGroup = subpaths[subpaths.length - 1];
      if (lastGroup) {
        const tail = lastGroup[lastGroup.length - 1];
        if (PATH_RENDER_OPS.has(fnArray[tail])) renderOpIdx = tail;
      }

      for (const sub of subpaths) {
        const indicesForElement = renderOpIdx !== null && !sub.includes(renderOpIdx)
          ? [...sub, renderOpIdx]
          : sub;
        const bbox = computeUnionBBox(indicesForElement, bboxReader, canvasWidth, canvasHeight);
        if (bbox && !isFullPage(bbox, canvasWidth, canvasHeight, pageArea) && !isTiny(bbox)) {
          elements.push({
            id: `el-${elementCounter++}`,
            type: 'path',
            label: 'Shape',
            opIndices: indicesForElement,
            bbox,
          });
        } else {
          filteredOut++;
        }
      }
      continue;
    }

    // FORM XOBJECT: paintFormXObjectBegin ... paintFormXObjectEnd
    if (op === OPS.paintFormXObjectBegin) {
      const opIndices: number[] = [];
      let depth = 1;
      opIndices.push(i);
      i++;

      while (i < fnArray.length && depth > 0) {
        opIndices.push(i);
        if (fnArray[i] === OPS.paintFormXObjectBegin) depth++;
        if (fnArray[i] === OPS.paintFormXObjectEnd) depth--;
        i++;
      }

      const bbox = computeUnionBBox(opIndices, bboxReader, canvasWidth, canvasHeight);
      if (bbox && !isFullPage(bbox, canvasWidth, canvasHeight, pageArea) && !isTiny(bbox)) {
        elements.push({
          id: `el-${elementCounter++}`,
          type: 'group',
          label: 'Group',
          opIndices,
          bbox,
        });
      }
      continue;
    }

    // Skip non-rendering operators (state changes, save/restore, etc.)
    i++;
  }

  console.log(`[Plan Builder] Grouping: ${textBlocks} text, ${pathBlocks} path, ${imageBlocks} image blocks found. ${elements.length} kept, ${filteredOut} filtered out.`);

  return elements;
}

/**
 * Compute the union bounding box of multiple operators.
 * Returns null if all operators have empty bboxes.
 */
function computeUnionBBox(
  opIndices: number[],
  bboxReader: BBoxReader,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let hasAny = false;

  for (const idx of opIndices) {
    if (idx >= bboxReader.length || bboxReader.isEmpty(idx)) continue;
    hasAny = true;
    const x1 = bboxReader.minX(idx) * canvasWidth;
    const y1 = bboxReader.minY(idx) * canvasHeight;
    const x2 = bboxReader.maxX(idx) * canvasWidth;
    const y2 = bboxReader.maxY(idx) * canvasHeight;
    minX = Math.min(minX, x1);
    minY = Math.min(minY, y1);
    maxX = Math.max(maxX, x2);
    maxY = Math.max(maxY, y2);
  }

  if (!hasAny) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Check if bbox covers >85% of the page (likely a background fill) */
function isFullPage(
  bbox: { width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
  pageArea: number,
): boolean {
  return (bbox.width * bbox.height) > pageArea * 0.85;
}

/**
 * Check if bbox is too small to be worth selecting. Filters genuine
 * sub-pixel artefacts (single-point ops, render-empty shapes) while
 * keeping legitimate thin elements like wall lines (long but 1px tall)
 * and dimension ticks.
 */
function isTiny(bbox: { width: number; height: number }): boolean {
  // Both dimensions sub-pixel → noise.
  if (bbox.width < 0.5 && bbox.height < 0.5) return true;
  // Or area is microscopic (handles cases where a tiny non-zero bbox
  // slips through but represents nothing visible).
  if (bbox.width * bbox.height < 1) return true;
  return false;
}

/**
 * Merge elements of the same type whose bboxes overlap significantly.
 * This reduces clutter from operators that form a single visual unit
 * but were split across multiple operator sequences.
 */
function mergeNearbyElements(elements: PdfElement[]): PdfElement[] {
  if (elements.length < 2) return elements;

  const merged: PdfElement[] = [];
  const used = new Set<number>();

  for (let i = 0; i < elements.length; i++) {
    if (used.has(i)) continue;

    let current = { ...elements[i], opIndices: [...elements[i].opIndices] };
    let currentBbox = { ...current.bbox };
    let didMerge = true;

    // Keep merging until no more merges happen
    while (didMerge) {
      didMerge = false;
      for (let j = i + 1; j < elements.length; j++) {
        if (used.has(j)) continue;
        if (elements[j].type !== current.type) continue;

        const other = elements[j];
        // Check if bboxes overlap or are very close (within 5px)
        const pad = 5;
        if (currentBbox.x - pad <= other.bbox.x + other.bbox.width &&
            currentBbox.x + currentBbox.width + pad >= other.bbox.x &&
            currentBbox.y - pad <= other.bbox.y + other.bbox.height &&
            currentBbox.y + currentBbox.height + pad >= other.bbox.y) {
          // Merge
          current.opIndices.push(...other.opIndices);
          if (current.type === 'text' && other.label && other.label !== 'Text') {
            current.label = (current.label + ' ' + other.label).substring(0, 80);
          }
          const newMinX = Math.min(currentBbox.x, other.bbox.x);
          const newMinY = Math.min(currentBbox.y, other.bbox.y);
          const newMaxX = Math.max(currentBbox.x + currentBbox.width, other.bbox.x + other.bbox.width);
          const newMaxY = Math.max(currentBbox.y + currentBbox.height, other.bbox.y + other.bbox.height);
          currentBbox = { x: newMinX, y: newMinY, width: newMaxX - newMinX, height: newMaxY - newMinY };
          current.bbox = currentBbox;
          used.add(j);
          didMerge = true;
        }
      }
    }

    merged.push(current);
  }

  return merged;
}
