import { PdfElement } from '@/types/plan-builder';
import { extractElements } from './pdfElementExtractor';

// Render scale for PDF pages — higher = sharper but larger images
// A3 construction plans at 6x ≈ 5052x7146 pixels (~200 DPI print quality)
const PDF_RENDER_SCALE = 6;

export interface PdfPageInfo {
  pageNumber: number;
  thumbnail: string;
  width: number;
  height: number;
}

// Cache PDF documents by file identity to avoid re-parsing
const pdfDocCache = new Map<string, any>();

function fileCacheKey(file: File): string {
  return `${file.name}__${file.size}__${file.lastModified}`;
}

async function getOrLoadPdf(file: File) {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/plan-builder/pdf.worker.min.mjs';

  const key = fileCacheKey(file);
  if (pdfDocCache.has(key)) return pdfDocCache.get(key);

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  pdfDocCache.set(key, pdf);
  return pdf;
}

export async function renderPdfToImage(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  const pdf = await getOrLoadPdf(file);
  const page = await pdf.getPage(1);

  const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.render({ canvasContext: ctx as any, canvas, viewport }).promise;

  return { dataUrl: canvas.toDataURL('image/png'), width: viewport.width, height: viewport.height };
}

export async function getPdfPages(file: File): Promise<PdfPageInfo[]> {
  const pdf = await getOrLoadPdf(file);
  const pages: PdfPageInfo[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 0.3 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.render({ canvasContext: ctx as any, canvas, viewport }).promise;

    pages.push({
      pageNumber: i,
      thumbnail: canvas.toDataURL('image/png'),
      width: viewport.width,
      height: viewport.height,
    });
  }

  return pages;
}

export async function renderPdfPage(file: File, pageNumber: number): Promise<{ dataUrl: string; width: number; height: number }> {
  const pdf = await getOrLoadPdf(file);
  const page = await pdf.getPage(pageNumber);

  const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.render({ canvasContext: ctx as any, canvas, viewport }).promise;

  return { dataUrl: canvas.toDataURL('image/png'), width: viewport.width, height: viewport.height };
}

/**
 * Render a PDF page AND extract selectable elements with bounding boxes.
 * Uses pdf.js's recordOperations to get per-operator bboxes,
 * then groups operators into logical elements (text, paths, images).
 */
export async function renderPdfPageWithElements(
  file: File,
  pageNumber: number,
): Promise<{ dataUrl: string; width: number; height: number; elements: PdfElement[] }> {
  const pdf = await getOrLoadPdf(file);
  const page = await pdf.getPage(pageNumber);

  const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;

  console.log('[Plan Builder] Starting element extraction render...');

  // Clear any cached bboxes so recordOperations works
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any).recordedBBoxes = null;

  // Render with recordOperations to get per-operator bounding boxes
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (page as any).render({
      canvasContext: ctx as any,
      canvas,
      viewport,
      recordOperations: true,
    }).promise;
    console.log('[Plan Builder] Render complete');
  } catch (renderErr) {
    console.error('[Plan Builder] Render failed:', renderErr);
    // Fall back to basic render without recordOperations
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.render({ canvasContext: ctx as any, canvas, viewport }).promise;
  }

  // Get the recorded bounding boxes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bboxReader = (page as any).recordedBBoxes;
  console.log('[Plan Builder] recordedBBoxes:', bboxReader ? `BBoxReader (length: ${bboxReader.length})` : 'null');

  // Get operator list and text content for element extraction
  const [operatorList, textContent] = await Promise.all([
    page.getOperatorList(),
    page.getTextContent(),
  ]);
  console.log(`[Plan Builder] Operators: ${operatorList.fnArray.length}, Text items: ${textContent.items.length}`);

  let elements: PdfElement[] = [];
  if (bboxReader && typeof bboxReader.isEmpty === 'function') {
    try {
      elements = extractElements(
        operatorList,
        bboxReader,
        textContent,
        viewport.width,
        viewport.height,
      );
      console.log(`[Plan Builder] Extracted ${elements.length} elements`);
    } catch (extractErr) {
      console.error('[Plan Builder] Element extraction failed:', extractErr);
    }
  } else {
    console.warn('[Plan Builder] recordedBBoxes not available — element selection disabled');
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: viewport.width,
    height: viewport.height,
    elements,
  };
}

/**
 * Re-render a PDF page with certain operators filtered out (deleted).
 * Uses pdf.js's operationsFilter callback to skip deleted operators,
 * producing a clean render as if those elements never existed.
 */
export async function renderPdfPageFiltered(
  file: File,
  pageNumber: number,
  deletedIndices: Set<number>,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const pdf = await getOrLoadPdf(file);
  const page = await pdf.getPage(pageNumber);

  const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;

  // Render with operationsFilter to skip deleted operators
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (page as any).render({
    canvasContext: ctx as any,
    canvas,
    viewport,
    operationsFilter: (index: number) => !deletedIndices.has(index),
  }).promise;

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: viewport.width,
    height: viewport.height,
  };
}
