"use client";

import { useEffect, useRef } from "react";
import type React from "react";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  /** When true, render full-screen on mobile rather than bottom-sheet. Default false. */
  fullScreen?: boolean;
}

export function Sheet({ open, onClose, title, children, fullScreen = false }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  // Swipe-down to dismiss on mobile. Tracks touch deltaY and dismisses past
  // a threshold. No animation pulldown follow — minimal implementation.
  useEffect(() => {
    if (!open) return;
    const el = sheetRef.current;
    if (!el) return;
    let startY: number | null = null;
    const onStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 80 && el.scrollTop === 0) {
        startY = null;
        onClose();
      }
    };
    el.addEventListener("touchstart", onStart);
    el.addEventListener("touchmove", onMove);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        className={`relative w-full sm:w-auto sm:min-w-[420px] sm:max-w-lg bg-card border border-border shadow-lg overflow-y-auto ${
          fullScreen
            ? "h-[100dvh] sm:h-auto sm:max-h-[85dvh] rounded-none sm:rounded-xl"
            : "max-h-[90dvh] sm:max-h-[85dvh] rounded-t-2xl sm:rounded-xl"
        }`}
        style={{
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {!fullScreen && (
          <div className="sm:hidden sticky top-0 flex justify-center py-2.5 bg-card/95">
            <span className="block h-1 w-10 rounded-full bg-border-strong" />
          </div>
        )}
        {title && (
          <div className="sticky top-0 sm:top-0 flex items-center justify-between gap-2 px-5 py-3 border-b border-border bg-card/95 backdrop-blur">
            <h2 className="text-sm font-semibold text-foreground truncate">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 -mr-2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
              aria-label="Close"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
