"use client";

import { useEffect, useRef } from "react";

/**
 * Hands-free vertical auto-scroll for the TV. If the content is taller than the
 * viewport it creeps down slowly, pauses at the bottom, snaps back to the top
 * and repeats — so staff never have to touch it. No-op when everything fits.
 */
export function AutoScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const SPEED = 0.5; // px per frame (~30px/s at 60fps) — readable
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
          // Reached the bottom — hold, jump back up, hold, resume.
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
  }, []);

  return <div ref={ref}>{children}</div>;
}
