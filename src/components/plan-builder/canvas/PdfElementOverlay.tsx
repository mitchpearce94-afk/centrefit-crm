'use client';

import React, { useCallback } from 'react';
import { Layer, Rect } from 'react-konva';
import { usePlanStore } from '@/store/planStore';

/**
 * Lightweight PDF element overlay — only renders highlight rects for:
 * - The single hovered element (blue)
 * - Selected elements (red)
 *
 * Hit-testing is done via onMouseMove on the Stage in PlanCanvas,
 * NOT by rendering 6000+ Konva Rects with individual event handlers.
 */
export default function PdfElementOverlay() {
  const {
    activeTool,
    pdfElements,
    selectedElementIds,
    hoveredElementId,
  } = usePlanStore();

  if (activeTool !== 'elementSelect' || pdfElements.length === 0) return null;

  const hovered = hoveredElementId ? pdfElements.find(el => el.id === hoveredElementId) : null;

  return (
    <Layer listening={false}>
      {/* Selected elements */}
      {selectedElementIds.map(id => {
        const el = pdfElements.find(e => e.id === id);
        if (!el) return null;
        return (
          <Rect
            key={el.id}
            x={el.bbox.x}
            y={el.bbox.y}
            width={el.bbox.width}
            height={el.bbox.height}
            fill="rgba(255, 60, 60, 0.25)"
            stroke="#ff3333"
            strokeWidth={2}
          />
        );
      })}
      {/* Hovered element (if not already selected) */}
      {hovered && !selectedElementIds.includes(hovered.id) && (
        <Rect
          x={hovered.bbox.x}
          y={hovered.bbox.y}
          width={hovered.bbox.width}
          height={hovered.bbox.height}
          fill="rgba(60, 130, 255, 0.2)"
          stroke="#3388ff"
          strokeWidth={1}
          dash={[4, 3]}
        />
      )}
    </Layer>
  );
}

/**
 * Find the most specific element at canvas coordinates (x, y).
 *
 * For thin elements (lines, wall strokes) the bbox is just a few pixels
 * thick — without tolerance you'd have to land your cursor exactly on
 * the pixel. We expand the hit box per-element by `tolerance` only on
 * the dimension(s) that are thinner than the tolerance, so thick
 * elements aren't made deliberately easier to hit (which would mean
 * they steal clicks from things on top of them).
 *
 * Prefers smaller-area elements when multiple match — that's how
 * Affinity-style "click the thing under my cursor" feels.
 */
export function hitTestElements(
  canvasX: number,
  canvasY: number,
  elements: { id: string; bbox: { x: number; y: number; width: number; height: number } }[],
  tolerance = 4,
): string | null {
  let bestId: string | null = null;
  let bestArea = Infinity;

  for (const el of elements) {
    const { x, y, width, height } = el.bbox;
    // Per-axis padding: only inflate the dimension that's actually thin.
    const padX = width < tolerance ? (tolerance - width) / 2 : 0;
    const padY = height < tolerance ? (tolerance - height) / 2 : 0;
    if (
      canvasX >= x - padX && canvasX <= x + width + padX &&
      canvasY >= y - padY && canvasY <= y + height + padY
    ) {
      const area = Math.max(width * height, 1);
      if (area < bestArea) {
        bestArea = area;
        bestId = el.id;
      }
    }
  }

  return bestId;
}
