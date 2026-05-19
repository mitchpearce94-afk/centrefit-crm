'use client';

import React, { useRef } from 'react';
import { usePlanStore } from '@/store/planStore';
import { getDeviceById } from '@/lib/plan-builder/devices';

export default function PropertiesPanel() {
  const logoInputRef = useRef<HTMLInputElement>(null);
  const {
    selectedDeviceId, devices, commsRackId,
    titleBlock, updateTitleBlock,
    clientLogo, setClientLogo,
    rotateDevice, deleteDevice, setCommsRack,
    setSpeakerZone, setDataCount, setConcreteMounted, setProvisional, setCabled,
  } = usePlanStore();

  const selectedDevice = selectedDeviceId ? devices.find(d => d.instanceId === selectedDeviceId) : null;
  const selectedDef = selectedDevice ? getDeviceById(selectedDevice.deviceId) : null;
  const isCommsRack = selectedDevice?.instanceId === commsRackId;
  const isSpeaker = selectedDef?.cableType === 'speaker';
  const isReedSwitch = selectedDevice?.deviceId === 'reed-switch';
  const isDataOutlet = selectedDevice?.deviceId === 'cat6-data' || selectedDevice?.deviceId === 'rg6-coax';

  return (
    <div className="flex flex-col h-full overflow-y-auto text-xs">
      <div className="p-3 border-b border-gray-700">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Device Properties</div>
        {selectedDevice && selectedDef ? (
          <div className="space-y-2">
            <div><div className="text-gray-400">Device</div><div className="text-white font-medium">{selectedDef.name}</div></div>
            <div><div className="text-gray-400">Label #</div><div className="text-white">{isCommsRack ? 'Comms Rack' : selectedDevice.labelNum}</div></div>
            <div className="grid grid-cols-2 gap-1">
              <div><div className="text-gray-400">X</div><div className="text-white">{Math.round(selectedDevice.x)}</div></div>
              <div><div className="text-gray-400">Y</div><div className="text-white">{Math.round(selectedDevice.y)}</div></div>
            </div>
            {isSpeaker && !isCommsRack && (
              <div className="bg-gray-800 rounded p-2">
                <div className="text-gray-400 mb-1">{selectedDef?.isVolumeControl ? 'Volume Control Zone' : 'Speaker Zone'}</div>
                <select value={selectedDevice?.speakerZone || 1}
                  onChange={e => setSpeakerZone(selectedDevice!.instanceId, parseInt(e.target.value))}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-blue-500">
                  {[1, 2, 3, 4, 5, 6].map(z => <option key={z} value={z}>Zone {z}{z === 1 ? ' (A)' : ` (${String.fromCharCode(64 + z)})`}</option>)}
                </select>
              </div>
            )}
            {isDataOutlet && (
              <div className="bg-gray-800 rounded p-2">
                <div className="text-gray-400 mb-1">Data points at this marker</div>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={selectedDevice?.dataCount ?? 1}
                  onChange={e => setDataCount(selectedDevice!.instanceId, parseInt(e.target.value) || 1)}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-blue-500"
                />
                <div className="text-[10px] text-gray-500 mt-1">
                  Shown as ×N badge on the plan. Numbering follows placement
                  order, not left-to-right, so cable labels match install
                  sequence.
                </div>
              </div>
            )}
            {!isCommsRack && (
              <div className="bg-gray-800 rounded p-2 space-y-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!selectedDevice.concreteMounted}
                    onChange={e => setConcreteMounted(selectedDevice.instanceId, e.target.checked)}
                    className="accent-blue-500 cursor-pointer" />
                  <span className="text-gray-300">Concrete Mounted</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!selectedDevice.provisional}
                    onChange={e => setProvisional(selectedDevice.instanceId, e.target.checked)}
                    className="accent-amber-500 cursor-pointer" />
                  <span className="text-gray-300">Provisional</span>
                </label>
                {isReedSwitch && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selectedDevice.cabled !== false}
                      onChange={e => setCabled(selectedDevice.instanceId, e.target.checked)}
                      className="accent-green-500 cursor-pointer" />
                    <span className="text-gray-300">Cabled</span>
                  </label>
                )}
              </div>
            )}
            <div className="flex flex-col gap-1 pt-1">
              <button className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
                onClick={() => rotateDevice(selectedDevice.instanceId, (selectedDevice.rotation + 45) % 360)}>Rotate 45°</button>
              {!isCommsRack && (
                <button className="px-2 py-1 bg-blue-800 hover:bg-blue-700 rounded text-white"
                  onClick={() => setCommsRack(selectedDevice.instanceId)}>Set as Comms Rack</button>
              )}
              <button className="px-2 py-1 bg-red-900 hover:bg-red-800 rounded text-red-300"
                onClick={() => deleteDevice(selectedDevice.instanceId)}>Delete Device</button>
            </div>
          </div>
        ) : (
          <div className="text-gray-500">Click a device to select it</div>
        )}
      </div>
      <div className="p-3">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Title Block</div>
        <div className="space-y-1.5">
          {[
            { label: 'Client', key: 'client' },
            { label: 'Project Name', key: 'projectName' },
            { label: 'Works Address', key: 'worksAddress' },
            { label: 'State', key: 'state' },
            { label: 'Drawing #', key: 'drawingNumber' },
            { label: 'Revision', key: 'revision' },
            { label: 'Date', key: 'date' },
          ].map(({ label, key }) => (
            <div key={key}>
              <div className="text-gray-500 mb-0.5">{label}</div>
              <input type="text" value={titleBlock[key as keyof typeof titleBlock]}
                onChange={e => updateTitleBlock({ [key]: e.target.value })}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-blue-500" />
            </div>
          ))}
          <div className="pt-2 border-t border-gray-700 mt-2">
            <div className="text-gray-500 mb-0.5">Notes</div>
            <textarea
              value={titleBlock.notes || ''}
              onChange={e => updateTitleBlock({ notes: e.target.value })}
              rows={4}
              placeholder="Plan notes..."
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-blue-500 resize-y"
            />
          </div>
          <div className="pt-2 border-t border-gray-700 mt-2">
            <div className="text-gray-500 mb-1">Client Logo</div>
            <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => { if (ev.target?.result) setClientLogo(ev.target.result as string); };
                reader.readAsDataURL(file);
                e.target.value = '';
              }} />
            {clientLogo ? (
              <div className="space-y-1">
                <img src={clientLogo} alt="Client logo" className="max-h-10 max-w-full bg-white rounded p-0.5" />
                <div className="flex gap-1">
                  <button className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 text-xs" onClick={() => logoInputRef.current?.click()}>Change</button>
                  <button className="px-2 py-0.5 bg-red-900 hover:bg-red-800 rounded text-red-300 text-xs" onClick={() => setClientLogo(null)}>Remove</button>
                </div>
              </div>
            ) : (
              <button className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 text-xs w-full" onClick={() => logoInputRef.current?.click()}>Upload Logo</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
