"use client";

import { useState } from "react";

export function StateFolder({
  state,
  count,
  children,
}: {
  state: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    // overflow-visible (default) so kebab dropdowns inside child rows can
    // escape the folder box. Header & rows still render inside the rounded
    // border because the wrapper has the bg/border applied directly.
    <div className="bg-card border border-border rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 bg-accent/30 hover:bg-accent/50 transition-colors flex items-center justify-between cursor-pointer rounded-t-lg"
      >
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">{open ? "▼" : "▶"}</span>
          <span className="text-sm font-bold text-foreground">{state}</span>
          <span className="text-xs text-muted-foreground">
            {count} plan{count !== 1 ? "s" : ""}
          </span>
        </div>
      </button>
      {open && children}
    </div>
  );
}
