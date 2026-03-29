'use client';

import React from 'react';
import { usePlanStore } from '@/store/planStore';
import { getDeviceById } from '@/lib/plan-builder/devices';

export default function TitleBlock() {
  const { titleBlock, activePlan, devices } = usePlanStore();

  const planName = activePlan === 'master' ? 'MASTER PLAN' :
    activePlan === 'cat6' ? 'CAT6 CABLE PLAN' :
    activePlan === 'sixcore' ? '6-CORE CABLE PLAN' : 'SPEAKER CABLE PLAN';

  return (
    <div className="flex items-stretch border-t border-gray-600 bg-gray-900" style={{ height: '64px', minHeight: '64px' }}>
      <div className="flex items-center px-4 border-r border-gray-700 bg-gray-900" style={{ minWidth: '160px' }}>
        <div>
          <div className="text-blue-400 font-bold text-sm tracking-wide">CENTREFIT GROUP</div>
          <div className="text-gray-500 text-xs">Security &amp; AV</div>
        </div>
      </div>
      <div className="flex items-center px-4 border-r border-gray-700 flex-1">
        <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
          <div><span className="text-gray-500">Client: </span><span className="text-white">{titleBlock.client}</span></div>
          <div><span className="text-gray-500">Drawing #: </span><span className="text-white">{titleBlock.drawingNumber}</span></div>
          <div><span className="text-gray-500">Project: </span><span className="text-white">{titleBlock.projectName || '—'}</span></div>
          <div><span className="text-gray-500">Revision: </span><span className="text-white">{titleBlock.revision}</span></div>
          <div><span className="text-gray-500">Address: </span><span className="text-white">{titleBlock.worksAddress || '—'}</span></div>
          <div><span className="text-gray-500">Date: </span><span className="text-white">{titleBlock.date}</span></div>
        </div>
      </div>
      <div className="flex items-center px-4 border-r border-gray-700" style={{ minWidth: '150px' }}>
        <div className="text-center">
          <div className="text-xs text-gray-500 mb-0.5">Plan Type</div>
          <div className="font-bold text-sm" style={{
            color: activePlan === 'cat6' ? '#3399ff' : activePlan === 'sixcore' ? '#ff4444' : activePlan === 'speaker' ? '#44cc44' : '#aaaaaa'
          }}>{planName}</div>
        </div>
      </div>
      <div className="flex items-center px-4" style={{ minWidth: '140px' }}>
        <div className="text-xs space-y-0.5">
          <div><span className="text-gray-500">Devices: </span><span className="text-white">{devices.length}</span></div>
          <div><span style={{ color: '#3399ff' }}>CAT6: </span><span className="text-white">{devices.filter(d => { const def = getDeviceById(d.deviceId); return def?.cableType === 'cat6'; }).length}</span></div>
          <div><span style={{ color: '#ff4444' }}>6-Core: </span><span className="text-white">{devices.filter(d => { const def = getDeviceById(d.deviceId); return def?.cableType === 'sixcore'; }).length}</span></div>
        </div>
      </div>
    </div>
  );
}
