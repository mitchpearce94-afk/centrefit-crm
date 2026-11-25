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
// keyboard) — sizing the shell then would squash the whole app.
//
// Why the keyboard check is a SIZE test and not "is a field focused":
// backgrounding the app (home swipe) and coming back makes iOS replay a
// keyboard-shrunk visual viewport for a moment with NO field focused and
// then grow it back without firing another resize. The old focus-only
// guard let that reading through, the shell stuck at ~60% height with a
// dead band under the nav, and only opening + closing the keyboard
// (focusout → re-measure) repaired it (Mitchell, 26 Nov 2026: "big blank
// bottom when you exit the app… fixes when the keyboard comes up and then
// you close it"). A reading that is a keyboard's worth shorter than the
// window is never applied; it is re-checked shortly after instead, and
// every return to the foreground re-measures in a burst, exactly like the
// launch correction.
//
// Same signal as useKeyboardOpen (innerHeight − visualViewport.height):
// the status-bar oversize case is ~60 px, a keyboard is 250 px+, so the
// 120 px cut-off separates them cleanly.
const KEYBOARD_MIN_PX = 120;

export function ViewportHeightFix() {
  useEffect(() => {
    const root = document.documentElement;
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };

    let lastApplied = 0;
    let recheckPending = false;
    const apply = () => {
      const vv = window.visualViewport;
      const h = Math.round(vv?.height ?? root.clientHeight);
      if (h <= 0) return;
      // Keyboard-sized shrink (real keyboard, or iOS replaying one on
      // resume): never size the shell from it. One deferred re-check covers
      // the resume transient, which grows back silently; a real keyboard
      // close fires its own resize.
      if (vv && window.innerHeight - h > KEYBOARD_MIN_PX) {
        if (!recheckPending) {
          recheckPending = true;
          later(() => {
            recheckPending = false;
            apply();
          }, 400);
        }
        return;
      }
      // Ignore sub-24px jitter — iOS nudges the visual viewport a few px
      // during scrolling/bounce, and re-sizing the shell mid-scroll makes
      // the whole layout visibly jump. Only genuine changes (launch
      // correction, rotation, keyboard close, resume) pass the threshold.
      if (Math.abs(h - lastApplied) < 24) return;
      lastApplied = h;
      root.style.setProperty("--app-height", `${h}px`);
    };
    // iOS settles the web view size shortly after launch — and after a
    // return from the background — without firing any event; a burst of
    // delayed re-applies catches it.
    const burst = () => {
      apply();
      later(apply, 150);
      later(apply, 600);
      later(apply, 1500);
    };
    burst();

    const onVisible = () => {
      if (document.visibilityState === "visible") burst();
    };
    window.visualViewport?.addEventListener("resize", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    window.addEventListener("pageshow", burst);
    window.addEventListener("focus", burst);
    document.addEventListener("visibilitychange", onVisible);
    // Re-measure once the keyboard fully closes (focus leaves the field).
    const onFocusOut = () => later(apply, 250);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
      window.visualViewport?.removeEventListener("resize", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.removeEventListener("pageshow", burst);
      window.removeEventListener("focus", burst);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);
  return null;
}
