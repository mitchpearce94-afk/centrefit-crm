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
 * Find the smallest element at canvas coordinates (x, y).
 * Returns the element ID or null.
 * Prefers smaller elements over larger ones (more specific selection).
 */
export function hitTestElements(
  canvasX: number,
  canvasY: number,
  elements: { id: string; bbox: { x: number; y: number; width: number; height: number } }[],
): string | null {
  let bestId: string | null = null;
  let bestArea = Infinity;

  for (const el of elements) {
    const { x, y, width, height } = el.bbox;
    if (canvasX >= x && canvasX <= x + width && canvasY >= y && canvasY <= y + height) {
      const area = width * height;
      if (area < bestArea) {
        bestArea = area;
        bestId = el.id;
      }
    }
  }

  return bestId;
}
