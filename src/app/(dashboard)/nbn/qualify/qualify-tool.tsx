"use client";

import { useEffect, useRef, useState } from "react";

interface Match {
  id: string;
  formattedAddress: string;
}

/**
 * In-CRM address qualification — same Kinetix flow the website uses, but
 * showing staff the FULL qualification payload (every product feature,
 * capacity tier and boundary), not the customer-filtered view.
 */
export function QualifyTool() {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [selected, setSelected] = useState<Match | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skip = useRef(false);

  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 5 || selected) { setMatches([]); return; }
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/nbn/qualify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "search", fullText: q }),
        });
        const json = await res.json();
        setMatches(Array.isArray(json.matches) ? json.matches : []);
      } catch {
        setMatches([]);
      }
    }, 350);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query, selected]);

  async function pick(m: Match) {
    skip.current = true;
    setSelected(m);
    setQuery(m.formattedAddress);
    setMatches([]);
    setResult(null);
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/nbn/qualify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "qualify", locId: m.id }),
      });
      const json = await res.json();
      if (!res.ok || json.error) setError(json.error ?? "Qualification failed");
      else setResult(json.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const sr = (result as { siteRestriction?: Record<string, unknown> } | null)?.siteRestriction;
  const tech = (sr?.supportingTechnology as { primaryAccessTechnology?: string } | undefined)?.primaryAccessTechnology;
  const serviceable = (sr?.serviceabilityStatus as string | undefined) === "Serviceable";

  return (
    <div className="max-w-3xl">
      <div className="relative">
        <input
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          placeholder="Start typing an address…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(null); setResult(null); }}
        />
        {matches.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-card shadow-xl">
            {matches.map((m) => (
              <button
                key={m.id}
                onClick={() => void pick(m)}
                className="block w-full px-3 py-2 text-left text-xs hover:bg-muted/40 border-b border-border last:border-0"
              >
                {m.formattedAddress}
                <span className="ml-2 font-mono text-[10px] text-muted-foreground">{m.id}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {busy && <p className="mt-3 text-xs text-muted-foreground">Qualifying with NBN…</p>}
      {error && (
        <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      {result != null && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className={`rounded-full border px-3 py-1 font-medium ${serviceable ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-300 border-red-500/20"}`}>
              {serviceable ? "SERVICEABLE" : "NOT SERVICEABLE"}
            </span>
            {tech && <span className="rounded-full border border-border px-3 py-1 text-muted-foreground">{tech}</span>}
            {selected && <span className="rounded-full border border-border px-3 py-1 font-mono text-muted-foreground">{selected.id}</span>}
          </div>
          <details open className="rounded-lg border border-border bg-card p-3">
            <summary className="text-xs font-semibold cursor-pointer">Full qualification payload</summary>
            <pre className="mt-2 max-h-[28rem] overflow-auto rounded bg-muted/30 p-2 text-[10px] leading-relaxed">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
