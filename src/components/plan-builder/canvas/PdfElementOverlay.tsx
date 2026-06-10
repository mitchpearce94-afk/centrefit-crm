'use client';

import React from 'react';
import { Layer, Shape, Rect } from 'react-konva';
import { usePlanStore } from '@/store/planStore';
import { PdfElement } from '@/types/plan-builder';
import { getPath2D } from '@/lib/plan-builder/pdfHitTest';

/**
 * PDF element highlight overlay — Serif-style. Path elements are highlighted
 * along their REAL geometry (the door arc lights up as an arc, not as a big
 * rectangle); text/images keep a tight bbox highlight; groups get a dashed
 * bounding outline around their members' ink so "this whole symbol" reads at
 * a glance.
 */

const HOVER_STROKE = '#3388ff';
const HOVER_FILL = 'rgba(60, 130, 255, 0.18)';
const SELECT_STROKE = '#ff3333';
const SELECT_FILL = 'rgba(255, 60, 60, 0.22)';

export default function PdfElementOverlay() {
  const {
    activeTool,
    pdfElements,
    selectedElementIds,
    hoveredElementId,
    drilledGroupId,
    stageScale,
  } = usePlanStore();

  if (activeTool !== 'elementSelect' || pdfElements.length === 0) return null;

  // Resolve an id that may be a top-level element OR a leaf inside a group.
  const byId = (id: string): PdfElement | null => {
    for (const el of pdfElements) {
      if (el.id === id) return el;
      const child = el.children?.find(c => c.id === id);
      if (child) return child;
    }
    return null;
  };

  const selected = selectedElementIds.map(byId).filter((e): e is PdfElement => !!e);
  const hovered = hoveredElementId && !selectedElementIds.includes(hoveredElementId)
    ? byId(hoveredElementId)
    : null;
  const drilledGroup = drilledGroupId ? byId(drilledGroupId) : null;

  // Extra highlight thickness in CANVAS px so it stays ~2 screen px at any zoom.
  const extraPx = Math.max(2 / stageScale, 0.75);

  const drawElement = (
    nativeCtx: CanvasRenderingContext2D,
    el: PdfElement,
    stroke: string,
    fill: string,
  ) => {
    const leaves: PdfElement[] = el.children?.length ? el.children : [el];
    for (const leaf of leaves) {
      const geo = leaf.geometry;
      const path = geo ? getPath2D(leaf) : null;
      if (geo && path) {
        nativeCtx.save();
        nativeCtx.transform(geo.ctm[0], geo.ctm[1], geo.ctm[2], geo.ctm[3], geo.ctm[4], geo.ctm[5]);
        const scale = Math.sqrt(Math.abs(geo.ctm[0] * geo.ctm[3] - geo.ctm[1] * geo.ctm[2])) || 1;
        if (geo.fills) {
          nativeCtx.fillStyle = fill;
          nativeCtx.fill(path);
        }
        nativeCtx.strokeStyle = stroke;
        nativeCtx.lineWidth = (geo.strokes ? geo.lineWidth : 0) + (extraPx * 2) / scale;
        nativeCtx.stroke(path);
        nativeCtx.restore();
      } else {
        // Text / image / geometry-less leaf: tight bbox highlight.
        const { x, y, width, height } = leaf.bbox;
        nativeCtx.save();
        nativeCtx.fillStyle = fill;
        nativeCtx.fillRect(x, y, width, height);
        nativeCtx.strokeStyle = stroke;
        nativeCtx.lineWidth = extraPx;
        nativeCtx.strokeRect(x, y, width, height);
        nativeCtx.restore();
      }
    }
  };

  return (
    <Layer listening={false}>
      <Shape
        sceneFunc={(context) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ctx = (context as any)._context as CanvasRenderingContext2D;
          for (const el of selected) drawElement(ctx, el, SELECT_STROKE, SELECT_FILL);
          if (hovered) drawElement(ctx, hovered, HOVER_STROKE, HOVER_FILL);
        }}
      />
      {/* Group affordances: dashed outline around a hovered/selected group,
          and a faint boundary around the group you're drilled into. */}
      {[...selected, ...(hovered ? [hovered] : [])]
        .filter(el => el.children?.length)
        .map(el => (
          <Rect
            key={`g-${el.id}`}
            x={el.bbox.x - extraPx * 2}
            y={el.bbox.y - extraPx * 2}
            width={el.bbox.width + extraPx * 4}
            height={el.bbox.height + extraPx * 4}
            stroke={selectedElementIds.includes(el.id) ? SELECT_STROKE : HOVER_STROKE}
            strokeWidth={extraPx}
            dash={[6 / stageScale, 4 / stageScale]}
          />
        ))}
      {drilledGroup && (
        <Rect
          x={drilledGroup.bbox.x - extraPx * 3}
          y={drilledGroup.bbox.y - extraPx * 3}
          width={drilledGroup.bbox.width + extraPx * 6}
          height={drilledGroup.bbox.height + extraPx * 6}
          stroke="rgba(60, 130, 255, 0.55)"
          strokeWidth={extraPx}
          dash={[3 / stageScale, 3 / stageScale]}
        />
      )}
    </Layer>
  );
}
