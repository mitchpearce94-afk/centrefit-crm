"use client";

import { useEffect } from "react";

// iOS standalone PWAs mis-measure the layout viewport at cold start: 100dvh
// (and anything `fixed` to the viewport bottom) comes up short, leaving a
// dead gap under the bottom nav until a scroll forces a re-measure. The
// visual viewport API reports the TRUE height from the first frame, so we
// mirror max(visualViewport.height, layout viewport height) into
// --app-height and size the app shell with it (dashboard layout + scheduler
// use var(--app-height, 100dvh)).
//
// The max() matters: the on-screen keyboard only shrinks the visual
// viewport, so taking the max keeps the shell full-height while typing
// instead of squashing the whole app.
export function ViewportHeightFix() {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const vv = window.visualViewport?.height ?? 0;
      const icb = root.clientHeight;
      const h = Math.max(vv, icb);
      if (h > 0) root.style.setProperty("--app-height", `${h}px`);
    };
    apply();
    // iOS settles the web view size shortly after launch without firing any
    // event — a couple of delayed re-applies catch it.
    const t1 = window.setTimeout(apply, 150);
    const t2 = window.setTimeout(apply, 600);
    window.visualViewport?.addEventListener("resize", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.visualViewport?.removeEventListener("resize", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);
  return null;
}
