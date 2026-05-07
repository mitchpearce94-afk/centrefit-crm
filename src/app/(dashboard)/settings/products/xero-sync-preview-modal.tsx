"use client";

import { useEffect } from "react";

export type PreviewReport = {
  tenantName: string | null;
  xeroItemCount: number;
  crmProductCount: number;
  summary: {
    wouldCreate: number;
    wouldUpdateLinked: number;
    wouldUpdateCollisions: number;
    wouldSkipNoSku: number;
  };
  newItems: Array<{
    productId: string;
    sku: string;
    name: string;
    sellPrice: number;
    costPrice: number;
  }>;
  linkedUpdates: Array<{
    productId: string;
    sku: string;
    xeroItemId: string;
    crmName: string;
  }>;
  collisions: Array<{
    productId: string;
    sku: string;
    crmName: string;
    xeroName: string | null;
    xeroItemId: string | null;
    changes: Array<{ field: string; from: string | number | null; to: string | number | null }>;
  }>;
  noSku: Array<{ productId: string; name: string }>;
};

function fmt(v: string | number | null): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toString();
  return v;
}

export function XeroSyncPreviewModal({
  report,
  busy,
  onCancel,
  onConfirm,
  confirmLabel = "Confirm & Sync",
}: {
  report: PreviewReport;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const s = report.summary;
  const nothingToDo =
    s.wouldCreate === 0 && s.wouldUpdateLinked === 0 && s.wouldUpdateCollisions === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-3xl max-h-[90dvh] overflow-hidden rounded-lg border border-border bg-background shadow-xl flex flex-col">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">
            Preview Xero sync{report.tenantName ? ` → ${report.tenantName}` : ""}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {report.crmProductCount} CRM product{report.crmProductCount === 1 ? "" : "s"} ·{" "}
            {report.xeroItemCount} existing Xero item{report.xeroItemCount === 1 ? "" : "s"}
          </p>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-5 text-sm">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Create new" value={s.wouldCreate} tone="good" />
            <Stat label="Update linked" value={s.wouldUpdateLinked} tone="neutral" />
            <Stat label="Overwrite collisions" value={s.wouldUpdateCollisions} tone="warn" />
            <Stat label="Skipped (no SKU)" value={s.wouldSkipNoSku} tone="muted" />
          </div>

          {report.collisions.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-400">
                Collisions — will overwrite existing Xero items
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                These CRM SKUs match existing Xero item codes. Confirming will rewrite the fields
                shown below on Xero&rsquo;s side.
              </p>
              <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5">
                <ul className="divide-y divide-amber-500/20">
                  {report.collisions.map((c) => (
                    <li key={c.productId} className="px-3 py-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="font-mono text-xs text-amber-300">{c.sku}</div>
                        <div className="text-xs text-muted-foreground">
                          {c.xeroName ?? "(unnamed)"} → {c.crmName}
                        </div>
                      </div>
                      {c.changes.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {c.changes.map((ch, i) => (
                            <li key={i} className="font-mono text-muted-foreground">
                              <span className="text-foreground/80">{ch.field}:</span>{" "}
                              <span className="line-through">{fmt(ch.from)}</span>{" "}
                              <span className="text-amber-300">→ {fmt(ch.to)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground italic">
                          No field differences — sync is a no-op for this item
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {report.newItems.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
                New Xero items
              </h3>
              <div className="mt-2 rounded-md border border-border bg-muted/20 max-h-40 overflow-y-auto">
                <ul className="divide-y divide-border text-xs">
                  {report.newItems.map((it) => (
                    <li key={it.productId} className="px-3 py-1.5 flex items-center gap-3">
                      <span className="font-mono text-emerald-300">{it.sku}</span>
                      <span className="flex-1 truncate">{it.name}</span>
                      <span className="font-mono text-muted-foreground">
                        ${it.sellPrice.toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {report.linkedUpdates.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Already linked — safe updates
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {report.linkedUpdates.length} product
                {report.linkedUpdates.length === 1 ? "" : "s"} previously synced. Refreshed with
                current CRM values.
              </p>
            </section>
          )}

          {report.noSku.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Skipped — no SKU
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {report.noSku.length} product
                {report.noSku.length === 1 ? "" : "s"} have no SKU and can&rsquo;t be synced to
                Xero (Code is the unique key).
              </p>
            </section>
          )}

          {nothingToDo && (
            <p className="text-center text-xs text-muted-foreground italic">
              Nothing to sync.
            </p>
          )}
        </div>

        <div className="border-t border-border px-5 py-3 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || nothingToDo}
            className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Syncing…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "neutral" | "muted";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-400"
      : tone === "warn"
        ? "text-amber-400"
        : tone === "neutral"
          ? "text-foreground"
          : "text-muted-foreground";
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className={`text-lg font-semibold ${toneClass}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
