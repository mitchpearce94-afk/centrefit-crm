"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Pre-fill the site asset register from this job's accepted-quote BOM — one
 * asset shell per unit, serial blank for the tech to scan. Re-runs top up
 * (only create what's missing) instead of duplicating, and the result panel
 * calls out any BOM product that couldn't import because it isn't mapped to
 * an asset type — the silent gap that bit Tuggeranong (2026-07-13).
 */

type SkippedLine = { name: string; qty: number };

type ImportResult = {
  created: number;
  alreadyCovered: number;
  quoteRef: string | null;
  capped: boolean;
  unmapped: SkippedLine[];
  consumables: SkippedLine[];
  possibleDuplicates: Array<{ deviceType: string; count: number }>;
};

export function ImportBomToAssetsButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/import-bom-to-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Even a hard "nothing importable" comes back with the skip detail —
        // surface it so the fix (tag the products) is obvious.
        if (Array.isArray(data.unmapped) && data.unmapped.length > 0) {
          setResult({
            created: 0,
            alreadyCovered: 0,
            quoteRef: null,
            capped: false,
            unmapped: data.unmapped,
            consumables: data.consumables ?? [],
            possibleDuplicates: [],
          });
        }
        toast(data.error ?? "Import failed", "error");
        return;
      }
      setConfirming(false);
      setResult({
        created: data.created ?? 0,
        alreadyCovered: data.alreadyCovered ?? 0,
        quoteRef: data.quoteRef ?? null,
        capped: !!data.capped,
        unmapped: data.unmapped ?? [],
        consumables: data.consumables ?? [],
        possibleDuplicates: data.possibleDuplicates ?? [],
      });
      toast(
        data.created > 0
          ? `Created ${data.created} asset shell(s) from ${data.quoteRef ?? "the quote"}`
          : "Register already up to date with this quote",
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="relative inline-flex">
      {!confirming ? (
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setConfirming(true);
          }}
          className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
          title="Create site asset shells (one per unit) from this job's quote BOM. Safe to re-run — only missing units are added."
        >
          Pre-fill assets from BOM
        </button>
      ) : (
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="rounded bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Importing…" : "Confirm import"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </span>
      )}

      {result && (
        <div className="absolute right-0 top-full z-20 mt-2 w-80 max-w-[85vw] rounded-lg border border-border bg-card p-3 shadow-lg text-left">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <p className="text-xs font-semibold">
              {result.created > 0
                ? `Created ${result.created} asset shell${result.created === 1 ? "" : "s"}`
                : "No new assets needed"}
              {result.quoteRef ? ` · ${result.quoteRef}` : ""}
            </p>
            <button
              type="button"
              onClick={() => setResult(null)}
              aria-label="Dismiss import result"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>

          {result.alreadyCovered > 0 && (
            <p className="text-[11px] text-muted-foreground mb-1.5">
              {result.alreadyCovered} unit{result.alreadyCovered === 1 ? "" : "s"} already in the
              register from this job — topped up, not duplicated.
            </p>
          )}

          {result.capped && (
            <p className="text-[11px] text-amber-500 mb-1.5">
              Import stopped at the 500-unit safety cap — run again to continue.
            </p>
          )}

          {result.unmapped.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 mb-1.5">
              <p className="text-[11px] font-semibold text-amber-500 mb-1">
                Not imported — no asset type on the product:
              </p>
              <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                {result.unmapped.map((s) => (
                  <li key={s.name} className="text-[11px] text-foreground">
                    {s.name} <span className="text-muted-foreground">×{s.qty}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/settings/products"
                className="mt-1.5 inline-block text-[11px] font-medium text-amber-500 underline underline-offset-2 hover:opacity-80"
              >
                Tag them on Settings → Products, then re-run
              </Link>
            </div>
          )}

          {result.possibleDuplicates.length > 0 && (
            <div className="rounded-md border border-border bg-muted/40 p-2 mb-1.5">
              <p className="text-[11px] font-semibold mb-1">
                Check for doubles — manually-added assets of the same type already on this site:
              </p>
              <ul className="space-y-0.5">
                {result.possibleDuplicates.map((d) => (
                  <li key={d.deviceType} className="text-[11px] text-muted-foreground">
                    {d.deviceType} ×{d.count}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.consumables.length > 0 && (
            <p
              className="text-[11px] text-muted-foreground"
              title={result.consumables.map((s) => `${s.name} ×${s.qty}`).join("\n")}
            >
              {result.consumables.length} consumable line
              {result.consumables.length === 1 ? "" : "s"} skipped (cable, mounts, plugs — hover to
              see).
            </p>
          )}
        </div>
      )}
    </span>
  );
}
