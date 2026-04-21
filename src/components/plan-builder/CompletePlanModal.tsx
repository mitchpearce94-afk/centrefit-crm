'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePlanStore } from '@/store/planStore';
import { generateQuoteExport } from '@/lib/plan-builder/quoteExport';
import { CATEGORY_LABELS } from '@/lib/plan-builder/devices';
import { createClient } from '@/lib/supabase/client';
import { autoTransitionJobStatus } from '@/lib/job-status-transitions';

interface Props {
  onClose: () => void;
}

// Map quote codes back to readable names for the summary
const DEVICE_LABELS: Record<string, { name: string; category: string }> = {
  camera_black: { name: 'Black Camera', category: 'cameras' },
  camera_white: { name: 'White Camera', category: 'cameras' },
  tailgate_system: { name: 'Tailgate System', category: 'cameras' },
  alarm_panel: { name: 'Alarm Panel', category: 'security' },
  alarm_keypad: { name: 'Alarm Keypad', category: 'security' },
  pir_wall: { name: 'PIR Wall Mount', category: 'security' },
  pir_360_roof: { name: 'PIR 360° Ceiling', category: 'security' },
  reed_switch: { name: 'Reed Switch', category: 'security' },
  rf_receiver: { name: 'RF Receiver', category: 'security' },
  door_lock: { name: 'Door Lock', category: 'security' },
  duress_button: { name: 'Duress Button', category: 'security' },
  duress_intercom: { name: 'Duress Intercom', category: 'security' },
  light_siren: { name: 'External Light & Siren', category: 'security' },
  bio_access: { name: 'BIO Access Control', category: 'security' },
  card_reader: { name: 'Swipe Card Reader', category: 'security' },
  rex_button: { name: 'REX Button', category: 'security' },
  speaker_roof_black: { name: 'Speaker Roof (Black)', category: 'audio' },
  speaker_roof_white: { name: 'Speaker Roof (White)', category: 'audio' },
  speaker_wall_black: { name: 'Speaker Wall (Black)', category: 'audio' },
  speaker_wall_white: { name: 'Speaker Wall (White)', category: 'audio' },
  wap: { name: 'Wi-Fi Access Point', category: 'data' },
  data_point: { name: 'Cat6 Data Point', category: 'data' },
  coax_point: { name: 'RG6 Coaxial', category: 'data' },
  integration_cable: { name: 'Integration Cable', category: 'security' },
  cabinet_9ru: { name: '9RU Cabinet', category: 'data' },
  cabinet_27ru: { name: '27RU Cabinet', category: 'data' },
  cabinet_32ru: { name: '32RU Cabinet', category: 'data' },
  cabinet_42ru: { name: '42RU Cabinet', category: 'data' },
  intercom_master: { name: 'Intercom Master', category: 'av' },
  intercom_slave: { name: 'Intercom Slave', category: 'av' },
  volume_control: { name: 'Volume Control', category: 'audio' },
};

export default function CompletePlanModal({ onClose }: Props) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const { titleBlock, linkedJobId, linkedJobNumber, planFileId } = usePlanStore();

  const exportData = generateQuoteExport();
  const { deviceCounts } = exportData;
  const totalDevices = Object.values(deviceCounts).reduce((a, b) => a + b, 0);

  // Group devices by category for display
  const grouped: Record<string, Array<{ name: string; count: number }>> = {};
  for (const [code, count] of Object.entries(deviceCounts)) {
    if (count === 0) continue;
    const info = DEVICE_LABELS[code] || { name: code, category: 'other' };
    const cat = info.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({ name: info.name, count });
  }

  const categoryOrder = ['cameras', 'security', 'audio', 'data', 'av', 'other'];
  const categoryColors: Record<string, string> = {
    cameras: '#3399ff', security: '#ff4444', audio: '#44cc44', data: '#3399ff', av: '#3399ff', other: '#888888',
  };

  async function handleSendToQuote() {
    setSending(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      const planName = [titleBlock.client, titleBlock.projectName, titleBlock.revision]
        .filter(Boolean).join(' - ') || 'Untitled Plan';

      // Use existing plan_files row (already saved by saveToCloud before modal opened)
      // If somehow missing, insert a new one
      let usePlanId: string | null = planFileId;
      if (!usePlanId) {
        const newId = crypto.randomUUID();
        const { data: newPlan, error } = await supabase.from('plan_files').upsert({
          id: newId,
          name: planName,
          client_name: titleBlock.client || null,
          site_name: titleBlock.projectName || null,
          site_address: titleBlock.worksAddress || null,
          state: titleBlock.state || 'QLD',
          device_counts: exportData.deviceCounts,
          site_info: exportData.siteInfo,
          floor_data: exportData.floors,
          raw_data: exportData,
          uploaded_by: user?.id ?? null,
        }, { onConflict: 'id' }).select('id').single();

        if (error || !newPlan) {
          alert('Failed to save plan: ' + (error?.message ?? 'Unknown error'));
          setSending(false);
          return;
        }
        usePlanId = newPlan.id;
        usePlanStore.setState({ planFileId: usePlanId });
      }

      // Transition linked job to "Quote Draft"
      if (linkedJobId) {
        await autoTransitionJobStatus(linkedJobId, 'quote_created', supabase);
      }

      // Navigate to quote wizard with plan pre-selected and job linked
      const params = new URLSearchParams();
      if (usePlanId) params.set('plan', usePlanId);
      if (linkedJobId) params.set('job', linkedJobId);

      router.push(`/quoting/new?${params.toString()}`);
    } catch (err) {
      console.error('Send to quote error:', err);
      alert('Something went wrong. Please try again.');
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg border border-gray-600 w-[520px] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-700 flex-shrink-0">
          <h2 className="text-white font-bold text-base">Complete Plan</h2>
          <p className="text-gray-400 text-xs mt-1">
            {titleBlock.client}{titleBlock.projectName ? ` — ${titleBlock.projectName}` : ''}
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Job link */}
          <div className="bg-gray-900 rounded-lg p-3">
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Linked Job</div>
            {linkedJobId ? (
              <div className="text-white text-sm font-medium">{linkedJobNumber}</div>
            ) : (
              <div className="text-amber-400 text-xs">No job linked — select a job from the toolbar before sending to quote</div>
            )}
          </div>

          {/* Device summary */}
          <div>
            <div className="flex items-center mb-2 px-3">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider flex-1">Device Summary</div>
              <div className="text-white text-sm font-bold w-8 text-right tabular-nums">{totalDevices}</div>
            </div>

            {totalDevices === 0 ? (
              <div className="text-gray-500 text-xs text-center py-4">No devices placed on the plan</div>
            ) : (
              <div className="space-y-3">
                {categoryOrder.map(cat => {
                  const items = grouped[cat];
                  if (!items || items.length === 0) return null;
                  const catLabel = CATEGORY_LABELS[cat] || cat;
                  const catColor = categoryColors[cat] || '#888';
                  const catTotal = items.reduce((a, b) => a + b.count, 0);
                  return (
                    <div key={cat} className="bg-gray-900 rounded-lg p-3">
                      <div className="flex items-center mb-1.5 px-3">
                        <div className="flex items-center gap-2 flex-1">
                          <div className="w-1.5 h-3 rounded-sm" style={{ backgroundColor: catColor }} />
                          <span className="text-xs font-semibold text-gray-300 uppercase">{catLabel}</span>
                        </div>
                        <span className="text-white text-xs font-bold w-8 text-right tabular-nums">{catTotal}</span>
                      </div>
                      <div className="space-y-0.5">
                        {items.map(item => (
                          <div key={item.name} className="flex items-center text-xs px-3">
                            <span className="text-gray-400 flex-1">{item.name}</span>
                            <span className="text-white font-medium w-8 text-right tabular-nums">{item.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Floor breakdown */}
          {exportData.floors.length > 1 && (
            <div>
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Per Floor</div>
              <div className="space-y-1">
                {exportData.floors.map(f => {
                  const floorTotal = Object.values(f.deviceCounts).reduce((a, b) => a + b, 0);
                  return (
                    <div key={f.name} className="flex items-center justify-between text-xs bg-gray-900 rounded px-3 py-1.5">
                      <span className="text-gray-300">{f.name}</span>
                      <span className="text-white font-medium">{floorTotal} devices</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-700 flex-shrink-0 flex items-center justify-between">
          <button
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
            onClick={onClose}
          >
            Back to Editor
          </button>
          <button
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded font-medium transition-colors disabled:opacity-50"
            onClick={handleSendToQuote}
            disabled={sending || totalDevices === 0}
          >
            {sending ? 'Sending...' : 'Send to Quote'}
          </button>
        </div>
      </div>
    </div>
  );
}
