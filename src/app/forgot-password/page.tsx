"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send reset email");
    }
    setBusy(false);
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
          <p className="mt-4 text-sm text-muted-foreground">
            Reset your password
          </p>
        </div>

        <div className="surface-card-elevated p-6">
          {done ? (
            <div className="space-y-4">
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
                If that email is on a Centrefit CRM account, a temporary password is on its way. Check your inbox in a minute.
              </div>
              <Link
                href="/login"
                className="block w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground text-center transition-colors hover:bg-primary/90"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Enter your email and we'll send you a temporary password. You'll be prompted to set a new one when you sign in.
              </p>

              <div>
                <label htmlFor="email" className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">
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

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md disabled:opacity-50"
              >
                {busy ? "Sending..." : "Send reset email"}
              </button>

              <Link
                href="/login"
                className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Back to sign in
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
