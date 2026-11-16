'use client';

import React from 'react';
import { Layer, Group, Rect, Text, Arrow, Circle } from 'react-konva';
import { usePlanStore } from '@/store/planStore';
import { calloutBox, calloutArrow, calloutTarget, CALLOUT_LINE } from '@/lib/plan-builder/callouts';

/**
 * Note boxes with leader arrows, drawn on the plan (Mitchell 16 Nov 2026,
 * modelled on the Athree power & data sheets: short text, thin leader to
 * the outlet). Box is draggable; a free arrow tip is draggable too when
 * the callout is selected. Arrows that follow a device move with it.
 */

export default function CalloutLayer({ stageScale }: { stageScale: number }) {
  const { callouts, devices, deviceScale, selectedCalloutId, selectCallout, updateCallout, activeTool, selectDevice } = usePlanStore();
  if (callouts.length === 0) return null;
  const canDrag = activeTool === 'select';
  return (
    <Layer>
      {callouts.map(c => {
        const box = calloutBox(c, deviceScale);
        const target = calloutTarget(c, devices);
        const selected = c.id === selectedCalloutId;
        const arrow = target ? calloutArrow(c, box, target, 16 * deviceScale) : null;
        return (
          <React.Fragment key={c.id}>
            {arrow && (
              <Arrow points={[arrow.start.x, arrow.start.y, arrow.end.x, arrow.end.y]}
                stroke="#111111" fill="#111111" strokeWidth={0.9 * deviceScale}
                pointerLength={5 * deviceScale} pointerWidth={4 * deviceScale} listening={false} />
            )}
            <Group x={c.x} y={c.y} draggable={canDrag}
              onClick={() => { if (canDrag) { selectCallout(c.id); selectDevice(null); } }}
              onTap={() => { if (canDrag) { selectCallout(c.id); selectDevice(null); } }}
              onDragEnd={e => updateCallout(c.id, { x: e.target.x(), y: e.target.y() })}>
              <Rect width={box.width} height={box.height} fill="#ffffff" stroke={selected ? '#00bfff' : '#111111'}
                strokeWidth={selected ? 1.5 / stageScale : 0.6 * deviceScale} cornerRadius={1.5 * deviceScale} />
              <Text text={box.lines.join('\n')} x={box.pad} y={box.pad} width={box.width - box.pad * 2}
                fontSize={box.font} lineHeight={CALLOUT_LINE} fill="#111111" fontFamily="Arial, Helvetica, sans-serif" listening={false} />
            </Group>
            {selected && !c.targetInstanceId && target && (
              <Circle x={target.x} y={target.y} radius={5 / stageScale} fill="#00bfff" stroke="#ffffff" strokeWidth={1 / stageScale}
                draggable={canDrag} onDragEnd={e => updateCallout(c.id, { tx: e.target.x(), ty: e.target.y() })} />
            )}
          </React.Fragment>
        );
      })}
    </Layer>
  );
}
