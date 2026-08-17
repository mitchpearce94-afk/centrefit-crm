"use client";

import { useEffect, useState } from "react";

/**
 * Returns true while the on-screen keyboard is (very likely) up — an editable
 * element is focused AND the visual viewport has actually shrunk. iOS Safari
 * pushes `position: fixed` bottom bars upward when the keyboard appears, so
 * they float mid-screen; we hide bottom bars while typing.
 *
 * Focus alone is NOT a safe proxy: a programmatic autoFocus (e.g. the vault
 * unlock form) focuses an input WITHOUT raising the keyboard on iOS, which
 * used to hide the mobile nav with no way to bring it back. And Safari does
 * not reliably fire focusout for an input that unmounts while focused, which
 * left the nav permanently hidden. Requiring a real viewport shrink — and
 * re-checking on every visualViewport resize — fixes both failure modes.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function isEditable(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }
    function viewportShrunk(): boolean {
      const vv = window.visualViewport;
      if (!vv) return true; // no signal available — fall back to focus-only
      return window.innerHeight - vv.height > 60;
    }
    function recompute() {
      setOpen(isEditable(document.activeElement) && viewportShrunk());
    }
    function onFocusOut() {
      // FocusOut fires before focusin lands on the next element — defer a
      // tick so tapping between inputs doesn't flicker the bars back in.
      setTimeout(recompute, 0);
    }
    document.addEventListener("focusin", recompute);
    document.addEventListener("focusout", onFocusOut);
    window.visualViewport?.addEventListener("resize", recompute);
    return () => {
      document.removeEventListener("focusin", recompute);
      document.removeEventListener("focusout", onFocusOut);
      window.visualViewport?.removeEventListener("resize", recompute);
    };
  }, []);

  return open;
}
