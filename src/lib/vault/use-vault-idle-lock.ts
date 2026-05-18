"use client";

import { useEffect, useRef } from "react";
import { useVaultSession } from "./session";

/**
 * Vault auto-lock per docs/vault-CONTEXT.md D4.
 *  - Locks after `idleMs` of no user input (default 15 min — stricter than CRM).
 *  - Locks on tab visibility loss / window blur (covers tab-close intent).
 *
 * Tab close + page reload are handled implicitly because the session lives
 * in zustand state, which is gone on unmount/reload anyway. The visibility
 * listener catches "switched tabs and forgot" scenarios.
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

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") lock();
    };

    const events: Array<keyof WindowEventMap> = [
      "mousemove", "mousedown", "keydown", "scroll", "touchstart",
    ];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    document.addEventListener("visibilitychange", onVisibilityChange);
    reset();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach((e) => window.removeEventListener(e, reset));
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isUnlocked, lock, idleMs]);
}
