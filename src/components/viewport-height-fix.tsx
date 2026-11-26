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
// How a keyboard-sized reading is recognised — by the SHAPE of the change,
// not by focus and not by comparing with window.innerHeight:
//  * "is a field focused" (the original guard) missed the resume case:
//    backgrounding the app and coming back makes iOS replay a keyboard-
//    shrunk visual viewport with NO field focused, then grow it back
//    without another resize. The shell stuck at ~60% height with a dead
//    band under the nav until the keyboard was opened and closed
//    (26 Nov 2026, "big blank bottom when you exit the app").
//  * "innerHeight − vv.height > 120" (the first fix) broke typing: in a
//    home-screen app iOS also shrinks window.innerHeight once the keyboard
//    animation settles, so the deferred re-check saw the two agree and
//    applied the short height — the whole app slid up out of view above
//    the keyboard (26 Nov 2026 evening, Cortex app recording).
//  * "shrink > 120 px only" (the second fix) left a strip above the
//    keyboard: iOS fires several visual-viewport resizes DURING the
//    keyboard animation with the height stepping down, and the first
//    steps (24–120 px) slipped through and were applied before the big
//    ones were held back — the shell sat ~100 px short while typing and a
//    blank band showed between the composer and the keyboard (27 Nov 2026).
// What is true in every case:
//  1. While an editable element is focused, NO shrink is applied at all
//     (the keyboard is animating or open). Growth still applies.
//  2. With nothing focused, the shell must never SHRINK by more than a
//     keyboard's worth (120 px+) while the width is unchanged. Rotation
//     changes the width; the status-bar oversize case is ~60 px; a
//     keyboard is 250 px+. Such a shrink is held back and re-checked and
//     only accepted if it persists for a few seconds (the resume transient
//     lasts well under a second).
// Growth is always applied immediately, and every return to the
// foreground re-measures in a burst like the launch correction.
const SHRINK_MIN_PX = 120;
const RECHECK_MS = [400, 1200, 2500];

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
    const editableFocused = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };

    let lastApplied = 0;
    let lastWidth = 0;
    let suspect = 0; // the held-back short reading, 0 when none
    let suspectStage = 0;
    const commit = (h: number, w: number) => {
      lastApplied = h;
      lastWidth = w;
      suspect = 0;
      suspectStage = 0;
      root.style.setProperty("--app-height", `${h}px`);
    };
    const apply = () => {
      const h = Math.round(window.visualViewport?.height ?? root.clientHeight);
      const w = Math.round(window.innerWidth);
      if (h <= 0) return;
      const rotated = lastWidth !== 0 && w !== lastWidth;
      // Rule 1: a focused field means the keyboard is animating or open —
      // never shrink the shell by any amount (the animation steps down in
      // small increments before the big one).
      if (lastApplied && !rotated && editableFocused() && lastApplied - h >= 24) return;
      if (lastApplied && !rotated && lastApplied - h > SHRINK_MIN_PX) {
        // Rule 2: keyboard-sized shrink with nothing focused (resume
        // transient): hold it back, accept only if it persists across the
        // re-checks.
        if (Math.abs(h - suspect) >= 24) {
          suspect = h;
          suspectStage = 0;
        }
        if (suspectStage >= RECHECK_MS.length) {
          commit(h, w);
          return;
        }
        const wait = RECHECK_MS[suspectStage++];
        later(apply, wait);
        return;
      }
      suspect = 0;
      suspectStage = 0;
      // Ignore sub-24px jitter — iOS nudges the visual viewport a few px
      // during scrolling/bounce, and re-sizing the shell mid-scroll makes
      // the whole layout visibly jump. Only genuine changes (launch
      // correction, rotation, keyboard close, resume) pass the threshold.
      if (Math.abs(h - lastApplied) < 24) return;
      commit(h, w);
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
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);
  return null;
}
