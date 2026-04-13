'use client';

import React from 'react';
import { Group, Line, Text, Circle } from 'react-konva';
import { PlacedDevice } from '@/types/plan-builder';
import { getDeviceById, CABLE_COLORS } from '@/lib/plan-builder/devices';

interface Props {
  devices: PlacedDevice[];
  commsRackId: string | null;
}

const ZONE_COLORS = [
  CABLE_COLORS['speaker'] || '#44cc44',
  '#22aaff',
  '#ff8844',
  '#cc44ff',
  '#ffcc00',
  '#ff4488',
];

function buildDaisyChain(deviceList: PlacedDevice[], startX: number, startY: number): PlacedDevice[] {
  if (deviceList.length === 0) return [];
  const remaining = [...deviceList];
  const chain: PlacedDevice[] = [];
  let cx = startX;
  let cy = startY;

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dx = remaining[i].x - cx;
      const dy = remaining[i].y - cy;
      const dist = dx * dx + dy * dy;
      if (dist < nearestDist) { nearestDist = dist; nearestIdx = i; }
    }
    const nearest = remaining.splice(nearestIdx, 1)[0];
    chain.push(nearest);
    cx = nearest.x;
    cy = nearest.y;
  }
  return chain;
}

export default function CableLines({ devices, commsRackId }: Props) {
  if (!commsRackId) return null;
  const rackDevice = devices.find(d => d.instanceId === commsRackId);
  if (!rackDevice) return null;

  const speakerDevices = devices.filter(d => {
    if (d.instanceId === commsRackId) return false;
    const def = getDeviceById(d.deviceId);
    return def?.cableType === 'speaker';
  });

  const zoneMap = new Map<number, PlacedDevice[]>();
  for (const d of speakerDevices) {
    const zone = d.speakerZone || 1;
    if (!zoneMap.has(zone)) zoneMap.set(zone, []);
    zoneMap.get(zone)!.push(d);
  }

  const allSegments: Array<{ fromX: number; fromY: number; toX: number; toY: number; label: string; color: string; key: string }> = [];

  for (const [zone, zoneSpeakers] of zoneMap) {
    // Volume controls go first in the chain (inline before speakers)
    const volumeControls = zoneSpeakers.filter(d => {
      const def = getDeviceById(d.deviceId);
      return def?.isVolumeControl;
    });
    const speakers = zoneSpeakers.filter(d => {
      const def = getDeviceById(d.deviceId);
      return !def?.isVolumeControl;
    });
    // Route: comms rack → volume control(s) → speakers (daisy chained)
    const vcChain = buildDaisyChain(volumeControls, rackDevice.x, rackDevice.y);
    const lastVc = vcChain[vcChain.length - 1];
    const spkStartX = lastVc?.x ?? rackDevice.x;
    const spkStartY = lastVc?.y ?? rackDevice.y;
    const spkChain = buildDaisyChain(speakers, spkStartX, spkStartY);
    const chain = [...vcChain, ...spkChain];

    const zoneColor = ZONE_COLORS[(zone - 1) % ZONE_COLORS.length];
    const zoneLabel = String.fromCharCode(64 + zone);
    let prevX = rackDevice.x;
    let prevY = rackDevice.y;
    let count = 0;

    for (const chainDevice of chain) {
      count++;
      allSegments.push({ fromX: prevX, fromY: prevY, toX: chainDevice.x, toY: chainDevice.y, label: zoneLabel, color: zoneColor, key: `spk-z${zone}-${count}` });
      prevX = chainDevice.x;
      prevY = chainDevice.y;
    }
  }

  return (
    <Group listening={false}>
      {allSegments.map(seg => (
        <Line key={seg.key} points={[seg.fromX, seg.fromY, seg.toX, seg.toY]} stroke={seg.color} strokeWidth={3} opacity={0.8} />
      ))}
    </Group>
  );
}
