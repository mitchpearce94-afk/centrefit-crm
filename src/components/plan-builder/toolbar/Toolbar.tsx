'use client';

import React, { useRef, useState } from 'react';
import { usePlanStore } from '@/store/planStore';
import { createClient } from '@/lib/supabase/client';
import { getPdfPages, renderPdfToImage, renderPdfPageWithElements, PdfPageInfo } from '@/lib/plan-builder/pdfUtils';
import { generateQuoteExport } from '@/lib/plan-builder/quoteExport';
import { exportToPdf } from '@/lib/plan-builder/exportUtils';
import { supportsFilePicker, pickSaveFile, writeToHandle, downloadBlob, type SaveFileHandle } from '@/lib/plan-builder/fileSave';
import PageSelector from '@/components/plan-builder/PageSelector';
import CompletePlanModal from '@/components/plan-builder/CompletePlanModal';

export interface JobOption {
  id: string;
  number: string;
  reference: string | null;
  customer: { id: string; name: string } | { id: string; name: string }[] | null;
  site:
    | { id: string; name: string | null; address: string | null; suburb: string | null; postcode: string | null; state: string | null }
    | { id: string; name: string | null; address: string | null; suburb: string | null; postcode: string | null; state: string | null }[]
    | null;
}

function unwrap<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

function formatWorksAddress(site: { address: string | null; suburb: string | null; postcode: string | null } | null): string {
  if (!site) return '';
  return [site.address, site.suburb, site.postcode].filter(Boolean).join(', ');
}

function jobLabel(j: JobOption): string {
  const cust = unwrap(j.customer);
  const site = unwrap(j.site);
  const head = cust ? `${cust.name}${site?.name ? ` - ${site.name}` : ''}` : j.number;
  const tail = cust ? ` (${j.number})` : '';
  const ref = j.reference ? ` · ${j.reference}` : '';
  return `${head}${tail}${ref}`;
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
    backgroundLocked, backgroundScale, toggleBackgroundLock, setBackgroundScale,
    backgroundImage,
    saveProject, loadProject,
    undo, redo,
    setBackground, pdfFileName,
    floors, activeFloorId, addFloor, switchFloor, removeFloor, moveFloor,
    bumpRevision,
    linkedJobId, setLinkedJob,
    updateTitleBlock,
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
        // planFileId is now restored from the .cfp file itself — no need to null it
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const [saving, setSaving] = useState(false);
  // Track which step of the save the user is on so the button can show
  // "Saving…" → "Generating PDF…" instead of just hanging on "Saving…".
  const [savingPhase, setSavingPhase] = useState<"idle" | "uploading" | "rendering">("idle");

  /**
   * Save everything to Supabase: .cfp + plan_files row + freshly-rendered PDF.
   * Returns the generated PDF blob so callers (e.g. Export) can also trigger
   * a browser download without doing the work twice.
   */
  const saveToCloud = async (): Promise<Blob | null> => {
    const store = usePlanStore.getState();
    setSaving(true);
    setSavingPhase("uploading");
    let pdfBlob: Blob | null = null;
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const tb = store.titleBlock;

      // Build .cfp JSON
      const syncedFloors = store.floors.map(f =>
        f.id === store.activeFloorId
          ? { ...f, backgroundImage: store.backgroundImage, backgroundWidth: store.backgroundWidth, backgroundHeight: store.backgroundHeight, backgroundOffsetX: store.backgroundOffsetX, backgroundOffsetY: store.backgroundOffsetY, backgroundScale: store.backgroundScale, backgroundLocked: store.backgroundLocked, pdfFileName: store.pdfFileName, devices: store.devices, commsRackId: store.commsRackId, whitewashRects: store.whitewashRects }
          : f
      );
      const planId = store.planFileId || crypto.randomUUID();
      const cfpData = JSON.stringify({
        version: 2, floors: syncedFloors, activeFloorId: store.activeFloorId,
        titleBlock: tb, clientLogo: store.clientLogo, revisions: store.revisions,
        deviceScale: store.deviceScale,
        linkedJobId: store.linkedJobId, linkedJobNumber: store.linkedJobNumber,
        planFileId: planId,
        customDevices: store.customDevices,
      });

      const planName = [tb.client, tb.projectName, tb.revision].filter(Boolean).join(' - ') || 'Untitled Plan';
      const exportData = generateQuoteExport();

      // Generate the PDF in parallel-ish — started before any cloud write so
      // the user's wall-clock save is the max(cfp+row, pdf-render) and not
      // the sum, and so a failed cloud save can still hand the rendered blob
      // back to callers for the local file write. Render reads from the
      // in-memory store, which is already up to date.
      const pdfPromise = exportToPdf({ download: false }).catch((err) => {
        console.error("[Plan Builder] PDF render failed during save:", err);
        return null as Blob | null;
      });

      // No session = every write below bounces off RLS as anon with a
      // cryptic policy error. Stop early with rescue instructions instead.
      if (!user) {
        pdfBlob = await pdfPromise;
        alert(
          "Your login session has expired, so the plan can't be saved to the cloud.\n\n" +
          "DON'T refresh or close this tab — you'll lose your work.\n\n" +
          "1. Open a NEW tab and log back into the CRM.\n" +
          "2. Come back to this tab and hit Save again."
        );
        return pdfBlob;
      }

      // Upload .cfp to Storage
      console.log(`[Plan Builder] Saving to cloud: planFileId=${store.planFileId}, using=${planId}`);
      const cfpBlob = new Blob([cfpData], { type: 'application/json' });
      const cfpPath = `plans/${planId}.cfp`;
      const cfpUpload = await supabase.storage.from('plan-files').upload(cfpPath, cfpBlob, { upsert: true });
      if (cfpUpload.error) {
        // Skip the row upsert too — metadata pointing at a missing or stale
        // .cfp is worse than no update at all.
        console.error('[Plan Builder] .cfp upload failed:', cfpUpload.error);
        pdfBlob = await pdfPromise;
        alert('Failed to save plan to cloud (.cfp upload): ' + cfpUpload.error.message);
        return pdfBlob;
      }
      const { data: cfpUrlData } = supabase.storage.from('plan-files').getPublicUrl(cfpPath);

      // Initial row upsert (cfp_url + metadata) — done before the PDF
      // finishes so the row exists even if PDF gen fails.
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
        pdfBlob = await pdfPromise;
        alert('Failed to save plan to cloud: ' + error.message);
        return pdfBlob;
      }

      usePlanStore.setState({ planFileId: planId });
      // Wait for PDF + upload before marking clean / clearing the URL hint
      // so the next "Send to electrician" sees the fresh file.
      setSavingPhase("rendering");
      pdfBlob = await pdfPromise;
      if (pdfBlob) {
        const pdfPath = `plans/${planId}.pdf`;
        const upRes = await supabase.storage.from('plan-files').upload(pdfPath, pdfBlob, { upsert: true, contentType: 'application/pdf' });
        if (upRes.error) {
          console.error('[Plan Builder] PDF upload failed:', upRes.error);
        } else {
          const { data: pdfUrlData } = supabase.storage.from('plan-files').getPublicUrl(pdfPath);
          if (pdfUrlData?.publicUrl) {
            await supabase
              .from('plan_files')
              .update({ pdf_url: pdfUrlData.publicUrl, updated_at: new Date().toISOString() })
              .eq('id', planId);
            console.log('[Plan Builder] PDF refreshed alongside save');
          }
        }
      }

      usePlanStore.getState().markClean();
      if (window.location.pathname === '/plans/new') {
        window.history.replaceState(null, '', `/plans/${planId}`);
      }
    } catch (err) {
      // Early returns above skip this, so the finally block owns the state
      // reset — without it a thrown save left the button stuck on "Saving…".
      console.error('Cloud save error:', err);
      alert('Failed to save plan to cloud: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
      setSavingPhase("idle");
    }
    return pdfBlob;
  };

  // Both save flavours share ONE naming policy (state - client - project -
  // revision - date) so the .cfq and the exported .pdf sort together in the
  // job folder.
  const planBaseName = () => {
    const tb = usePlanStore.getState().titleBlock;
    const parts = [tb.state, tb.client, tb.projectName, tb.revision, tb.date].filter(Boolean);
    return parts.length > 0
      ? parts.join(' - ').replace(/[^a-zA-Z0-9\-_ \/]/g, '')
      : 'centrefit-plan';
  };
  const cfqFilename = () => `${planBaseName()}.cfq`;
  const pdfFilename = () => `${planBaseName()}.pdf`;

  // Save Plan: persist to the CRM (cloud) as before, AND drop the .cfq quote
  // file into a folder the user picks (e.g. their OneDrive folder). The save
  // dialog must open before the cloud save (user-gesture rule).
  const handleSavePlan = async () => {
    const name = cfqFilename();
    let handle: SaveFileHandle | null = null;
    let cancelled = false;
    if (supportsFilePicker()) {
      const res = await pickSaveFile(name, 'Centrefit Quote File', 'application/octet-stream', '.cfq');
      if (res === 'cancelled') cancelled = true;
      else handle = res;
    }
    await saveToCloud(); // always keep the CRM copy in sync
    if (cancelled) return;
    const data = generateQuoteExport();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    try {
      if (handle) await writeToHandle(handle, blob);
      else downloadBlob(blob, name);
    } catch (err) {
      console.error('[Plan Builder] Save Plan (.cfq) failed:', err);
    }
  };

  // Save PDF: cloud save (renders + uploads the fresh PDF), then write it to a
  // folder the user picks instead of dumping to Downloads.
  const handleSavePdf = async () => {
    const name = pdfFilename();
    let handle: SaveFileHandle | null = null;
    let cancelled = false;
    if (supportsFilePicker()) {
      const res = await pickSaveFile(name, 'PDF Document', 'application/pdf', '.pdf');
      if (res === 'cancelled') cancelled = true;
      else handle = res;
    }
    const pdfBlob = await saveToCloud();
    if (cancelled || !pdfBlob) return;
    try {
      if (handle) await writeToHandle(handle, pdfBlob);
      else downloadBlob(pdfBlob, name);
    } catch (err) {
      console.error('[Plan Builder] Save PDF failed:', err);
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
          { id: 'moveBackground' as const, icon: '⊞', label: 'Move background plan' },
          { id: 'elementSelect' as const, icon: '◎', label: 'Select PDF elements to remove' },
          { id: 'erase' as const, icon: '⬜', label: 'Erase (whitewash areas)' },
          { id: 'crop' as const, icon: '⬒', label: 'Crop background' },
        ]).map(({ id, icon, label }) => (
          <button key={id} title={label}
            className={`px-2.5 py-1.5 text-xs rounded transition-colors ${activeTool === id ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
            onClick={() => setActiveTool(id)}>{icon}</button>
        ))}
        {backgroundImage && (
          <button title={backgroundLocked ? 'Unlock plan (allow repositioning)' : 'Lock plan position'}
            className={`px-2.5 py-1.5 text-xs rounded transition-colors ${!backgroundLocked ? 'bg-amber-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
            onClick={toggleBackgroundLock}>{backgroundLocked ? '🔒' : '🔓'}</button>
        )}
        {backgroundImage && !backgroundLocked && (
          <div className="flex items-center gap-1 ml-1" title="Background plan scale">
            <span className="text-amber-400 text-xs">Scale:</span>
            <input type="range" min="0.25" max="3" step="0.01" value={backgroundScale}
              onChange={(e) => setBackgroundScale(parseFloat(e.target.value))}
              className="w-20 h-1 accent-amber-500 cursor-pointer" />
            <input type="number" min="10" max="300" step="1"
              value={Math.round(backgroundScale * 100)}
              onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) setBackgroundScale(v / 100); }}
              className="w-12 bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-amber-300 text-xs text-center focus:outline-none focus:border-amber-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" /><span className="text-amber-400 text-xs">%</span>
            {backgroundScale !== 1 && (
              <button className="px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded"
                onClick={() => setBackgroundScale(1)} title="Reset to 100%">Reset</button>
            )}
          </div>
        )}
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
        <button className="px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded disabled:opacity-50" onClick={handleSavePlan} disabled={saving} title="Saves to the CRM AND lets you save the .cfq quote file to a folder you choose (e.g. OneDrive)">
          {saving
            ? (savingPhase === 'rendering' ? 'Generating PDF…' : 'Saving…')
            : 'Save Plan'}
        </button>
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
            if (!job) {
              setLinkedJob(null, null);
              return;
            }
            const cust = unwrap(job.customer);
            const site = unwrap(job.site);
            const label = jobLabel(job);
            setLinkedJob(jobId, label);
            updateTitleBlock({
              client: cust?.name ?? '',
              projectName: site?.name ?? job.reference ?? '',
              worksAddress: formatWorksAddress(site),
              state: site?.state ?? '',
            });
          }}
          className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-blue-500 max-w-64 truncate"
        >
          <option value="">No job linked</option>
          {jobs.map(j => (
            <option key={j.id} value={j.id}>{jobLabel(j)}</option>
          ))}
        </select>
      </div>

      {/* Export + Complete */}
      <div className="flex items-center gap-1">
        <button className="px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs rounded font-medium transition-colors"
          onClick={handleSavePdf} title="Saves to the CRM AND lets you save the PDF to a folder you choose (e.g. OneDrive)">Save PDF</button>
        <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded font-medium transition-colors"
          onClick={handleCompletePlan}>Complete Plan</button>
      </div>

      <div className="ml-auto flex items-center gap-2 text-xs">
        <div className="flex items-center gap-1 pr-2 border-r border-gray-700">
          {floors.map((f, idx) => {
            const isActive = f.id === activeFloorId;
            const canMoveLeft = isActive && idx > 0;
            const canMoveRight = isActive && idx < floors.length - 1;
            return (
              <div key={f.id} className="flex items-center">
                {canMoveLeft && (
                  <button
                    className="px-1 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-l text-xs"
                    onClick={() => moveFloor(f.id, -1)}
                    title="Move floor left (earlier in numbering order)"
                  >◀</button>
                )}
                <button
                  className={`px-2 py-1 transition-colors ${isActive ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'} ${canMoveLeft ? '' : 'rounded-l'} ${canMoveRight || (isActive && floors.length > 1) ? '' : 'rounded-r'}`}
                  onClick={() => switchFloor(f.id)}
                  title={isActive ? `Numbering position ${idx + 1} of ${floors.length}` : `Switch to ${f.name}`}
                >{f.name}</button>
                {canMoveRight && (
                  <button
                    className="px-1 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs"
                    onClick={() => moveFloor(f.id, 1)}
                    title="Move floor right (later in numbering order)"
                  >▶</button>
                )}
                {floors.length > 1 && isActive && (
                  <button className="px-1 py-1 bg-red-800 hover:bg-red-700 text-red-300 rounded-r text-xs"
                    onClick={() => { if (confirm(`Delete "${f.name}"? All devices on this floor will be lost.`)) removeFloor(f.id); }}
                    title={`Delete ${f.name}`}>x</button>
                )}
              </div>
            );
          })}
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
            <textarea className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-xs focus:outline-none focus:border-blue-500 mb-3 resize-none"
              rows={4} maxLength={400} placeholder="What changed in this revision?" value={revisionNotes} onChange={e => setRevisionNotes(e.target.value)} autoFocus />
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
