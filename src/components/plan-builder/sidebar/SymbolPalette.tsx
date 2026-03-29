'use client';

import React, { useState } from 'react';
import { usePlanStore } from '@/store/planStore';
import { DEVICE_CATALOG, CATEGORY_LABELS, CABLE_COLORS } from '@/lib/plan-builder/devices';
import { DeviceCategory, DeviceDefinition } from '@/types/plan-builder';

const CATEGORY_ORDER: DeviceCategory[] = ['cameras', 'security', 'audio', 'data', 'av'];

export default function SymbolPalette() {
  const { deviceToPlace, setDeviceToPlace } = usePlanStore();
  const [expanded, setExpanded] = useState<Set<DeviceCategory>>(new Set(CATEGORY_ORDER));

  const toggleCategory = (cat: DeviceCategory) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const grouped = CATEGORY_ORDER.reduce((acc, cat) => {
    acc[cat] = DEVICE_CATALOG.filter(d => d.category === cat);
    return acc;
  }, {} as Record<DeviceCategory, DeviceDefinition[]>);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-3 border-b border-gray-700">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Devices</div>
        <div className="text-xs text-gray-600 mt-1">Click device, then click canvas</div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {CATEGORY_ORDER.map(cat => {
          const catColor = cat === 'cameras' || cat === 'data' || cat === 'av' ? CABLE_COLORS.cat6 : cat === 'security' ? CABLE_COLORS.sixcore : CABLE_COLORS.speaker;
          return (
            <div key={cat}>
              <button className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 hover:bg-gray-700 text-left transition-colors border-b border-gray-700"
                onClick={() => toggleCategory(cat)}>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-4 rounded-sm" style={{ backgroundColor: catColor }} />
                  <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">{CATEGORY_LABELS[cat]}</span>
                  <span className="text-gray-600 text-xs">({grouped[cat].length})</span>
                </div>
                <span className="text-gray-500 text-xs">{expanded.has(cat) ? '▼' : '▶'}</span>
              </button>
              {expanded.has(cat) && (
                <div className="py-0.5">
                  {cat === 'data' && (
                    <DeviceButton device={DEVICE_CATALOG.find(d => d.id === 'comms-rack')!} selected={deviceToPlace === 'comms-rack'}
                      onClick={() => setDeviceToPlace(deviceToPlace === 'comms-rack' ? null : 'comms-rack')} />
                  )}
                  {grouped[cat].filter(d => !d.isCommsRack).map(device => (
                    <DeviceButton key={device.id} device={device} selected={deviceToPlace === device.id}
                      onClick={() => setDeviceToPlace(deviceToPlace === device.id ? null : device.id)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SymbolPreview({ device }: { device: DeviceDefinition }) {
  if (device.symbolImage) return <img src={device.symbolImage} alt={device.name} className="w-4 h-4 object-contain" />;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="flex-shrink-0">
      <rect x={1} y={0} width={12} height={14} fill="#334455" stroke="#66aaff" strokeWidth={1} />
      <line x1={1} y1={5} x2={13} y2={5} stroke="#66aaff" strokeWidth={0.5} />
      <line x1={1} y1={9} x2={13} y2={9} stroke="#66aaff" strokeWidth={0.5} />
    </svg>
  );
}

function DeviceButton({ device, selected, onClick }: { device: DeviceDefinition; selected: boolean; onClick: () => void }) {
  return (
    <button
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors text-xs hover:bg-gray-700 ${selected ? 'bg-blue-900/60 border-l-2 border-blue-400' : 'border-l-2 border-transparent'}`}
      onClick={onClick}
      title={`${device.name} (${device.cableType === 'cat6' ? 'CAT6' : device.cableType === 'sixcore' ? '6-Core' : device.cableType === 'speaker' ? 'Speaker' : 'No cable'})`}>
      <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center"><SymbolPreview device={device} /></span>
      <span className="text-gray-300 leading-tight truncate">{device.name}</span>
    </button>
  );
}
