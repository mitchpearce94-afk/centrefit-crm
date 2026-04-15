'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Text, Circle, Line, Group } from 'react-konva';
import { usePlanStore } from '@/store/planStore';
import { getDeviceById } from '@/lib/plan-builder/devices';
import DeviceSymbol from './DeviceSymbol';
import CableLines from './CableLines';
import PdfElementOverlay, { hitTestElements } from './PdfElementOverlay';


export default function PlanCanvas() {
  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);

  const {
    backgroundImage, backgroundWidth, backgroundHeight,
    backgroundOffsetX, backgroundOffsetY, backgroundLocked,
    devices, commsRackId,
    selectedDeviceId, activeTool, deviceToPlace, deviceScale,
    stageScale, stageX, stageY,
    layers, activePlan, pdfFileName,
    whitewashRects, addWhitewashRect, removeWhitewashRect,
    setStageTransform, selectDevice, placeDevice, moveDevice, deleteDevice,
    setStageRef, cropBackground, setBackgroundOffset,
  } = usePlanStore();

  const [eraseStart, setEraseStart] = useState<{ x: number; y: number } | null>(null);
  const [erasePreview, setErasePreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [selectedWhitewashId, setSelectedWhitewashId] = useState<string | null>(null);
  const selectedWhitewashRef = useRef<string | null>(null);
  selectedWhitewashRef.current = selectedWhitewashId;

  const initialFitDoneRef = useRef(false);
  const lastPdfFileNameRef = useRef('');
  // Reset fit-to-view flag when a new PDF file is loaded (not on element deletion re-renders)
  if (pdfFileName !== lastPdfFileNameRef.current) {
    lastPdfFileNameRef.current = pdfFileName;
    initialFitDoneRef.current = false;
  }
  const [showRulers, setShowRulers] = useState(false);
  const [guides, setGuides] = useState<Array<{ id: string; orientation: 'h' | 'v'; pos: number }>>([]);
  const [draggingGuide, setDraggingGuide] = useState<{ orientation: 'h' | 'v'; pos: number } | null>(null);
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null);
  const selectedGuideRef = useRef<string | null>(null);
  selectedGuideRef.current = selectedGuideId;
  const RULER_SIZE = 24;

  useEffect(() => { setStageRef(stageRef); }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!backgroundImage) { setBgImage(null); return; }
    const img = new window.Image();
    img.src = backgroundImage;
    img.onload = () => setBgImage(img);
  }, [backgroundImage]);

  useEffect(() => {
    if (!bgImage || !containerSize.width) return;
    // Only fit-to-view on initial PDF load, not after element deletion re-renders
    if (initialFitDoneRef.current) return;
    initialFitDoneRef.current = true;
    const scaleX = (containerSize.width * 0.9) / backgroundWidth;
    const scaleY = (containerSize.height * 0.9) / backgroundHeight;
    const scale = Math.min(scaleX, scaleY, 1);
    const x = (containerSize.width - backgroundWidth * scale) / 2;
    const y = (containerSize.height - backgroundHeight * scale) / 2;
    setStageTransform(scale, x, y);
  }, [bgImage]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const store = usePlanStore.getState();
        if (store.activeTool === 'place') store.setActiveTool('select');
        setSelectedGuideId(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') { e.preventDefault(); setShowRulers(prev => !prev); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const { activeElement } = document;
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT')) return;
        e.preventDefault();
        if (selectedGuideRef.current) { setGuides(prev => prev.filter(g => g.id !== selectedGuideRef.current)); setSelectedGuideId(null); return; }
        const state = usePlanStore.getState();
        if (state.selectedElementIds.length > 0) { state.deleteSelectedElements(); }
        else if (selectedWhitewashRef.current) { removeWhitewashRect(selectedWhitewashRef.current); setSelectedWhitewashId(null); }
        else if (state.selectedDeviceId) deleteDevice(state.selectedDeviceId);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') usePlanStore.getState().undo();
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') usePlanStore.getState().redo();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const showSpeakerLines = activePlan === 'speaker';

  const toCanvasCoords = (e: any) => {
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    return { x: (pos.x - stageX) / stageScale, y: (pos.y - stageY) / stageScale };
  };

  const handleStageClick = useCallback((e: any) => {
    if (activeTool === 'place' && deviceToPlace) {
      const coords = toCanvasCoords(e);
      if (coords) placeDevice(deviceToPlace, coords.x, coords.y);
    }
    if (activeTool === 'elementSelect') {
      const coords = toCanvasCoords(e);
      if (coords) {
        const store = usePlanStore.getState();
        const hitId = hitTestElements(coords.x, coords.y, store.pdfElements);
        const evt = e.evt as MouseEvent;
        if (hitId) {
          if (evt.shiftKey) {
            store.toggleElementSelection(hitId);
          } else {
            store.setSelectedElements([hitId]);
          }
        } else if (!evt.shiftKey) {
          store.setSelectedElements([]);
        }
      }
    }
  }, [activeTool, deviceToPlace, stageX, stageY, stageScale, placeDevice]);

  const handleStageMouseDown = useCallback((e: any) => {
    if (activeTool !== 'erase' && activeTool !== 'crop' && activeTool !== 'elementSelect') return;
    const coords = toCanvasCoords(e);
    if (coords) setEraseStart(coords);
  }, [activeTool, stageX, stageY, stageScale]);

  const handleStageMouseMove = useCallback((e: any) => {
    // Element hit-testing on hover (no drag required)
    if (activeTool === 'elementSelect' && !eraseStart) {
      const coords = toCanvasCoords(e);
      if (coords) {
        const elements = usePlanStore.getState().pdfElements;
        const hitId = hitTestElements(coords.x, coords.y, elements);
        const currentHover = usePlanStore.getState().hoveredElementId;
        if (hitId !== currentHover) {
          usePlanStore.getState().setHoveredElement(hitId);
        }
      }
      return;
    }
    if ((activeTool !== 'erase' && activeTool !== 'crop' && activeTool !== 'elementSelect') || !eraseStart) return;
    const coords = toCanvasCoords(e);
    if (!coords) return;
    setErasePreview({ x: Math.min(eraseStart.x, coords.x), y: Math.min(eraseStart.y, coords.y), w: Math.abs(coords.x - eraseStart.x), h: Math.abs(coords.y - eraseStart.y) });
  }, [activeTool, eraseStart, stageX, stageY, stageScale]);

  const handleStageMouseUp = useCallback(() => {
    if ((activeTool !== 'erase' && activeTool !== 'crop' && activeTool !== 'elementSelect') || !eraseStart || !erasePreview) { setEraseStart(null); setErasePreview(null); return; }
    if (erasePreview.w > 5 && erasePreview.h > 5) {
      if (activeTool === 'crop') cropBackground(erasePreview.x, erasePreview.y, erasePreview.w, erasePreview.h);
      else if (activeTool === 'elementSelect') {
        // Box-select: find all elements whose bboxes intersect the drag rectangle
        const pdfElements = usePlanStore.getState().pdfElements;
        const selected = pdfElements.filter(el => {
          return el.bbox.x < erasePreview.x + erasePreview.w &&
                 el.bbox.x + el.bbox.width > erasePreview.x &&
                 el.bbox.y < erasePreview.y + erasePreview.h &&
                 el.bbox.y + el.bbox.height > erasePreview.y;
        }).map(el => el.id);
        if (selected.length > 0) {
          const current = usePlanStore.getState().selectedElementIds;
          const merged = [...new Set([...current, ...selected])];
          usePlanStore.getState().setSelectedElements(merged);
        }
      }
      else addWhitewashRect(erasePreview.x, erasePreview.y, erasePreview.w, erasePreview.h);
    }
    setEraseStart(null);
    setErasePreview(null);
  }, [activeTool, eraseStart, erasePreview, addWhitewashRect, cropBackground]);

  const handleStageDblClick = (e: any) => {
    if (e.target === e.target.getStage() || e.target.getClassName() === 'Image') { selectDevice(null); setSelectedWhitewashId(null); }
  };

  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    const evt = e.evt as WheelEvent;
    if (evt.ctrlKey || evt.metaKey) {
      const scaleBy = 1.08;
      const stage = e.target.getStage();
      const oldScale = stage.scaleX();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const newScale = evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
      const clampedScale = Math.max(0.1, Math.min(5, newScale));
      const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale };
      setStageTransform(clampedScale, pointer.x - mousePointTo.x * clampedScale, pointer.y - mousePointTo.y * clampedScale);
    } else if (evt.shiftKey) {
      const dx = evt.deltaY > 0 ? -40 : 40;
      setStageTransform(stageScale, stageX + dx, stageY);
    } else {
      const dy = evt.deltaY > 0 ? -40 : 40;
      setStageTransform(stageScale, stageX, stageY + dy);
    }
  };

  const [isDraggingStage, setIsDraggingStage] = useState(false);

  const filteredDevices = devices.filter(d => {
    if (activePlan === 'master') return true;
    const def = getDeviceById(d.deviceId);
    if (!def) return false;
    if (d.instanceId === commsRackId) return true;
    if (activePlan === 'cat6') return def.cableType === 'cat6';
    if (activePlan === 'sixcore') return def.cableType === 'sixcore';
    if (activePlan === 'speaker') return def.cableType === 'speaker';
    return true;
  });

  const screenToCanvas = (screenX: number, screenY: number) => ({ x: (screenX - stageX) / stageScale, y: (screenY - stageY) / stageScale });

  const buildRulerTicks = (orientation: 'h' | 'v') => {
    const size = orientation === 'h' ? containerSize.width : containerSize.height;
    const offset = orientation === 'h' ? stageX : stageY;
    const ticks: Array<{ pos: number; label: string; major: boolean }> = [];
    let step = 50;
    if (stageScale < 0.3) step = 200;
    else if (stageScale < 0.7) step = 100;
    else if (stageScale > 2) step = 25;
    const startCanvas = -offset / stageScale;
    const endCanvas = (size - offset) / stageScale;
    const firstTick = Math.floor(startCanvas / step) * step;
    for (let v = firstTick; v <= endCanvas; v += step) {
      const screenPos = v * stageScale + offset;
      if (screenPos < 0 || screenPos > size) continue;
      ticks.push({ pos: screenPos, label: String(Math.round(v)), major: v % (step * 2) === 0 });
    }
    return ticks;
  };

  const handleRulerMouseDown = (orientation: 'h' | 'v') => {
    const handleMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pos = orientation === 'h' ? screenToCanvas(0, e.clientY - rect.top).y : screenToCanvas(e.clientX - rect.left, 0).x;
      setDraggingGuide({ orientation, pos });
    };
    const handleUp = (e: MouseEvent) => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) { setDraggingGuide(null); return; }
      const pos = orientation === 'h' ? screenToCanvas(0, e.clientY - rect.top).y : screenToCanvas(e.clientX - rect.left, 0).x;
      const screenPos = orientation === 'h' ? e.clientY - rect.top : e.clientX - rect.left;
      if (screenPos > RULER_SIZE) setGuides(prev => [...prev, { id: `guide-${Date.now()}`, orientation, pos }]);
      setDraggingGuide(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  void layers;
  const rulerOffset = showRulers ? RULER_SIZE : 0;
  void rulerOffset;

  return (
    <div ref={containerRef} className="w-full h-full relative"
      style={{ cursor: activeTool === 'place' || activeTool === 'erase' || activeTool === 'crop' || activeTool === 'elementSelect' ? 'crosshair' : activeTool === 'pan' ? (isDraggingStage ? 'grabbing' : 'grab') : activeTool === 'moveBackground' && !backgroundLocked ? 'move' : 'default' }}>
      {!backgroundImage && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-gray-500">
            <div className="text-6xl mb-4">📐</div>
            <div className="text-xl font-medium">Upload a floor plan PDF to get started</div>
            <div className="text-sm mt-2">Use the toolbar above to upload a PDF</div>
          </div>
        </div>
      )}

      <Stage ref={stageRef} width={containerSize.width} height={containerSize.height}
        scaleX={stageScale} scaleY={stageScale} x={stageX} y={stageY}
        onClick={handleStageClick} onDblClick={handleStageDblClick}
        onMouseDown={handleStageMouseDown} onMouseMove={handleStageMouseMove} onMouseUp={handleStageMouseUp}
        onWheel={handleWheel} draggable={activeTool === 'pan'}
        onDragStart={(e) => { if (e.target === stageRef.current) setIsDraggingStage(true); }}
        onDragEnd={(e) => { if (e.target === stageRef.current) { setIsDraggingStage(false); setStageTransform(stageScale, e.target.x(), e.target.y()); } }}>

        <Layer>
          {bgImage && (
            <Group x={backgroundOffsetX} y={backgroundOffsetY}
              draggable={activeTool === 'moveBackground' && !backgroundLocked}
              onDragEnd={(e) => { setBackgroundOffset(e.target.x(), e.target.y()); }}>
              <Rect x={0} y={0} width={backgroundWidth} height={backgroundHeight} fill="#f8f8f0" />
              <KonvaImage image={bgImage} x={0} y={0} width={backgroundWidth} height={backgroundHeight} />
              {!backgroundLocked && (
                <Rect x={0} y={0} width={backgroundWidth} height={backgroundHeight}
                  fill="transparent" stroke="#f59e0b" strokeWidth={2 / stageScale} dash={[8 / stageScale, 4 / stageScale]} listening={false} />
              )}
            </Group>
          )}
        </Layer>

        {/* PDF element selection overlay — between background and whitewash */}
        <PdfElementOverlay />

        <Layer>
          {whitewashRects.map(wr => (
            <React.Fragment key={wr.id}>
              <Rect x={wr.x} y={wr.y} width={wr.width} height={wr.height} fill="#ffffff"
                onClick={() => { if (activeTool === 'select') { setSelectedWhitewashId(wr.id); selectDevice(null); } }}
                onTap={() => { if (activeTool === 'select') { setSelectedWhitewashId(wr.id); selectDevice(null); } }} />
              {selectedWhitewashId === wr.id && (
                <Rect x={wr.x} y={wr.y} width={wr.width} height={wr.height} fill="transparent" stroke="#ff4444" strokeWidth={2} dash={[6, 4]} listening={false} />
              )}
            </React.Fragment>
          ))}
          {erasePreview && (
            <Rect x={erasePreview.x} y={erasePreview.y} width={erasePreview.w} height={erasePreview.h}
              fill={activeTool === 'elementSelect' ? 'rgba(60,130,255,0.12)' : activeTool === 'crop' ? 'rgba(50,130,255,0.15)' : 'rgba(255,255,255,0.7)'}
              stroke={activeTool === 'elementSelect' ? '#3388ff' : activeTool === 'crop' ? '#3388ff' : '#ff4444'}
              strokeWidth={activeTool === 'elementSelect' || activeTool === 'crop' ? 2 : 1} dash={[4, 4]} listening={false} />
          )}
        </Layer>

        <Layer>
          {activePlan !== 'master' && filteredDevices.map(device => {
            if (device.instanceId === commsRackId) return null;
            return <Circle key={`coverage-${device.instanceId}`} x={device.x} y={device.y} radius={80 * deviceScale}
              fill="rgba(255, 150, 150, 0.12)" stroke="rgba(255, 150, 150, 0.25)" strokeWidth={1} listening={false} />;
          })}
          {showSpeakerLines && <CableLines devices={devices} commsRackId={commsRackId} />}
        </Layer>

        <Layer>
          {filteredDevices.map(device => {
            const def = getDeviceById(device.deviceId);
            if (!def) return null;
            const isCommsRack = device.instanceId === commsRackId;
            return (
              <DeviceSymbol key={device.instanceId} def={def} x={device.x} y={device.y} rotation={device.rotation}
                selected={device.instanceId === selectedDeviceId}
                labelNum={activePlan === 'master' || isCommsRack || device.labelNum === 0 ? undefined : device.labelNum}
                concreteMounted={device.concreteMounted}
                provisional={device.provisional}
                size={14 * deviceScale}
                draggable={activeTool === 'select'}
                onDragEnd={(x, y) => {
                  const snapThreshold = 8 / stageScale;
                  let sx = x, sy = y;
                  for (const g of guides) {
                    if (g.orientation === 'v' && Math.abs(x - g.pos) < snapThreshold) sx = g.pos;
                    if (g.orientation === 'h' && Math.abs(y - g.pos) < snapThreshold) sy = g.pos;
                  }
                  moveDevice(device.instanceId, sx, sy);
                }}
                onClick={() => { if (activeTool === 'select') { selectDevice(device.instanceId); setSelectedWhitewashId(null); } }} />
            );
          })}
        </Layer>

        <Layer listening={false}>
          {activePlan !== 'master' && (
            <Text x={10 / stageScale} y={10 / stageScale}
              text={activePlan.toUpperCase() + ' CABLE PLAN'}
              fontSize={16 / stageScale}
              fill={activePlan === 'cat6' ? '#3399ff' : activePlan === 'sixcore' ? '#ff4444' : '#44cc44'}
              fontStyle="bold" />
          )}
        </Layer>

        {showRulers && (
          <Layer listening={false}>
            {guides.map(g => (
              g.orientation === 'h'
                ? <Line key={g.id} points={[-10000, g.pos, 10000, g.pos]} stroke={selectedGuideId === g.id ? '#ff4444' : '#00bbff'} strokeWidth={1 / stageScale} dash={[6 / stageScale, 4 / stageScale]} opacity={0.8} />
                : <Line key={g.id} points={[g.pos, -10000, g.pos, 10000]} stroke={selectedGuideId === g.id ? '#ff4444' : '#00bbff'} strokeWidth={1 / stageScale} dash={[6 / stageScale, 4 / stageScale]} opacity={0.8} />
            ))}
            {draggingGuide && (
              draggingGuide.orientation === 'h'
                ? <Line points={[-10000, draggingGuide.pos, 10000, draggingGuide.pos]} stroke="#00bbff" strokeWidth={1 / stageScale} dash={[6 / stageScale, 4 / stageScale]} opacity={0.5} />
                : <Line points={[draggingGuide.pos, -10000, draggingGuide.pos, 10000]} stroke="#00bbff" strokeWidth={1 / stageScale} dash={[6 / stageScale, 4 / stageScale]} opacity={0.5} />
            )}
          </Layer>
        )}
      </Stage>

      {showRulers && (
        <>
          <div className="absolute left-0 top-0 h-6 bg-gray-800 border-b border-gray-600 select-none overflow-hidden"
            style={{ left: RULER_SIZE, right: 0, height: RULER_SIZE, cursor: 'col-resize', zIndex: 10 }}
            onMouseDown={() => handleRulerMouseDown('v')}>
            <svg width="100%" height={RULER_SIZE} className="text-gray-400">
              {buildRulerTicks('h').map((tick, i) => (
                <React.Fragment key={i}>
                  <line x1={tick.pos} y1={tick.major ? 0 : RULER_SIZE * 0.5} x2={tick.pos} y2={RULER_SIZE} stroke="currentColor" strokeWidth={0.5} />
                  {tick.major && <text x={tick.pos + 2} y={RULER_SIZE * 0.55} fontSize={8} fill="currentColor">{tick.label}</text>}
                </React.Fragment>
              ))}
            </svg>
          </div>
          <div className="absolute left-0 top-0 w-6 bg-gray-800 border-r border-gray-600 select-none overflow-hidden"
            style={{ top: RULER_SIZE, bottom: 0, width: RULER_SIZE, cursor: 'row-resize', zIndex: 10 }}
            onMouseDown={() => handleRulerMouseDown('h')}>
            <svg width={RULER_SIZE} height="100%" className="text-gray-400">
              {buildRulerTicks('v').map((tick, i) => (
                <React.Fragment key={i}>
                  <line x1={tick.major ? 0 : RULER_SIZE * 0.5} y1={tick.pos} x2={RULER_SIZE} y2={tick.pos} stroke="currentColor" strokeWidth={0.5} />
                  {tick.major && <text x={2} y={tick.pos - 2} fontSize={8} fill="currentColor">{tick.label}</text>}
                </React.Fragment>
              ))}
            </svg>
          </div>
          <div className="absolute left-0 top-0 bg-gray-800 border-b border-r border-gray-600" style={{ width: RULER_SIZE, height: RULER_SIZE, zIndex: 11 }} />
          {guides.map(g => {
            const screenPos = g.orientation === 'h' ? g.pos * stageScale + stageY : g.pos * stageScale + stageX;
            const isSelected = selectedGuideId === g.id;
            return g.orientation === 'h' ? (
              <div key={g.id} className="absolute left-0 right-0"
                style={{ top: screenPos - 6, height: 12, cursor: 'pointer', zIndex: 15, borderTop: isSelected ? '2px solid #ff4444' : undefined, borderBottom: isSelected ? '2px solid #ff4444' : undefined }}
                onClick={() => setSelectedGuideId(isSelected ? null : g.id)} />
            ) : (
              <div key={g.id} className="absolute top-0 bottom-0"
                style={{ left: screenPos - 6, width: 12, cursor: 'pointer', zIndex: 15, borderLeft: isSelected ? '2px solid #ff4444' : undefined, borderRight: isSelected ? '2px solid #ff4444' : undefined }}
                onClick={() => setSelectedGuideId(isSelected ? null : g.id)} />
            );
          })}
        </>
      )}

      {bgImage && (() => {
        const contentW = backgroundWidth * stageScale;
        const contentH = backgroundHeight * stageScale;
        const viewW = containerSize.width;
        const viewH = containerSize.height;
        const BAR = 10;
        const showH = contentW > viewW;
        const hThumbW = showH ? Math.max(30, (viewW / contentW) * viewW) : 0;
        const hRange = viewW - hThumbW;
        const hProgress = showH ? Math.min(1, Math.max(0, -stageX / (contentW - viewW))) : 0;
        const hThumbX = hProgress * hRange;
        const showV = contentH > viewH;
        const vThumbH = showV ? Math.max(30, (viewH / contentH) * viewH) : 0;
        const vRange = viewH - vThumbH;
        const vProgress = showV ? Math.min(1, Math.max(0, -stageY / (contentH - viewH))) : 0;
        const vThumbY = vProgress * vRange;

        const startDragH = (e: React.MouseEvent) => {
          e.preventDefault();
          const startMouseX = e.clientX; const startThumbX = hThumbX;
          const onMove = (me: MouseEvent) => { const dx = me.clientX - startMouseX; const newThumbX = Math.min(hRange, Math.max(0, startThumbX + dx)); const newProgress = hRange > 0 ? newThumbX / hRange : 0; setStageTransform(stageScale, -(contentW - viewW) * newProgress, stageY); };
          const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
          window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
        };
        const startDragV = (e: React.MouseEvent) => {
          e.preventDefault();
          const startMouseY = e.clientY; const startThumbY = vThumbY;
          const onMove = (me: MouseEvent) => { const dy = me.clientY - startMouseY; const newThumbY = Math.min(vRange, Math.max(0, startThumbY + dy)); const newProgress = vRange > 0 ? newThumbY / vRange : 0; setStageTransform(stageScale, stageX, -(contentH - viewH) * newProgress); };
          const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
          window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
        };

        return (
          <>
            {showH && (
              <div className="absolute bottom-0 left-0 right-0" style={{ height: BAR, zIndex: 20 }}>
                <div className="w-full h-full bg-gray-900/50 rounded-full">
                  <div className="h-full bg-gray-500 hover:bg-gray-400 rounded-full cursor-pointer"
                    style={{ width: hThumbW, marginLeft: hThumbX, transition: 'background-color 0.15s' }} onMouseDown={startDragH} />
                </div>
              </div>
            )}
            {showV && (
              <div className="absolute top-0 right-0 bottom-0" style={{ width: BAR, zIndex: 20 }}>
                <div className="w-full h-full bg-gray-900/50 rounded-full">
                  <div className="w-full bg-gray-500 hover:bg-gray-400 rounded-full cursor-pointer"
                    style={{ height: vThumbH, marginTop: vThumbY, transition: 'background-color 0.15s' }} onMouseDown={startDragV} />
                </div>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
