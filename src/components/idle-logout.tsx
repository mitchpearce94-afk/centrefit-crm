"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Catches the "tab left open overnight" case that the middleware can't see —
 * if no request goes through for IDLE_MS, we sign out client-side and redirect
 * to /login?reason=idle so the user gets the same banner they'd see if a
 * middleware-driven idle redirect had fired.
 *
 * Mirrors the server-side window in src/lib/supabase/middleware.ts. Keep both
 * in sync if you tune the policy.
 */
// Keep in lockstep with IDLE_TIMEOUT_MS in src/lib/supabase/middleware.ts
// (4h since 2026-07-06 — MFA made the 30-min window unnecessary friction).
const IDLE_MS = 4 * 60 * 60 * 1000;
// Remember-me sessions idle out at 14 days instead — mirror REMEMBER_MS in
// the middleware. The cf-remember cookie is the login form's device
// preference (JS-readable by design); the middleware stamp stays the
// authority, this just stops the client guard firing early.
const REMEMBER_IDLE_MS = 14 * 24 * 60 * 60 * 1000;

const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;

export function IdleLogout() {
  const router = useRouter();
  const lastActivityRef = useRef(Date.now());
  const firedRef = useRef(false);

  useEffect(() => {
    const supabase = createClient();

    const trigger = async () => {
      if (firedRef.current) return;
      firedRef.current = true;
      try { await supabase.auth.signOut(); } catch { /* offline → middleware catches next request */ }
      router.replace("/login?reason=idle");
    };

    // Wall-clock comparison, NOT a one-shot timer: setTimeout doesn't tick
    // while the machine sleeps, and the old visibilitychange handler RESET the
    // timer on wake — so a laptop closed overnight sailed straight back in.
    // Waking or refocusing now CHECKS the elapsed time instead of forgiving it.
    const check = () => {
      const remembered = document.cookie.split("; ").includes("cf-remember=1");
      if (Date.now() - lastActivityRef.current > (remembered ? REMEMBER_IDLE_MS : IDLE_MS)) void trigger();
    };
    const activity = () => {
      lastActivityRef.current = Date.now();
    };

    const interval = setInterval(check, 30_000);
    for (const e of ACTIVITY_EVENTS) {
      window.addEventListener(e, activity, { passive: true });
    }
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);

    return () => {
      clearInterval(interval);
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, activity);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [router]);

  return null;
}
