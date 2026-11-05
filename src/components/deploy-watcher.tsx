"use client";

import { useEffect, useState } from "react";

/**
 * Reloads a tab that has outlived a deploy (Mitchell 2026-11-05).
 *
 * Why: after each production deploy, a tab still running the previous client
 * bundle can't apply `router.refresh()` against the new server build — Next
 * detects the build mismatch and bails out, so every "save" looked like it
 * did nothing until the user reloaded by hand. With several deploys a day
 * that bit the office repeatedly (builder save, Work Completed, plan ticks).
 *
 * How: NEXT_PUBLIC_BUILD_ID is baked into this bundle at build time;
 * /api/version answers with the build that is live now. We compare on mount,
 * whenever the tab regains focus/visibility, and once a minute while visible.
 * On a mismatch we reload straight away unless the user is mid-typing, in
 * which case a small bar offers the reload and we take it at the next safe
 * moment (blur of the field, tab hidden→visible).
 */
const CLIENT_BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "unknown";
const POLL_MS = 60_000;

function typingNow(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function DeployWatcher() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (CLIENT_BUILD === "unknown" || CLIENT_BUILD.startsWith("local-")) return;
    let cancelled = false;
    let reloading = false;

    const reload = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    const check = async () => {
      if (cancelled || reloading || document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build?: string };
        if (!build || build === "unknown" || build === CLIENT_BUILD) return;
        if (typingNow()) setStale(true);
        else reload();
      } catch {
        /* offline or flaky — try again next tick */
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    // A stale tab reloads as soon as the user leaves the field they were in.
    const onFocusOut = () => {
      if (stale && !typingNow()) reload();
    };

    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [stale]);

  if (!stale) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-primary px-4 py-2 text-sm text-primary-foreground shadow">
      <span>The CRM has been updated.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md bg-primary-foreground/15 px-3 py-1 font-medium hover:bg-primary-foreground/25"
      >
        Reload now
      </button>
    </div>
  );
}
