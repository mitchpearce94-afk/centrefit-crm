"use client";

import { useEffect, useState } from "react";

/**
 * Xero contact picker (docs/billing-contact-CONTEXT.md D3). Searches Xero by
 * name as you type (ACTIVE contacts), shows address/email so two similar
 * names can be told apart, and hands back the chosen contact. Used on the
 * invoice page (re-bill this invoice) and the site Owner tab (future
 * invoices). No creation here — a missing contact is created by the CRM at
 * invoice time from the site's invoice name, as it always has been.
 */
export interface PickedXeroContact {
  id: string;
  name: string;
  email: string | null;
  addressLine: string | null;
}

export function XeroContactPicker({
  title,
  intro,
  currentId,
  onClose,
  onPick,
  confirmLabel = "Use this contact",
  extra,
}: {
  title: string;
  intro?: string;
  currentId?: string | null;
  onClose: () => void;
  onPick: (c: PickedXeroContact) => Promise<void> | void;
  confirmLabel?: string;
  /** Optional controls rendered above the confirm button (e.g. a checkbox). */
  extra?: React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedXeroContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<PickedXeroContact | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/xero/contacts?q=${encodeURIComponent(q.trim())}`);
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || "Search failed");
        setResults(j.contacts ?? []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function confirm() {
    if (!chosen) return;
    setBusy(true);
    try {
      await onPick(chosen);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="xero-contact-picker-title"
        className="w-full max-w-md rounded-xl border border-border bg-background shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-5 py-3">
          <p id="xero-contact-picker-title" className="text-sm font-semibold text-foreground">{title}</p>
          {intro && <p className="mt-0.5 text-[11px] text-muted-foreground">{intro}</p>}
        </div>
        <div className="px-5 py-4 space-y-3">
          <input
            id="xero-contact-search"
            value={q}
            onChange={(e) => { setQ(e.target.value); setChosen(null); }}
            placeholder="Search Xero contacts by name…"
            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            autoFocus
          />
          <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {loading && <li className="px-3 py-2 text-xs text-muted-foreground">Searching Xero…</li>}
            {error && <li className="px-3 py-2 text-xs text-red-400">{error}</li>}
            {!loading && !error && q.trim().length >= 2 && results.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">No Xero contact matches. Contacts are created from the site&apos;s invoice name when an invoice is raised.</li>
            )}
            {!loading && q.trim().length < 2 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">Type at least two letters.</li>
            )}
            {results.map((c) => {
              const isCurrent = c.id === currentId;
              const isChosen = chosen?.id === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setChosen(c)}
                    className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm transition-colors ${isChosen ? "bg-primary/15" : "hover:bg-accent"}`}
                  >
                    <span className="font-medium text-foreground">
                      {c.name}
                      {isCurrent && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">current</span>}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{[c.addressLine, c.email].filter(Boolean).join(" · ") || "No address or email on the contact"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {extra}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!chosen || busy || chosen.id === currentId}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
