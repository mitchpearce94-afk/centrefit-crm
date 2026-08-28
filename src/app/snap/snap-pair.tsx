"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Same UI hint the login page uses — devices that have done a passkey
// sign-in before get the silent auto-prompt (open → Face ID → camera).
const PASSKEY_DEVICE_KEY = "cf-passkey-device";

/**
 * Shown only when a phone has neither a session nor a paired-device cookie —
 * in practice, once per phone. A single passkey tap signs in, pairs the
 * device (server-set long-lived cookie), and reloads into the camera.
 */
export function SnapPair() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoPrompted = useRef(false);

  async function pair(silent = false) {
    if (!silent) {
      setBusy(true);
      setError(null);
    }
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPasskey();
    if (error) {
      if (!silent) {
        const msg = error.message.toLowerCase();
        setError(
          msg.includes("cancel")
            ? "Cancelled — tap the button to try again."
            : `Passkey sign-in failed: ${error.message}`,
        );
        setBusy(false);
      }
      return;
    }
    try {
      localStorage.setItem(PASSKEY_DEVICE_KEY, "1");
    } catch {}
    try {
      await fetch("/api/snap/pair", { method: "POST" });
    } catch {}
    window.location.reload();
  }

  useEffect(() => {
    let hinted = false;
    try {
      hinted = localStorage.getItem(PASSKEY_DEVICE_KEY) === "1";
    } catch {}
    if (hinted && !autoPrompted.current) {
      autoPrompted.current = true;
      void pair(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="flex flex-col items-center justify-center gap-6 bg-[#0b1220] px-8 text-center text-white"
      style={{ height: "var(--app-height, 100dvh)" }}
    >
      <div>
        <CameraGlyph className="mx-auto h-12 w-12 text-amber-400" />
        <h1 className="mt-3 text-xl font-semibold">Receipts</h1>
        <p className="mt-1 text-sm text-white/60">
          One tap to set this phone up — you won&rsquo;t be asked again.
        </p>
      </div>

      {error && (
        <p className="max-w-xs rounded-lg bg-red-500/15 px-4 py-2 text-xs text-red-300">{error}</p>
      )}

      <button
        type="button"
        onClick={() => void pair()}
        disabled={busy}
        className="w-full max-w-xs rounded-full bg-amber-400 px-6 py-4 text-sm font-semibold text-[#0b1220] shadow-2xl transition-transform active:scale-95 disabled:opacity-50"
      >
        {busy ? "Waiting for your device…" : "Unlock with Face ID / passkey"}
      </button>

      <a
        href="/login?next=/snap"
        className="text-xs text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
      >
        No passkey on this phone? Use the CRM login
      </a>
    </div>
  );
}

function CameraGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
