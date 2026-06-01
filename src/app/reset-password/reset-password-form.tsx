"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setBusy(true);
    const res = await fetch("/api/auth/reset-password/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't reset your password.");
      setBusy(false);
      return;
    }
    setDone(true);
    setBusy(false);
    setTimeout(() => router.push("/login?reset=1"), 1500);
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
          <p className="mt-4 text-sm text-muted-foreground">Choose a new password</p>
        </div>

        <div className="surface-card-elevated p-6">
          {done ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-3 text-sm text-emerald-300 text-center">
              Password updated. Taking you to the login page…
            </div>
          ) : !token ? (
            <div className="space-y-4 text-center">
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                This reset link is missing its token. Request a new one from the login page.
              </div>
              <Link href="/login" className="text-sm text-primary hover:underline">
                Back to login
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="new-password" className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="mt-1.5 block w-full rounded-md border border-border bg-input px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="At least 8 characters"
                />
              </div>

              <div>
                <label htmlFor="confirm-password" className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Confirm password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="mt-1.5 block w-full rounded-md border border-border bg-input px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md disabled:opacity-50"
              >
                {busy ? "Saving..." : "Save new password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
