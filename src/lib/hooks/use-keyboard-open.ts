"use client";

import { useEffect, useState } from "react";

/**
 * Returns true while an editable element is focused — used as a proxy for
 * "on-screen keyboard is up". iOS Safari pushes `position: fixed` bottom
 * bars upward when the keyboard appears (the visual viewport shrinks but
 * fixed elements stay pinned to the new viewport bottom), so they float
 * mid-screen, which looks broken. We hide bottom bars while typing.
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
    function onFocusIn(e: FocusEvent) {
      if (isEditable(e.target)) setOpen(true);
    }
    function onFocusOut(e: FocusEvent) {
      // FocusOut fires before focusIn on the next element, so defer the
      // check a tick — otherwise tapping from one input to the next would
      // briefly flicker the bars back in.
      setTimeout(() => {
        if (!isEditable(document.activeElement)) setOpen(false);
      }, 0);
    }
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return open;
}
