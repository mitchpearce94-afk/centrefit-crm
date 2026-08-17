"use client";

import { useEffect, useRef, useState } from "react";
import { DEVICE_CATALOG } from "@/lib/plan-builder/devices";

/**
 * Fullscreen interactive plan (Mitchell 2026-08-17): the floor plan exactly
 * as the editor/PDF draws it — background sheet, whitewash patches, real
 * symbol artwork at true plotted size and rotation, cross-floor numbering —
 * with pinch/pan and tap-a-symbol-to-tick. Ticks share the parent's
 * plan_items toggle, so the list stays in sync. Read-only over the .cfp.
 */

export interface VisualItem {
  id: string;
  instance_id: string;
  status: string;
  orphaned: boolean;
}

interface CfpDevice {
  instanceId: string;
  deviceId: string;
  x: number;
  y: number;
  rotation?: number;
  labelNum?: number;
  provisional?: boolean;
  dataCount?: number;
}

interface CfpFloor {
  id?: string;
  name?: string;
  devices?: CfpDevice[];
  commsRackId?: string | null;
  backgroundImage?: string | null;
  backgroundWidth?: number;
  backgroundHeight?: number;
  backgroundOffsetX?: number;
  backgroundOffsetY?: number;
  backgroundScale?: number;
  whitewashRects?: { id: string; x: number; y: number; width: number; height: number }[];
}

const catalogById = new Map(DEVICE_CATALOG.map((d) => [d.id, d]));

// Editor constants (DeviceSymbol.tsx): image symbols render at
// SYMBOL_SIZE × symbolScale × deviceScale, centred; plain symbols are a
// circle of radius 14 × deviceScale.
const SYMBOL_SIZE = 42;
const SZ = 14;

// Cross-floor numbering groups, mirroring PlanCanvas offsetFor: numbers
// continue across floors (data offsets by drop count, others by marker count).
const NUM_GROUPS: Record<string, string[]> = {
  cameras: ["cam-black", "cam-white"],
  pir: ["pir-wall", "pir-ceiling"],
  aps: ["wifi-ap"],
  data: ["cat6-data", "rg6-coax"],
  speakers: ["speaker-roof-white", "speaker-roof-black", "speaker-wall-white", "speaker-wall-black"],
};
const GROUP_BY_DEVICE: Record<string, string> = {};
for (const [g, ids] of Object.entries(NUM_GROUPS)) for (const id of ids) GROUP_BY_DEVICE[id] = g;

export function PlanVisual({
  planName,
  cfpUrl,
  itemsByInstance,
  onToggle,
  onClose,
}: {
  planName: string;
  cfpUrl: string;
  itemsByInstance: Map<string, VisualItem>;
  onToggle: (item: VisualItem) => void;
  onClose: () => void;
}) {
  const [floors, setFloors] = useState<CfpFloor[] | null>(null);
  const [deviceScale, setDeviceScale] = useState(1);
  const [floorIdx, setFloorIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState({ x: 0, y: 0, scale: 1 });
  const containerRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; scale: number; mid: { x: number; y: number }; t: { x: number; y: number } } | null>(null);
  const moved = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetch(cfpUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((cfp) => {
        if (cancelled) return;
        setFloors(cfp.floors ?? []);
        setDeviceScale(Number(cfp.deviceScale) || 1);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [cfpUrl]);

  // Lock page scroll while fullscreen; Escape closes.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  });

  const floor = floors?.[floorIdx];

  // Fit the floor to the screen when it changes.
  useEffect(() => {
    if (!floor || !containerRef.current) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const b = floorBounds(floor);
    const scale = Math.min(cw / b.w, ch / b.h) * 0.97;
    setT({
      x: -b.x * scale + (cw - b.w * scale) / 2,
      y: -b.y * scale + (ch - b.h * scale) / 2,
      scale,
    });
  }, [floor]);

  function floorBounds(f: CfpFloor) {
    const bgW = (f.backgroundWidth ?? 800) * (f.backgroundScale ?? 1);
    const bgH = (f.backgroundHeight ?? 600) * (f.backgroundScale ?? 1);
    let x0 = f.backgroundOffsetX ?? 0;
    let y0 = f.backgroundOffsetY ?? 0;
    let x1 = x0 + bgW;
    let y1 = y0 + bgH;
    for (const d of f.devices ?? []) {
      x0 = Math.min(x0, d.x - 40); y0 = Math.min(y0, d.y - 40);
      x1 = Math.max(x1, d.x + 40); y1 = Math.max(y1, d.y + 40);
    }
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }

  // Cross-floor numbering offsets for the current floor.
  function groupOffsets(): Record<string, number> {
    const offsets: Record<string, number> = {};
    if (!floors) return offsets;
    for (let i = 0; i < floorIdx; i++) {
      for (const d of floors[i].devices ?? []) {
        const g = GROUP_BY_DEVICE[d.deviceId];
        if (!g) continue;
        const inc = g === "data" ? Math.max(1, d.dataCount ?? 1) : 1;
        offsets[g] = (offsets[g] ?? 0) + inc;
      }
    }
    return offsets;
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = 0;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: t.scale,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        t: { x: t.x, y: t.y },
      };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);

    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = dist / Math.max(1, pinchStart.current.dist);
      const newScale = clampScale(pinchStart.current.scale * ratio);
      const applied = newScale / pinchStart.current.scale;
      const rect = containerRef.current!.getBoundingClientRect();
      const mx = pinchStart.current.mid.x - rect.left;
      const my = pinchStart.current.mid.y - rect.top;
      setT({
        scale: newScale,
        x: mx - (mx - pinchStart.current.t.x) * applied,
        y: my - (my - pinchStart.current.t.y) * applied,
      });
    } else if (pointers.current.size === 1) {
      setT((cur) => ({ ...cur, x: cur.x + (e.clientX - prev.x), y: cur.y + (e.clientY - prev.y) }));
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
  }

  function onWheel(e: React.WheelEvent) {
    const rect = containerRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setT((cur) => {
      const newScale = clampScale(cur.scale * factor);
      const applied = newScale / cur.scale;
      return { scale: newScale, x: mx - (mx - cur.x) * applied, y: my - (my - cur.y) * applied };
    });
  }

  function clampScale(s: number) {
    return Math.min(12, Math.max(0.02, s));
  }

  const offsets = floor ? groupOffsets() : {};
  // Minimum on-screen tap target of ~34px regardless of zoom.
  const minHit = 34 / t.scale;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-neutral-900">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/10 px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">{planName}</p>
        {floors && floors.length > 1 && (
          <div className="flex gap-1 overflow-x-auto">
            {floors.map((f, i) => (
              <button
                key={f.id ?? i}
                type="button"
                onClick={() => setFloorIdx(i)}
                className={`shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  i === floorIdx
                    ? "border-emerald-400 bg-emerald-400/15 text-emerald-300"
                    : "border-white/20 text-white/60"
                }`}
              >
                {f.name ?? `Floor ${i + 1}`}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md border border-white/25 px-3 py-1.5 text-sm text-white hover:bg-white/10"
        >
          Close ✕
        </button>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        className="relative flex-1 overflow-hidden touch-none select-none bg-neutral-800"
      >
        {error && <p className="p-4 text-sm text-red-400">Couldn&apos;t load the plan drawing: {error}</p>}
        {!floors && !error && <p className="p-4 text-sm text-white/60 animate-pulse">Loading plan drawing…</p>}
        {floors && !floor && <p className="p-4 text-sm text-white/60">This plan has no floors.</p>}

        {floor && (
          <div
            style={{
              position: "absolute",
              transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`,
              transformOrigin: "0 0",
            }}
          >
            {/* Background sheet */}
            <div
              style={{
                position: "absolute",
                transform: `translate(${floor.backgroundOffsetX ?? 0}px, ${floor.backgroundOffsetY ?? 0}px) scale(${floor.backgroundScale ?? 1})`,
                transformOrigin: "0 0",
                width: floor.backgroundWidth ?? 800,
                height: floor.backgroundHeight ?? 600,
                background: "#f8f8f0",
              }}
            >
              {floor.backgroundImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={floor.backgroundImage}
                  alt=""
                  draggable={false}
                  style={{ display: "block", width: "100%", height: "100%" }}
                />
              )}
            </div>

            {/* Whitewash patches */}
            {(floor.whitewashRects ?? []).map((wr) => (
              <div
                key={wr.id}
                style={{ position: "absolute", left: wr.x, top: wr.y, width: wr.width, height: wr.height, background: "#ffffff" }}
              />
            ))}

            {/* Devices — true plan size + rotation, exactly as printed */}
            {(floor.devices ?? []).map((d) => {
              const def = catalogById.get(d.deviceId);
              const item = itemsByInstance.get(d.instanceId);
              const installed = item?.status === "installed";
              const rotation = d.rotation ?? 0;
              const isDataOutlet = d.deviceId === "cat6-data" || d.deviceId === "rg6-coax";
              const symbolPx = def?.symbolImage
                ? SYMBOL_SIZE * (def.symbolScale || 1) * deviceScale
                : SZ * deviceScale * 2;
              const hitPx = Math.max(symbolPx, minHit);
              const group = GROUP_BY_DEVICE[d.deviceId];
              const showLabel = typeof d.labelNum === "number" && d.labelNum !== 0 && d.instanceId !== floor.commsRackId;
              const effNum = showLabel ? (d.labelNum as number) + (group ? offsets[group] ?? 0 : 0) : 0;
              const labelText = showLabel
                ? isDataOutlet && (d.dataCount ?? 1) > 1
                  ? `D${effNum}-D${effNum + (d.dataCount ?? 1) - 1}`
                  : isDataOutlet
                    ? `D${effNum}`
                    : `${effNum}`
                : null;
              // True plan scale — same s*0.9 the editor uses. No screen-size
              // clamp: zoomed out they go small exactly like the paper sheet;
              // zoom in to read them.
              const labelFont = SZ * deviceScale * 0.9;
              const tickSize = symbolPx * 0.9;

              return (
                <button
                  key={d.instanceId}
                  type="button"
                  disabled={!item || item.orphaned}
                  onClick={() => {
                    if (moved.current > 8) return;
                    if (item && !item.orphaned) onToggle(item);
                  }}
                  title={def?.name ?? d.deviceId}
                  style={{
                    position: "absolute",
                    left: d.x,
                    top: d.y,
                    width: hitPx,
                    height: hitPx,
                    transform: "translate(-50%, -50%)",
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: item ? "pointer" : "default",
                    opacity: d.provisional ? 0.55 : 1,
                  }}
                >
                  {/* The symbol itself, rotated like the editor draws it */}
                  <span
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: "50%",
                      width: symbolPx,
                      height: symbolPx,
                      transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "none",
                      filter: installed ? "grayscale(45%) opacity(0.75)" : undefined,
                    }}
                  >
                    {def?.symbolImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={def.symbolImage}
                        alt=""
                        draggable={false}
                        style={{ width: "100%", height: "100%", objectFit: "contain" }}
                      />
                    ) : (
                      <span
                        style={{
                          width: SZ * deviceScale * 2,
                          height: SZ * deviceScale * 2,
                          borderRadius: "9999px",
                          background: def?.fillColor ?? "#888",
                          border: `1.5px solid ${def?.strokeColor ?? "#fff"}`,
                        }}
                      />
                    )}
                  </span>

                  {/* Green pen-tick when installed */}
                  {installed && (
                    <span
                      style={{
                        position: "absolute",
                        left: "50%",
                        top: "50%",
                        transform: "translate(-50%, -55%)",
                        color: "#16a34a",
                        fontWeight: 800,
                        fontSize: tickSize,
                        lineHeight: 1,
                        textShadow: "0 0 3px #fff, 0 0 6px #fff, 0 0 10px #fff",
                        pointerEvents: "none",
                      }}
                    >
                      ✓
                    </span>
                  )}

                  {/* Number label — red plan-style text, anchored to the
                      SYMBOL edge (not the invisible tap halo) so it hugs the
                      marker at every zoom, kept upright */}
                  {labelText && (
                    <span
                      style={{
                        position: "absolute",
                        left: "50%",
                        top: isDataOutlet ? `calc(50% + ${symbolPx * 0.55}px)` : undefined,
                        bottom: isDataOutlet ? undefined : `calc(50% + ${symbolPx * 0.5}px)`,
                        transform: "translateX(-50%)",
                        color: installed ? "#16a34a" : "#dc2626",
                        fontWeight: 700,
                        fontSize: labelFont,
                        lineHeight: 1.1,
                        whiteSpace: "nowrap",
                        textShadow: "0 0 2px #fff, 0 0 4px #fff",
                        pointerEvents: "none",
                      }}
                    >
                      {labelText}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {floor && (
          <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] text-white/90">
            Pinch to zoom · drag to pan · tap a symbol to tick it off
          </p>
        )}
      </div>
    </div>
  );
}
