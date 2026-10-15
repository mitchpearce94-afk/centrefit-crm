"use client";

import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A modal/bottom-sheet backdrop that stays put on iOS.
 *
 * `fixed inset-0` inside the dashboard anchors to the LAYOUT viewport, which
 * iOS standalone mis-measures and pans around (keyboard up, toolbar settle,
 * late launch correction) — the sheet visibly slid about (Mitchell, 15 Oct
 * 2026: "the assign job/event pop up… is all moving around and not fixed").
 * The app shell is the one box sized to the true visual viewport
 * (--app-height, see ViewportHeightFix), so this portals into it and sits
 * `absolute inset-0` there — exactly how the mobile nav avoids the same bug.
 *
 * While the on-screen keyboard is up the shell deliberately keeps its full
 * height (shrinking it would squash the app), so the overlay tracks
 * `visualViewport` itself: it takes the keyboard's height off the bottom
 * and follows any pan, keeping a bottom-anchored sheet's fields and Save
 * button above the keyboard. Sub-24 px nudges are ignored, same threshold
 * as the shell, so scroll jitter never moves the sheet.
 *
 * Children render inside a flex box: `items-end` for a bottom sheet on
 * phones, centred on desktop. Pass `align="center"` to centre everywhere.
 */
export function ShellOverlay({
  children,
  onBackdropClick,
  align = "sheet",
  zIndex = 50,
}: {
  children: React.ReactNode;
  onBackdropClick?: () => void;
  align?: "sheet" | "center";
  zIndex?: number;
}) {
  // Overlays only ever mount client-side (after a tap), so the host can be
  // resolved up front; on the server this is null and nothing renders.
  const [host] = useState<{ el: HTMLElement; inShell: boolean } | null>(() => {
    if (typeof document === "undefined") return null;
    const shell = document.querySelector<HTMLElement>("[data-app-shell]");
    return shell ? { el: shell, inShell: true } : { el: document.body, inShell: false };
  });
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);

  useLayoutEffect(() => {
    if (!host) return;
    const vv = window.visualViewport;
    if (!vv) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const hostRect = host.el.getBoundingClientRect();
      const top = Math.max(0, Math.round(vv.offsetTop - hostRect.top));
      const height = Math.min(Math.round(hostRect.height), Math.round(vv.height));
      setBox((prev) => (prev && Math.abs(prev.top - top) < 24 && Math.abs(prev.height - height) < 24 ? prev : { top, height }));
    };
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(apply);
    };
    apply();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("orientationchange", schedule);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("orientationchange", schedule);
    };
  }, [host]);

  if (!host) return null;
  const items = align === "center" ? "items-center" : "items-end lg:items-center";
  return createPortal(
    <div
      className={`${host.inShell ? "absolute" : "fixed"} left-0 right-0 flex ${items} justify-center`}
      style={box ? { top: box.top, height: box.height, zIndex } : { top: 0, bottom: 0, zIndex }}
    >
      <div className="absolute inset-0 bg-black/60" onClick={onBackdropClick} />
      {children}
    </div>,
    host.el,
  );
}
