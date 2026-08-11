"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";

const REASON_MESSAGES: Record<string, string> = {
  idle: "Signed out — your session was idle for too long. Sign in again to continue.",
  expired: "Signed out — your session reached its maximum length. Sign in again to continue.",
};

// Devices that have completed a passkey sign-in get the one-tap unlock as the
// primary action on the next visit (the "open the app, Face ID, you're in"
// flow — Mitchell 2026-07-28). localStorage, not a cookie: purely a UI hint,
// zero auth weight.
const PASSKEY_DEVICE_KEY = "cf-passkey-device";

// Remember-me: the checkbox state persists per device (localStorage) and the
// live choice rides to the server as the cf-remember cookie, which middleware
// bakes into the new session's enforcement stamps at first request. Ticked =
// that login gets a 14-day idle window + 14-day cap instead of 4h/12h.
const REMEMBER_PREF_KEY = "cf-remember-pref";
const REMEMBER_COOKIE = "cf-remember";
const REMEMBER_MAX_AGE_S = 60 * 60 * 24 * 14; // 14 days

function writeRememberCookie(on: boolean) {
  document.cookie = on
    ? `${REMEMBER_COOKIE}=1; path=/; max-age=${REMEMBER_MAX_AGE_S}; samesite=lax`
    : `${REMEMBER_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

// useSearchParams() forces this client component into a Suspense boundary at
// build time per Next.js 16. The reason banner is the only thing that reads
// query params, so it lives in its own child component and we render `null`
// during prerender fallback.
function ReasonBanner() {
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason");
  const reasonMessage = reason ? REASON_MESSAGES[reason] ?? null : null;
  if (!reasonMessage) return null;
  return (
    <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
      {reasonMessage}
    </div>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // null = not yet known (pre-hydration); avoids a layout flash.
  const [passkeyDevice, setPasskeyDevice] = useState<boolean | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [remember, setRemember] = useState(false);
  const autoPrompted = useRef(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    try {
      setPasskeyDevice(localStorage.getItem(PASSKEY_DEVICE_KEY) === "1");
    } catch {
      setPasskeyDevice(false);
    }
    try {
      const pref = localStorage.getItem(REMEMBER_PREF_KEY) === "1";
      setRemember(pref);
      // Sync the cookie to the stored preference so the silent passkey
      // auto-prompt (which can sign in before any click) honours it too.
      writeRememberCookie(pref);
    } catch {}
  }, []);

  function toggleRemember(on: boolean) {
    setRemember(on);
    try {
      localStorage.setItem(REMEMBER_PREF_KEY, on ? "1" : "0");
    } catch {}
    writeRememberCookie(on);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
    }
  }

  // One-tap passkey sign-in (Windows Hello / Face ID / Touch ID). The
  // discoverable-credential ceremony resolves the account itself — no email
  // needed — and middleware treats it as MFA-satisfied (no TOTP step).
  // `silent` = the automatic attempt on page load; failures there stay quiet
  // (browsers may require a tap first) and the button remains.
  async function handlePasskey(silent = false) {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    const { error } = await supabase.auth.signInWithPasskey();
    if (error) {
      if (!silent) {
        const msg = error.message.toLowerCase();
        setError(
          msg.includes("cancel")
            ? "Passkey sign-in was cancelled."
            : `Passkey sign-in failed: ${error.message}. Use your password instead, then add a passkey from Account.`,
        );
        // Revoked/unknown credential — stop preferring the one-tap flow here.
        if (msg.includes("not_found") || msg.includes("not found")) {
          try {
            localStorage.removeItem(PASSKEY_DEVICE_KEY);
          } catch {}
          setPasskeyDevice(false);
        }
        setLoading(false);
      }
    } else {
      try {
        localStorage.setItem(PASSKEY_DEVICE_KEY, "1");
      } catch {}
      router.push("/");
      router.refresh();
    }
  }

  // Auto-prompt once on devices that have used a passkey before — waking the
  // installed app after idle becomes: open → Face ID sheet → in.
  useEffect(() => {
    if (passkeyDevice && !autoPrompted.current) {
      autoPrompted.current = true;
      void handlePasskey(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passkeyDevice]);

  const passwordFormVisible = passkeyDevice === false || showPasswordForm;

  return (
    <div className="relative flex min-h-dvh items-center justify-center px-4 overflow-hidden">
      {/* Ambient gradient backdrop */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(59,130,246,0.18), transparent 60%), radial-gradient(40% 40% at 100% 100%, rgba(139,92,246,0.12), transparent 60%)",
        }}
      />

      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Image
            src="/centrefit-logo.png"
            alt="Centrefit Group"
            width={240}
            height={60}
            priority
            className="mx-auto h-12 w-auto"
            style={{ filter: "var(--logo-filter)" }}
          />
          <p className="mt-4 text-sm text-muted-foreground">
            CRM · Sign in to your account
          </p>
        </div>

        <div className="surface-card-elevated p-6">
          <div className="space-y-4">
            {!error && (
              <Suspense fallback={null}>
                <ReasonBanner />
              </Suspense>
            )}
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            {/* Applies to whichever sign-in method is used below. The choice
                sticks per device, so tick it once on your own machine. */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => toggleRemember(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-xs text-muted-foreground">Keep me signed in for 14 days on this device</span>
            </label>

            {/* Passkey-first on devices that have used one */}
            {passkeyDevice === true && (
              <>
                <button
                  type="button"
                  onClick={() => handlePasskey()}
                  disabled={loading}
                  className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md disabled:opacity-50"
                >
                  {loading ? "Waiting for your device…" : "Unlock with Face ID / passkey"}
                </button>
                {!passwordFormVisible && (
                  <button
                    type="button"
                    onClick={() => setShowPasswordForm(true)}
                    className="block w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Use email &amp; password instead
                  </button>
                )}
              </>
            )}

            {passwordFormVisible && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label
                    htmlFor="email"
                    className="block text-xs font-medium text-muted-foreground uppercase tracking-wider"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="mt-1.5 block w-full rounded-md border border-border bg-input px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="you@centrefit.com.au"
                  />
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="block text-xs font-medium text-muted-foreground uppercase tracking-wider"
                  >
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="mt-1.5 block w-full rounded-md border border-border bg-input px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md disabled:opacity-50"
                >
                  {loading ? "Signing in…" : "Sign in"}
                </button>

                <Link
                  href="/forgot-password"
                  className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Forgot your password?
                </Link>
              </form>
            )}

            {passkeyDevice === false && (
              <>
                <div className="flex items-center gap-3 pt-1">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">or</span>
                  <span className="h-px flex-1 bg-border" />
                </div>

                <button
                  type="button"
                  onClick={() => handlePasskey()}
                  disabled={loading}
                  className="w-full rounded-md border border-border bg-transparent px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                >
                  Sign in with a passkey
                </button>
                <p className="text-center text-[10px] text-muted-foreground -mt-2">
                  Face ID, Windows Hello or your password manager — add one from Account after signing in.
                </p>
              </>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Centrefit Group · Brisbane
        </p>
      </div>
    </div>
  );
}
