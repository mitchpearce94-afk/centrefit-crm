"use client";

import { useEffect } from "react";

// iOS standalone PWAs mis-measure the LAYOUT viewport at cold start (100dvh
// short → bottom gap) and can also report it OVERSIZED with
// viewport-fit=cover + an opaque status bar (full screen while the visible
// area starts below the bar → the app overflows and the document itself
// starts scrolling/rubber-banding). The VISUAL viewport is the one number
// that's right in both cases, so the app shell is sized from it via
// --app-height.
//
// The only time visualViewport.height is "wrong" for our purpose is while
// the on-screen keyboard is open (it shrinks to the area above the
// keyboard) — sizing the shell then would squash the whole app, so updates
// are skipped while a text field has focus.
export function ViewportHeightFix() {
  useEffect(() => {
    const root = document.documentElement;
    const keyboardLikelyOpen = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
    };
    const apply = () => {
      if (keyboardLikelyOpen()) return;
      const h = window.visualViewport?.height ?? root.clientHeight;
      if (h > 0) root.style.setProperty("--app-height", `${Math.round(h)}px`);
    };
    apply();
    // iOS settles the web view size shortly after launch without firing any
    // event — a couple of delayed re-applies catch it.
    const t1 = window.setTimeout(apply, 150);
    const t2 = window.setTimeout(apply, 600);
    window.visualViewport?.addEventListener("resize", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    // Re-measure once the keyboard fully closes (focus leaves the field).
    const onFocusOut = () => window.setTimeout(apply, 250);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.visualViewport?.removeEventListener("resize", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);
  return null;
}
