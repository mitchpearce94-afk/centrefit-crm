"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

/**
 * MFA verify step (security hardening 2026-07-06). Runs after password
 * sign-in when the account has a verified TOTP factor — middleware bounces
 * any aal1 session with an enrolled factor here before it can touch the
 * dashboard. challengeAndVerify elevates the session to aal2.
 */
export default function MfaVerifyPage() {
  return (
    <Suspense fallback={null}>
      <MfaVerifyInner />
    </Suspense>
  );
}

function MfaVerifyInner() {
  const router = useRouter();
  const supabase = createClient();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) {
        setError(listError.message);
        return;
      }
      const verified = data?.totp?.find((f) => f.status === "verified") ?? data?.totp?.[0];
      if (!verified) {
        // No factor yet — enrolment is the right page.
        router.replace("/login/mfa-setup");
        return;
      }
      setFactorId(verified.id);
      inputRef.current?.focus();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify(candidate: string) {
    if (!factorId || submitting.current) return;
    submitting.current = true;
    setChecking(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: candidate,
    });
    if (verifyError) {
      setError("That code didn't match — check your authenticator app and try again.");
      setCode("");
      setChecking(false);
      submitting.current = false;
      inputRef.current?.focus();
      return;
    }
    router.push("/");
    router.refresh();
  }

  function handleChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) void verify(digits);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center px-4 overflow-hidden">
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
          <p className="mt-4 text-sm text-muted-foreground">Two-factor authentication</p>
        </div>

        <div className="surface-card-elevated p-6">
          <p className="text-sm text-foreground font-medium">Enter your 6-digit code</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            Open the authenticator app on your phone and type the code shown for Centrefit CRM.
          </p>

          {error && (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <input
            ref={inputRef}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => handleChange(e.target.value)}
            disabled={checking || !factorId}
            className="mt-4 block w-full rounded-md border border-border bg-input px-3 py-3 text-center text-2xl tracking-[0.5em] font-mono text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            placeholder="······"
          />
          {checking && <p className="mt-2 text-center text-xs text-muted-foreground">Checking…</p>}

          <button
            type="button"
            onClick={signOut}
            className="mt-4 block w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out and use a different account
          </button>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            Lost your phone? An admin can reset your two-factor setup from the Staff page.
          </p>
        </div>
      </div>
    </div>
  );
}
