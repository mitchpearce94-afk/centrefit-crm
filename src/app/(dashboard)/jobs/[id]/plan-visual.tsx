"use client";

import { useEffect, useRef, useState } from "react";
import { DEVICE_CATALOG } from "@/lib/plan-builder/devices";

/**
 * Visual plan tick-off (Mitchell 2026-08-17): renders the floor plan exactly
 * as drawn — background sheet, whitewash patches, device symbols at their
 * plotted positions — and lets a tech tap a symbol to mark it installed.
 * Pinch/drag to zoom and pan. Read-only reconstruction of the .cfp (never
 * writes to it); ticks go to plan_items via the parent's toggle.
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
  labelNum?: number;
  provisional?: boolean;
  dataCount?: number;
}

interface CfpFloor {
  id?: string;
  name?: string;
  devices?: CfpDevice[];
  backgroundImage?: string | null;
  backgroundWidth?: number;
  backgroundHeight?: number;
  backgroundOffsetX?: number;
  backgroundOffsetY?: number;
  backgroundScale?: number;
  whitewashRects?: { id: string; x: number; y: number; width: number; height: number }[];
}

const catalogById = new Map(DEVICE_CATALOG.map((d) => [d.id, d]));

export function PlanVisual({
  cfpUrl,
  itemsByInstance,
  onToggle,
}: {
  cfpUrl: string;
  itemsByInstance: Map<string, VisualItem>;
  onToggle: (item: VisualItem) => void;
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

  const floor = floors?.[floorIdx];

  // Fit the floor into the container whenever the floor changes.
  useEffect(() => {
    if (!floor || !containerRef.current) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const b = floorBounds(floor);
    const scale = Math.min(cw / b.w, ch / b.h) * 0.96;
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
    return Math.min(8, Math.max(0.05, s));
  }

  if (error) {
    return <p className="text-sm text-destructive">Couldn&apos;t load the plan drawing: {error}</p>;
  }
  if (!floors) {
    return <p className="text-sm text-muted-foreground animate-pulse">Loading plan drawing…</p>;
  }
  if (!floor) {
    return <p className="text-sm text-muted-foreground">This plan has no floors.</p>;
  }

  // Symbols keep a constant on-screen size so they stay tappable when zoomed
  // out — divide by the current zoom to counter the container transform.
  const markerPx = Math.max(26, 30 * deviceScale) / t.scale;
  const badgePx = 13 / t.scale;

  return (
    <div>
      {floors.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {floors.map((f, i) => (
            <button
              key={f.id ?? i}
              type="button"
              onClick={() => setFloorIdx(i)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                i === floorIdx
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/50"
              }`}
            >
              {f.name ?? `Floor ${i + 1}`}
            </button>
          ))}
        </div>
      )}

      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        className="relative h-[70dvh] overflow-hidden rounded-lg border border-border bg-[#d8d8d0] touch-none select-none"
      >
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

          {/* Whitewash patches (mask original plan markings, as in the editor) */}
          {(floor.whitewashRects ?? []).map((wr) => (
            <div
              key={wr.id}
              style={{ position: "absolute", left: wr.x, top: wr.y, width: wr.width, height: wr.height, background: "#ffffff" }}
            />
          ))}

          {/* Device symbols */}
          {(floor.devices ?? []).map((d) => {
            const def = catalogById.get(d.deviceId);
            const item = itemsByInstance.get(d.instanceId);
            const installed = item?.status === "installed";
            return (
              <button
                key={d.instanceId}
                type="button"
                disabled={!item || item.orphaned}
                onClick={() => {
                  // Suppress the click that follows a pan/pinch gesture.
                  if (moved.current > 8) return;
                  if (item && !item.orphaned) onToggle(item);
                }}
                title={def?.name ?? d.deviceId}
                style={{
                  position: "absolute",
                  left: d.x,
                  top: d.y,
                  width: markerPx,
                  height: markerPx,
                  transform: "translate(-50%, -50%)",
                  borderRadius: "9999px",
                  border: `${2 / t.scale}px solid ${installed ? "#16a34a" : "#ef4444"}`,
                  background: installed ? "rgba(22,163,74,0.28)" : "rgba(255,255,255,0.85)",
                  opacity: d.provisional ? 0.55 : 1,
                  padding: 0,
                  cursor: item ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: `0 0 ${4 / t.scale}px rgba(0,0,0,0.35)`,
                }}
              >
                {def?.symbolImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={def.symbolImage}
                    alt=""
                    draggable={false}
                    style={{
                      width: "72%",
                      height: "72%",
                      objectFit: "contain",
                      filter: installed ? "grayscale(60%)" : undefined,
                      pointerEvents: "none",
                    }}
                  />
                ) : (
                  <span
                    style={{
                      width: "60%",
                      height: "60%",
                      borderRadius: "9999px",
                      background: def?.fillColor ?? "#666",
                      pointerEvents: "none",
                    }}
                  />
                )}
                {installed && (
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#15803d",
                      fontWeight: 800,
                      fontSize: markerPx * 0.62,
                      textShadow: "0 0 3px #fff, 0 0 6px #fff",
                      pointerEvents: "none",
                    }}
                  >
                    ✓
                  </span>
                )}
                {typeof d.labelNum === "number" && (
                  <span
                    style={{
                      position: "absolute",
                      top: -badgePx * 0.55,
                      right: -badgePx * 0.55,
                      minWidth: badgePx,
                      height: badgePx,
                      padding: `0 ${badgePx * 0.18}px`,
                      borderRadius: badgePx,
                      background: installed ? "#16a34a" : "#111827",
                      color: "#fff",
                      fontSize: badgePx * 0.72,
                      lineHeight: `${badgePx}px`,
                      textAlign: "center",
                      pointerEvents: "none",
                    }}
                  >
                    {d.labelNum}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-[11px] text-white">
          Pinch to zoom · drag to pan · tap a symbol to tick it off
        </p>
      </div>
    </div>
  );
}
