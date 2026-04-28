"use client";

import { useEffect, useState } from "react";

type Status = "idle" | "completing" | "complete" | "error";

export function CompleteFlow({ redirectFlowId }: { redirectFlowId: string | null }) {
  const [status, setStatus] = useState<Status>(redirectFlowId ? "completing" : "idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!redirectFlowId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/recurring-plans/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ redirect_flow_id: redirectFlowId }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          setError(json.error ?? "Completion failed");
        } else {
          setStatus("complete");
        }
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Network error");
      }
    })();
    return () => { cancelled = true; };
  }, [redirectFlowId]);

  if (status === "idle") {
    // No redirect_flow_id in URL — they've landed here directly. Still show
    // a helpful message rather than an empty/broken state.
    return <Confirmed />;
  }
  if (status === "completing") return <Spinner />;
  if (status === "complete") return <Confirmed />;
  return <ErrorState error={error} />;
}

function Spinner() {
  return (
    <>
      <div className="w-16 h-16 mx-auto rounded-full bg-muted/40 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
      <h1 className="text-2xl font-semibold text-foreground">Finalising your direct debit...</h1>
      <p className="text-sm text-muted-foreground leading-relaxed">
        One moment — we're confirming your setup with GoCardless.
      </p>
    </>
  );
}

function Confirmed() {
  return (
    <>
      <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/10 flex items-center justify-center">
        <svg
          className="w-8 h-8 text-emerald-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h1 className="text-2xl font-semibold text-foreground">Direct debit confirmed</h1>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Thanks — we've got your direct debit details. Your account will be
        activated in 1–3 business days once the bank verifies the mandate.
        You'll receive an email confirmation when your first invoice is
        issued.
      </p>
      <p className="text-xs text-muted-foreground pt-4">
        Questions? Reply to your setup email or contact{" "}
        <a href="mailto:accounts@centrefit.com.au" className="underline">
          accounts@centrefit.com.au
        </a>
      </p>
    </>
  );
}

function ErrorState({ error }: { error: string | null }) {
  return (
    <>
      <div className="w-16 h-16 mx-auto rounded-full bg-amber-500/10 flex items-center justify-center">
        <svg
          className="w-8 h-8 text-amber-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A9.004 9.004 0 003 12c0 4.97 4.03 9 9 9s9-4.03 9-9-4.03-9-9-9z" />
        </svg>
      </div>
      <h1 className="text-2xl font-semibold text-foreground">Almost there</h1>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Your direct debit was signed but we couldn't finalise it on our end:
      </p>
      <p className="text-xs font-mono text-amber-400 bg-amber-500/10 px-3 py-2 rounded-md">
        {error ?? "Unknown error"}
      </p>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Don't worry — your mandate is safely with GoCardless and we'll pick
        it up automatically. If anything seems wrong on your first invoice,
        just reply to your setup email.
      </p>
    </>
  );
}
