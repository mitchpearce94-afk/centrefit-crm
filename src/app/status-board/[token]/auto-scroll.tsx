"use client";

import { useEffect, useState } from "react";

/**
 * Hands-free vertical auto-scroll for the TV. When enabled and the content is
 * taller than the viewport it creeps down, pauses at the bottom, snaps back to
 * the top and repeats — so staff never have to touch it. A floating toggle
 * lets anyone pause it (e.g. to read a row); the choice is remembered.
 */
const STORAGE_KEY = "cf-board-autoscroll";

export function AutoScroll({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(true);

  // Restore the saved preference on mount.
  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "off") setEnabled(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const SPEED = 0.7; // px/frame (~42px/s) — readable
    const BOTTOM_PAUSE = 3000;
    const TOP_PAUSE = 2000;
    let raf = 0;
    let paused = false;

    const maxScroll = () =>
      Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

    const tick = () => {
      const max = maxScroll();
      if (max > 4 && !paused) {
        if (window.scrollY >= max - 1) {
          paused = true;
          setTimeout(() => {
            window.scrollTo({ top: 0, behavior: "smooth" });
            setTimeout(() => {
              paused = false;
            }, TOP_PAUSE);
          }, BOTTOM_PAUSE);
        } else {
          window.scrollBy(0, SPEED);
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
      {children}
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
