"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";

const REASON_MESSAGES: Record<string, string> = {
  idle: "Signed out — your session was idle for too long. Sign in again to continue.",
  expired: "Signed out — your session reached the 12 hour maximum. Sign in again to continue.",
};

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
  const router = useRouter();
  const supabase = createClient();

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
          <form onSubmit={handleLogin} className="space-y-4">
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
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Centrefit Group · Brisbane
        </p>
      </div>
    </div>
  );
}
