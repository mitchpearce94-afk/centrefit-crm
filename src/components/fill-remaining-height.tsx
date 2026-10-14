"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Sizes its box to exactly the space left in <main> below it — down to the
 * mobile nav on phones, the viewport floor on desktop — and keeps it there
 * through iOS's late viewport corrections, rotation and keyboard close.
 *
 * Why not `calc(var(--app-height) - 12rem)`: the 12rem was a guess at
 * "top bar + heading + paddings + nav" and was wrong by the safe-area inset
 * and by however many rows the heading wrapped to, so the scheduler either
 * ran under the bottom nav or left a dead strip above it (Mitchell, 15 Oct
 * 2026: "not tight on the screen"). Measuring makes it exact.
 *
 * Also zeroes <main>'s scrollTop on mount: a client-side nav from a scrolled
 * list keeps the old scroll offset, and on a route that locks <main>'s
 * overflow that left the heading hidden above the fold.
 */
export function FillRemainingHeight({
  children,
  className,
  minHeight = 240,
}: {
  children: React.ReactNode;
  className?: string;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const main = el.closest("main") as HTMLElement | null;
    if (!main) return;
    let raf = 0;

    const measure = () => {
      raf = 0;
      if (main.scrollTop !== 0) main.scrollTop = 0;
      const mainRect = main.getBoundingClientRect();
      const mainPad = parseFloat(getComputedStyle(main).paddingBottom) || 0;
      const parentPad = el.parentElement ? parseFloat(getComputedStyle(el.parentElement).paddingBottom) || 0 : 0;
      const top = el.getBoundingClientRect().top;
      const h = Math.floor(mainRect.bottom - mainPad - parentPad - top);
      if (h >= minHeight) el.style.height = `${h}px`;
    };
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(measure);
    };

    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(main);
    ro.observe(document.documentElement);
    window.visualViewport?.addEventListener("resize", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    // iOS standalone settles its web-view size shortly after launch without
    // firing anything we can listen to — re-measure after it has.
    const t1 = window.setTimeout(schedule, 200);
    const t2 = window.setTimeout(schedule, 700);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      ro.disconnect();
      window.visualViewport?.removeEventListener("resize", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
    };
  }, [minHeight]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
