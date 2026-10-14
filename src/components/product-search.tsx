"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/* Ad-hoc part picker for invoice line editors (Sue, suggestion 0EEB63C7 —
   "search and choose parts ad hoc when invoicing"). Loads the active
   quote_products catalogue once, filters by name / SKU / category as you
   type, and hands the picked product (with its ex-GST sell price) back to
   the caller. Styled to match the material picker in the job work log. */

export interface ProductPick {
  id: string;
  name: string;
  sku: string | null;
  sell_price: number;
}

interface CatalogRow {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  sell_price: number | null;
}

export function ProductSearch({
  onPick,
  placeholder = "Search parts by name, SKU or category…",
}: {
  onPick: (product: ProductPick) => void;
  placeholder?: string;
}) {
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("quote_products")
      .select("id, name, sku, category, sell_price")
      .eq("is_active", true)
      .order("category, name")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setLoadError(error.message);
        setCatalog((data as CatalogRow[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q),
    );
  }, [catalog, query]);

  function pick(p: CatalogRow) {
    onPick({ id: p.id, name: p.name, sku: p.sku, sell_price: Number(p.sell_price ?? 0) });
    setQuery("");
  }

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={loading ? "Loading parts…" : placeholder}
        disabled={loading}
        autoFocus
        className="block w-full rounded-md border border-border bg-input px-3 py-2 text-base sm:text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
      />
      {loadError && (
        <p className="mt-1 text-xs text-destructive">Couldn&apos;t load parts: {loadError}</p>
      )}
      {query.trim().length >= 1 && (
        <div className="mt-1.5 max-h-48 overflow-y-auto rounded-md border border-border bg-card/50">
          {results.slice(0, 30).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pick(p)}
              className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-accent transition-colors"
            >
              <span className="min-w-0 truncate">
                <span className="font-medium">{p.name}</span>
                {p.sku && (
                  <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{p.sku}</span>
                )}
                {p.category && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">{p.category}</span>
                )}
              </span>
              <span className="shrink-0 flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  ${Number(p.sell_price ?? 0).toFixed(2)}
                </span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  + Add
                </span>
              </span>
            </button>
          ))}
          {results.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground">No matches.</div>
          )}
        </div>
      )}
    </div>
  );
}
