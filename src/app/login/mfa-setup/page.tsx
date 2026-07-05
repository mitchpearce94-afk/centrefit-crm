"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

/**
 * One-time MFA enrolment (security hardening 2026-07-06). Middleware sends
 * every authenticated staff member without a verified TOTP factor here —
 * scan the QR with any authenticator app, confirm one code, and the session
 * elevates to aal2. Stale unverified factors from abandoned attempts are
 * cleaned up before enrolling a fresh one.
 */
export default function MfaSetupPage() {
  return (
    <Suspense fallback={null}>
      <MfaSetupInner />
    </Suspense>
  );
}

function MfaSetupInner() {
  const router = useRouter();
  const supabase = createClient();
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  const submitting = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data: factors } = await supabase.auth.mfa.listFactors();
      if (factors?.totp?.some((f) => f.status === "verified")) {
        router.replace("/login/mfa");
        return;
      }
      // Clear abandoned unverified factors so enroll starts clean.
      for (const f of factors?.all ?? []) {
        if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator app",
      });
      if (enrollError || !data) {
        setError(enrollError?.message ?? "Couldn't start enrolment — refresh to try again.");
        return;
      }
      setFactorId(data.id);
      const qrCode = data.totp.qr_code;
      setQr(qrCode.startsWith("data:") ? qrCode : `data:image/svg+xml;utf8,${encodeURIComponent(qrCode)}`);
      setSecret(data.totp.secret);
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
      setError("That code didn't match — wait for the next code in your app and try again.");
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
    <div className="relative flex min-h-dvh items-center justify-center px-4 py-8 overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(59,130,246,0.18), transparent 60%), radial-gradient(40% 40% at 100% 100%, rgba(139,92,246,0.12), transparent 60%)",
        }}
      />
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <Image
            src="/centrefit-logo.png"
            alt="Centrefit Group"
            width={240}
            height={60}
            priority
            className="mx-auto h-12 w-auto"
            style={{ filter: "var(--logo-filter)" }}
          />
          <p className="mt-4 text-sm text-muted-foreground">Set up two-factor authentication</p>
        </div>

        <div className="surface-card-elevated p-6">
          <p className="text-sm text-foreground font-medium">Protect your account — one-time setup</p>
          <ol className="mt-2 space-y-1 text-xs text-muted-foreground leading-relaxed list-decimal pl-4">
            <li>
              Open an authenticator app on your phone — Google Authenticator, Microsoft
              Authenticator, or the iPhone camera / built-in passwords app all work.
            </li>
            <li>Scan the QR code below (or type the setup key manually).</li>
            <li>Enter the 6-digit code the app shows to finish.</li>
          </ol>

          {error && (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="mt-4 flex justify-center">
            {qr ? (
              <div className="rounded-xl bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="Scan this QR code with your authenticator app" width={190} height={190} />
              </div>
            ) : (
              <div className="flex h-[214px] w-[214px] items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted-foreground">
                {error ? "—" : "Generating…"}
              </div>
            )}
          </div>
          {secret && (
            <p className="mt-2 text-center text-[11px] text-muted-foreground break-all">
              Can&apos;t scan? Setup key: <span className="font-mono">{secret}</span>
            </p>
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
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
