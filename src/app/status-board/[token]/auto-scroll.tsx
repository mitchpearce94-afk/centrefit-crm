"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Hands-free auto-scroll for the TV. Scrolls ITS OWN container (so the page
 * header + column labels stay put and only the job list moves). When enabled
 * and the list overflows, it drifts down, pauses at the bottom, snaps back to
 * the top and repeats. A floating toggle pauses/resumes it; the choice sticks.
 */
const STORAGE_KEY = "cf-board-autoscroll";

export function AutoScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "off") setEnabled(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    const SPEED = 0.35; // px/frame (~21px/s) — gentle but visible
    const BOTTOM_PAUSE = 3000;
    const TOP_PAUSE = 2000;
    let raf = 0;
    let paused = false;
    let acc = 0; // sub-pixel accumulator so slow speeds stay smooth

    const maxScroll = () => Math.max(0, el.scrollHeight - el.clientHeight);

    const tick = () => {
      const max = maxScroll();
      if (max > 4 && !paused) {
        if (el.scrollTop >= max - 1) {
          paused = true;
          acc = 0;
          setTimeout(() => {
            el.scrollTo({ top: 0, behavior: "smooth" });
            setTimeout(() => {
              paused = false;
            }, TOP_PAUSE);
          }, BOTTOM_PAUSE);
        } else {
          acc += SPEED;
          const px = Math.floor(acc);
          if (px >= 1) {
            el.scrollBy(0, px);
            acc -= px;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  function toggle() {
    setEnabled((v) => {
      const next = !v;
      localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
      return next;
    });
  }

  return (
    <>
      <div ref={ref} className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        {children}
      </div>
      <button
        type="button"
        onClick={toggle}
        className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white/80 backdrop-blur transition-colors hover:bg-white/20"
      >
        <span className={`h-2 w-2 rounded-full ${enabled ? "bg-emerald-400" : "bg-white/30"}`} />
        Auto-scroll: {enabled ? "On" : "Off"}
      </button>
    </>
  );
}
