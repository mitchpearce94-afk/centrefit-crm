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
const IDLE_MS = 30 * 60 * 1000;

const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;

export function IdleLogout() {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const trigger = async () => {
      try { await supabase.auth.signOut(); } catch { /* offline → middleware catches next request */ }
      router.replace("/login?reason=idle");
    };

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(trigger, IDLE_MS);
    };

    reset();
    for (const e of ACTIVITY_EVENTS) {
      window.addEventListener(e, reset, { passive: true });
    }
    document.addEventListener("visibilitychange", reset);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, reset);
      document.removeEventListener("visibilitychange", reset);
    };
  }, [router]);

  return null;
}
