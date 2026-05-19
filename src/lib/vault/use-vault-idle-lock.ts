"use client";

import { useEffect, useRef } from "react";
import { useVaultSession } from "./session";

/**
 * Vault auto-lock per docs/vault-CONTEXT.md D4.
 *  - Locks after `idleMs` of no user input (default 15 min — stricter than CRM).
 *  - Tab close + page reload lock implicitly because the session lives in
 *    zustand state which is gone on unmount.
 *
 * We DON'T lock on `visibilitychange` (tab switch) — that bit too hard on
 * the common workflow of "copy a password, switch to another tab to paste,
 * come back". The 15-min timer still runs in background tabs (browsers
 * throttle but don't pause it), so leaving the tab open and walking away
 * still locks within the same window.
 *
 * Mount once at the top of the vault page (inside <VaultShell />).
 */
export function useVaultIdleLock(idleMs = 15 * 60 * 1000) {
  const lock = useVaultSession((s) => s.lock);
  const isUnlocked = useVaultSession((s) => s.isUnlocked());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isUnlocked) return;

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(lock, idleMs);
    };

    const events: Array<keyof WindowEventMap> = [
      "mousemove", "mousedown", "keydown", "scroll", "touchstart",
    ];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [isUnlocked, lock, idleMs]);
}
