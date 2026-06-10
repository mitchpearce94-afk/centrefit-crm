"use client";

import { useRef, useState } from "react";

/**
 * Per-address fibre-uplift eligibility checker. The account-wide
 * /fibre_uplift/locations list is permission-gated on our Kinetix key, but
 * the per-location /service_qualification/fibre_uplift check works.
 */

interface Match { id: string; formattedAddress: string }

const input = "w-full rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary";

export function UpliftChecker() {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [picked, setPicked] = useState<Match | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipSearch = useRef(false);

  async function search(q: string) {
    setQuery(q);
    setPicked(null); setResult(null); setError(null);
    if (skipSearch.current) { skipSearch.current = false; return; }
    if (q.trim().length < 5) { setMatches([]); return; }
    try {
      const res = await fetch("/api/nbn/qualify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "search", fullText: q }),
      });
      const json = await res.json();
      setMatches(Array.isArray(json.matches) ? json.matches : []);
    } catch { setMatches([]); }
  }

  async function pick(m: Match) {
    skipSearch.current = true;
    setPicked(m); setQuery(m.formattedAddress); setMatches([]);
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await fetch("/api/nbn/qualify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "fibreUplift", locId: m.id }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? "Check failed");
      setResult(json.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check failed");
    } finally {
      setBusy(false);
    }
  }

  const sr = result?.siteRestriction as Record<string, unknown> | undefined;
  const tech = (sr?.supportingTechnology as { primaryAccessTechnology?: string } | undefined)?.primaryAccessTechnology;
  const serviceable = (sr?.serviceabilityStatus as string | undefined) === "Serviceable";
  const speedTiers = ((sr?.supportingProductFeatures as Array<{ speedTierAvailability?: string[] }> | undefined) ?? [])
    .flatMap((f) => f.speedTierAvailability ?? []);

  return (
    <div className="rounded-lg border border-border bg-card p-4 max-w-2xl">
      <h3 className="text-xs font-semibold mb-2">Check an address</h3>
      <div className="relative">
        <input
          className={input}
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="Start typing an address…"
        />
        {matches.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-56 overflow-auto">
            {matches.map((m) => (
              <button
                key={m.id}
                className="block w-full px-3 py-2 text-left text-xs hover:bg-muted/40"
                onClick={() => pick(m)}
              >
                {m.formattedAddress} <span className="font-mono text-[10px] text-muted-foreground">{m.id}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {busy && <p className="mt-3 text-[11px] text-muted-foreground">Checking fibre-uplift eligibility…</p>}
      {error && <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

      {result && picked && (
        <div className="mt-3 space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${serviceable ? "border-emerald-500/30 text-emerald-400" : "border-amber-500/30 text-amber-300"}`}>
              {serviceable ? "FIBRE UPLIFT AVAILABLE" : (sr?.serviceabilityStatus as string) ?? "Status unknown"}
            </span>
            {tech && <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">Uplifted tech: {tech}</span>}
          </div>
          {speedTiers.length > 0 && (
            <p className="text-muted-foreground">Speed tiers after uplift: {speedTiers.join(", ")}</p>
          )}
          <details>
            <summary className="cursor-pointer text-[10px] text-subtle hover:text-muted-foreground">Full response</summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted/30 p-2 text-[10px]">{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
