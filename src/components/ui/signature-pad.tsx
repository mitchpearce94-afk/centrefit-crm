"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Sign-on-glass canvas signature pad (documentation-CONTEXT.md Phase B).
 * Pointer-events based so mouse, touch and stylus all work; drawn at
 * devicePixelRatio so the exported PNG stays crisp inside the PDF.
 * Exposes the drawing via onChange as a PNG data URL (null when empty).
 */
export function SignaturePad({
  onChange,
  height = 160,
  strokeColor = "#0f172a",
}: {
  onChange: (dataUrl: string | null) => void;
  height?: number;
  strokeColor?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  // Size the backing store to the element's rendered size × DPR. Re-run on
  // resize; the drawing is cleared when that happens (acceptable — resize
  // mid-signature is rare and a stretched signature looks worse).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.lineWidth = 2.25;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = strokeColor;
      }
      setHasInk(false);
      onChange(null);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokeColor]);

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    lastPoint.current = pointFromEvent(e);
  };

  const handleMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !lastPoint.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    const p = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPoint.current = p;
    if (!hasInk) setHasInk(true);
  };

  const handleUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    // A tap without movement should still leave a dot — draws a point so
    // short initials aren't silently dropped.
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx && lastPoint.current) {
      const p = pointFromEvent(e);
      ctx.beginPath();
      ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
      ctx.lineTo(p.x + 0.1, p.y + 0.1);
      ctx.stroke();
    }
    drawing.current = false;
    lastPoint.current = null;
    setHasInk(true);
    if (canvas) onChange(canvas.toDataURL("image/png"));
  };

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange(null);
  }, [onChange]);

  return (
    <div>
      <div
        style={{
          position: "relative",
          border: "1.5px dashed #cbd5e1",
          borderRadius: 12,
          background: "#ffffff",
          overflow: "hidden",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", height, touchAction: "none", cursor: "crosshair" }}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
        />
        {!hasInk && (
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#cbd5e1",
              fontSize: 14,
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            Sign here with your finger or mouse
          </span>
        )}
        <span
          style={{
            position: "absolute",
            left: 24,
            right: 24,
            bottom: 28,
            borderBottom: "1px solid #e2e8f0",
            pointerEvents: "none",
          }}
        />
      </div>
      <button
        type="button"
        onClick={clear}
        style={{
          marginTop: 8,
          fontSize: 12,
          color: "#64748b",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          textDecoration: "underline",
        }}
      >
        Clear signature
      </button>
    </div>
  );
}
