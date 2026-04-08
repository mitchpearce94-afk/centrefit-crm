'use client';

import React, { useRef, useState } from 'react';
import { usePlanStore } from '@/store/planStore';
import { createClient } from '@/lib/supabase/client';
import { getPdfPages, renderPdfToImage, renderPdfPageWithElements, PdfPageInfo } from '@/lib/plan-builder/pdfUtils';
import { generateQuoteExport } from '@/lib/plan-builder/quoteExport';
import { exportToPdf } from '@/lib/plan-builder/exportUtils';
import PageSelector from '@/components/plan-builder/PageSelector';
import CompletePlanModal from '@/components/plan-builder/CompletePlanModal';

export interface JobOption {
  id: string;
  number: string;
  reference: string | null;
  customer: { id: string; name: string } | { id: string; name: string }[] | null;
}

export default function Toolbar({ jobs = [] }: { jobs?: JobOption[] }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const [showPageSelector, setShowPageSelector] = useState(false);
  const [pdfPages, setPdfPages] = useState<PdfPageInfo[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [revisionNotes, setRevisionNotes] = useState('');
  const [showFloorModal, setShowFloorModal] = useState(false);
  const [newFloorName, setNewFloorName] = useState('');
  const [showCompletePlan, setShowCompletePlan] = useState(false);

  const {
    activeTool, setActiveTool,
    layers, toggleLayer,
    activePlan, setActivePlan,
    devices, titleBlock,
    stageScale, stageX, stageY, setStageTransform,
    backgroundWidth, backgroundHeight,
    saveProject, loadProject,
    undo, redo,
    setBackground, pdfFileName,
    floors, activeFloorId, addFloor, switchFloor, removeFloor,
    bumpRevision,
    linkedJobId, setLinkedJob,
    selectedElementIds, deleteSelectedElements,
    setPdfSource, setPdfElements,
    deviceScale, setDeviceScale,
  } = usePlanStore();

  const [loadingPdf, setLoadingPdf] = useState(false);

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const pages = await getPdfPages(file);
      if (pages.length === 1) {
        setLoadingPdf(true);
        const { dataUrl, width, height, elements } = await renderPdfPageWithElements(file, 1);
        setBackground(dataUrl, width, height, file.name);
        setPdfSource(file, 1);
        setPdfElements(elements);
        setLoadingPdf(false);
      } else {
        setPdfPages(pages);
        setPendingFile(file);
        setShowPageSelector(true);
      }
    } catch (err) {
      console.error('PDF render error:', err);
      alert('Failed to render PDF. Please try again.');
      setLoadingPdf(false);
    }
    e.target.value = '';
  };

  const handlePageSelect = async (pageNumber: number) => {
    if (!pendingFile) return;
    setShowPageSelector(false);
    setLoadingPdf(true);
    console.log(`[Plan Builder] Loading page ${pageNumber} with element extraction...`);
    try {
      const { dataUrl, width, height, elements } = await renderPdfPageWithElements(pendingFile, pageNumber);
      console.log(`[Plan Builder] Page loaded: ${width}x${height}, ${elements.length} elements`);
      setBackground(dataUrl, width, height, `${pendingFile.name} (p${pageNumber})`);
      setPdfSource(pendingFile, pageNumber);
      setPdfElements(elements);
    } catch (err) {
      console.error('PDF page render error:', err);
      alert('Failed to render selected page. Please try again.');
    }
    setLoadingPdf(false);
    setPendingFile(null);
    setPdfPages([]);
  };

  const handlePageSelectorCancel = () => { setShowPageSelector(false); setPendingFile(null); setPdfPages([]); };

  const handleProjectLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        loadProject(ev.target.result as string);
        usePlanStore.setState({ planFileId: null }); // new local file, not linked to existing DB row
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const [saving, setSaving] = useState(false);

  const saveToCloud = async () => {
    const store = usePlanStore.getState();
    setSaving(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const tb = store.titleBlock;

      // Build .cfp JSON
      const syncedFloors = store.floors.map(f =>
        f.id === store.activeFloorId
          ? { ...f, backgroundImage: store.backgroundImage, backgroundWidth: store.backgroundWidth, backgroundHeight: store.backgroundHeight, pdfFileName: store.pdfFileName, devices: store.devices, commsRackId: store.commsRackId, whitewashRects: store.whitewashRects }
          : f
      );
      const cfpData = JSON.stringify({
        version: 2, floors: syncedFloors, activeFloorId: store.activeFloorId,
        titleBlock: tb, clientLogo: store.clientLogo, revisions: store.revisions,
        deviceScale: store.deviceScale,
        linkedJobId: store.linkedJobId, linkedJobNumber: store.linkedJobNumber,
      });

      const planName = [tb.client, tb.projectName, tb.revision].filter(Boolean).join(' - ') || 'Untitled Plan';
      const exportData = generateQuoteExport();

      // Upload .cfp to Storage
      const planId = store.planFileId || crypto.randomUUID();
      console.log(`[Plan Builder] Saving to cloud: planFileId=${store.planFileId}, using=${planId}`);
      const cfpBlob = new Blob([cfpData], { type: 'application/json' });
      const cfpPath = `plans/${planId}.cfp`;
      await supabase.storage.from('plan-files').upload(cfpPath, cfpBlob, { upsert: true });
      const { data: cfpUrlData } = supabase.storage.from('plan-files').getPublicUrl(cfpPath);

      // Upsert plan_files row
      const planRow = {
        id: planId,
        name: planName,
        client_name: tb.client || null,
        site_name: tb.projectName || null,
        site_address: tb.worksAddress || null,
        state: tb.state || 'QLD',
        revision: tb.revision || 'A',
        device_counts: exportData.deviceCounts,
        site_info: exportData.siteInfo,
        floor_data: exportData.floors,
        cfp_url: cfpUrlData?.publicUrl || null,
        uploaded_by: user?.id ?? null,
        job_id: store.linkedJobId || null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('plan_files').upsert(planRow, { onConflict: 'id' });
      if (error) {
        console.error('Failed to save plan:', error);
        alert('Failed to save plan to cloud: ' + error.message);
      } else {
        usePlanStore.setState({ planFileId: planId });
      }
    } catch (err) {
      console.error('Cloud save error:', err);
    }
    setSaving(false);
  };

  const handleSave = async () => {
    usePlanStore.getState().saveProject(); // local .cfp download
    await saveToCloud(); // also save to Supabase
  };

  const handleExport = async () => {
    await saveToCloud();
    const pdfBlob = await exportToPdf();

    // Upload PDF to Supabase Storage
    if (pdfBlob) {
      try {
        const store = usePlanStore.getState();
        const planId = store.planFileId;
        if (planId) {
          const supabase = createClient();
          const pdfPath = `plans/${planId}.pdf`;
          await supabase.storage.from('plan-files').upload(pdfPath, pdfBlob, { upsert: true, contentType: 'application/pdf' });
          const { data: pdfUrlData } = supabase.storage.from('plan-files').getPublicUrl(pdfPath);
          if (pdfUrlData?.publicUrl) {
            await supabase.from('plan_files').update({ pdf_url: pdfUrlData.publicUrl, updated_at: new Date().toISOString() }).eq('id', planId);
            console.log('[Plan Builder] PDF uploaded to storage');
          }
        }
      } catch (err) {
        console.error('Failed to upload PDF to storage:', err);
      }
    }
  };

  const handleCompletePlan = async () => {
    await saveToCloud();
    setShowCompletePlan(true);
  };

  const handleFitToScreen = () => {
    const containerEl = document.querySelector('.canvas-container');
    if (!containerEl) return;
    const { width, height } = containerEl.getBoundingClientRect();
    const scaleX = (width * 0.9) / backgroundWidth;
    const scaleY = (height * 0.9) / backgroundHeight;
    const scale = Math.min(scaleX, scaleY, 1);
    const x = (width - backgroundWidth * scale) / 2;
    const y = (height - backgroundHeight * scale) / 2;
    setStageTransform(scale, x, y);
  };

  const zoomAtCenter = (newScale: number) => {
    const containerEl = document.querySelector('.canvas-container');
    if (!containerEl) return setStageTransform(newScale, stageX, stageY);
    const { width, height } = containerEl.getBoundingClientRect();
    const cx = width / 2;
    const cy = height / 2;
    const mousePointTo = { x: (cx - stageX) / stageScale, y: (cy - stageY) / stageScale };
    setStageTransform(newScale, cx - mousePointTo.x * newScale, cy - mousePointTo.y * newScale);
  };

  const planButtons: Array<{ id: 'master' | 'cat6' | 'sixcore' | 'speaker'; label: string; color: string }> = [
    { id: 'master', label: 'Master', color: '#aaaaaa' },
    { id: 'cat6', label: 'CAT6', color: '#3399ff' },
    { id: 'sixcore', label: '6-Core', color: '#ff4444' },
    { id: 'speaker', label: 'Speaker', color: '#44cc44' },
  ];

  void layers;
  void toggleLayer;

  return (
    <div className="flex items-center gap-1 px-3 py-2 bg-gray-900 border-b border-gray-700 flex-wrap">
      <div className="flex items-center gap-1 pr-3 border-r border-gray-700">
        <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handlePdfUpload} />
        <button className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded font-medium transition-colors"
          onClick={() => fileInputRef.current?.click()}>Upload PDF</button>
        {pdfFileName && <span className="text-gray-400 text-xs truncate max-w-32">{pdfFileName}</span>}
      </div>

      <div className="flex items-center gap-1 pr-3 border-r border-gray-700">
        {([
          { id: 'select' as const, icon: '↖', label: 'Select' },
          { id: 'pan' as const, icon: '✋', label: 'Pan' },
          { id: 'elementSelect' as const, icon: '◎', label: 'Select PDF elements to remove' },
          { id: 'erase' as const, icon: '⬜', label: 'Erase (whitewash areas)' },
          { id: 'crop' as const, icon: '⬒', label: 'Crop background' },
        ]).map(({ id, icon, label }) => (
          <button key={id} title={label}
            className={`px-2.5 py-1.5 text-xs rounded transition-colors ${activeTool === id ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
            onClick={() => setActiveTool(id)}>{icon}</button>
        ))}
      </div>

      {/* Delete selected elements */}
      {selectedElementIds.length > 0 && (
        <div className="flex items-center gap-1 pr-3 border-r border-gray-700">
          <button
            className="px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white text-xs rounded font-medium transition-colors"
            onClick={() => deleteSelectedElements()}
          >Delete ({selectedElementIds.length})</button>
        </div>
      )}

      <div className="flex items-center gap-1 pr-3 border-r border-gray-700">
        <button className="px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded"
          onClick={() => zoomAtCenter(Math.min(stageScale * 1.2, 5))}>+</button>
        <span className="text-gray-400 text-xs w-10 text-center">{Math.round(stageScale * 100)}%</span>
        <button className="px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded"
          onClick={() => zoomAtCenter(Math.max(stageScale / 1.2, 0.1))}>−</button>
        <button className="px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded"
          onClick={handleFitToScreen} title="Fit to screen">⊡</button>
      </div>

      <div className="flex items-center gap-1 pr-3 border-r border-gray-700" title="Device size scale">
        <span className="text-gray-500 text-xs">Size:</span>
        <input type="range" min="0.5" max="4" step="0.25" value={deviceScale}
          onChange={(e) => setDeviceScale(parseFloat(e.target.value))}
          className="w-20 h-1 accent-blue-500 cursor-pointer" />
        <span className="text-gray-400 text-xs w-8 text-center">{deviceScale}x</span>
      </div>

      <div className="flex items-center gap-1 pr-3 border-r border-gray-700">
        <button className="px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded" onClick={undo} title="Undo (Ctrl+Z)">↩</button>
        <button className="px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded" onClick={redo} title="Redo (Ctrl+Y)">↪</button>
      </div>

      <div className="flex items-center gap-1 pr-3 border-r border-gray-700">
        <span className="text-gray-500 text-xs mr-1">View:</span>
        {planButtons.map(({ id, label, color }) => (
          <button key={id}
            className={`px-2.5 py-1.5 text-xs rounded transition-colors border ${activePlan === id ? 'text-white border-transparent' : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'}`}
            style={activePlan === id ? { backgroundColor: color, borderColor: color } : {}}
            onClick={() => setActivePlan(id)}>{label}</button>
        ))}
      </div>

      <div className="flex items-center gap-1 pr-3 border-r border-gray-700">
        <button className="px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded disabled:opacity-50" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        <input ref={projectInputRef} type="file" accept=".cfp,.json" className="hidden" onChange={handleProjectLoad} />
        <button className="px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded"
          onClick={() => projectInputRef.current?.click()}>Load</button>
      </div>

      {/* Job selector */}
      <div className="flex items-center gap-1 pr-3 border-r border-gray-700">
        <span className="text-gray-500 text-xs">Job:</span>
        <select
          value={linkedJobId || ''}
          onChange={(e) => {
            const jobId = e.target.value || null;
            const job = jobs.find(j => j.id === jobId);
            const cust = job?.customer ? (Array.isArray(job.customer) ? job.customer[0] : job.customer) : null;
            setLinkedJob(jobId, job ? `${job.number}${cust ? ' — ' + cust.name : ''}` : null);
          }}
          className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-blue-500 max-w-48 truncate"
        >
          <option value="">No job linked</option>
          {jobs.map(j => {
            const cust = j.customer ? (Array.isArray(j.customer) ? j.customer[0] : j.customer) : null;
            return (
              <option key={j.id} value={j.id}>
                {j.number}{cust ? ` — ${cust.name}` : ''}{j.reference ? ` (${j.reference})` : ''}
              </option>
            );
          })}
        </select>
      </div>

      {/* Export + Complete */}
      <div className="flex items-center gap-1">
        <button className="px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs rounded font-medium transition-colors"
          onClick={handleExport}>Export PDF</button>
        <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded font-medium transition-colors"
          onClick={handleCompletePlan}>Complete Plan</button>
      </div>

      <div className="ml-auto flex items-center gap-2 text-xs">
        <div className="flex items-center gap-1 pr-2 border-r border-gray-700">
          {floors.map(f => (
            <div key={f.id} className="flex items-center">
              <button className={`px-2 py-1 rounded-l transition-colors ${f.id === activeFloorId ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'} ${floors.length <= 1 ? 'rounded-r' : ''}`}
                onClick={() => switchFloor(f.id)}>{f.name}</button>
              {floors.length > 1 && f.id === activeFloorId && (
                <button className="px-1 py-1 bg-red-800 hover:bg-red-700 text-red-300 rounded-r text-xs"
                  onClick={() => { if (confirm(`Delete "${f.name}"? All devices on this floor will be lost.`)) removeFloor(f.id); }}
                  title={`Delete ${f.name}`}>x</button>
              )}
            </div>
          ))}
          <button className="px-1.5 py-1 bg-gray-700 hover:bg-gray-600 text-gray-400 rounded"
            onClick={() => { setNewFloorName(`Level ${floors.length}`); setShowFloorModal(true); }} title="Add floor">+</button>
        </div>
        <button className="px-2 py-1 bg-amber-800 hover:bg-amber-700 text-amber-200 rounded"
          onClick={() => setShowRevisionModal(true)} title="Bump revision">Rev {titleBlock.revision}</button>
        <span className="text-gray-500">{devices.length} devices</span>
      </div>

      {showPageSelector && <PageSelector pages={pdfPages} onSelect={handlePageSelect} onCancel={handlePageSelectorCancel} />}

      {showRevisionModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-5 w-96 border border-gray-600">
            <h3 className="text-white font-bold text-sm mb-3">Bump Revision: {titleBlock.revision} → {String.fromCharCode((titleBlock.revision || 'A').charCodeAt(0) + 1)}</h3>
            <textarea className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-xs focus:outline-none focus:border-blue-500 mb-3"
              rows={3} placeholder="What changed in this revision?" value={revisionNotes} onChange={e => setRevisionNotes(e.target.value)} autoFocus />
            <div className="flex gap-2 justify-end">
              <button className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded"
                onClick={() => { setShowRevisionModal(false); setRevisionNotes(''); }}>Cancel</button>
              <button className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 text-white text-xs rounded font-medium"
                onClick={() => { bumpRevision(revisionNotes || 'No notes'); setShowRevisionModal(false); setRevisionNotes(''); }}>Bump Revision</button>
            </div>
          </div>
        </div>
      )}

      {showCompletePlan && <CompletePlanModal onClose={() => setShowCompletePlan(false)} />}

      {showFloorModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-5 w-80 border border-gray-600">
            <h3 className="text-white font-bold text-sm mb-3">Add Floor</h3>
            <input type="text" className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 mb-3"
              placeholder="Floor name" value={newFloorName} onChange={e => setNewFloorName(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && newFloorName.trim()) { addFloor(newFloorName.trim()); setShowFloorModal(false); setNewFloorName(''); } }} />
            <div className="flex gap-2 justify-end">
              <button className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded"
                onClick={() => { setShowFloorModal(false); setNewFloorName(''); }}>Cancel</button>
              <button className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded font-medium"
                onClick={() => { if (newFloorName.trim()) { addFloor(newFloorName.trim()); setShowFloorModal(false); setNewFloorName(''); } }}>Add Floor</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
