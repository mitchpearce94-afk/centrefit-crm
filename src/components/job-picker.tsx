"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Searchable "Link to Job" picker for the quote wizard. Replaces the plain
 * <select> that listed only the 200 newest jobs (Mitchell, 2026-11-06: the
 * Snap Albion Park job CFA05052 had dropped off the end, so a re-quote could
 * not be linked to it). The pages now pass EVERY job; this filters as you
 * type on the job number, site name and customer name.
 */
export interface JobOption {
  id: string;
  number: string;
  customer_name: string | null;
  site_name: string | null;
}

const MAX_SHOWN = 60;

function label(j: JobOption) {
  return `${j.number}${j.site_name ? ` — ${j.site_name}` : ""}${j.customer_name ? ` (${j.customer_name})` : ""}`;
}

export function JobPicker({
  jobs,
  value,
  onChange,
  inputClassName,
  placeholder = "Search by job number, site or customer…",
  autoFocus,
}: {
  jobs: JobOption[];
  value: string;
  onChange: (jobId: string) => void;
  inputClassName: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => jobs.find((j) => j.id === value) ?? null, [jobs, value]);

  const results = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return jobs.slice(0, MAX_SHOWN);
    const hay = (j: JobOption) => `${j.number} ${j.site_name ?? ""} ${j.customer_name ?? ""}`.toLowerCase();
    return jobs.filter((j) => { const h = hay(j); return terms.every((t) => h.includes(t)); }).slice(0, MAX_SHOWN);
  }, [jobs, q]);

  useEffect(() => { setActive(0); }, [q]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(j: JobOption) {
    onChange(j.id);
    setQ("");
    setOpen(false);
  }

  function clear() {
    onChange("");
    setQ("");
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  if (selected) {
    return (
      <div className={`${inputClassName} flex items-center justify-between gap-2`}>
        <span className="truncate text-sm">{label(selected)}</span>
        <button type="button" onClick={clear} className="shrink-0 text-xs text-primary hover:underline">
          Change
        </button>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={inputClassName}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (open && results[active]) pick(results[active]); }
          else if (e.key === "Escape") { setOpen(false); }
        }}
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-popover shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No jobs match “{q.trim()}”.</p>
          ) : (
            results.map((j, i) => (
              <button
                key={j.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(j)}
                onMouseEnter={() => setActive(i)}
                className={`block w-full px-3 py-2 text-left text-sm ${i === active ? "bg-primary/10" : "hover:bg-muted"}`}
              >
                <span className="font-medium">{j.number}</span>
                {j.site_name && <span> — {j.site_name}</span>}
                {j.customer_name && <span className="text-muted-foreground"> ({j.customer_name})</span>}
              </button>
            ))
          )}
          {results.length >= MAX_SHOWN && (
            <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">Showing the first {MAX_SHOWN} — keep typing to narrow it down.</p>
          )}
        </div>
      )}
    </div>
  );
}
