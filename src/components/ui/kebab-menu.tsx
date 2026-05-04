"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface KebabItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  hidden?: boolean;
}

export interface KebabSection {
  items: KebabItem[];
}

interface Props {
  sections: KebabSection[];
  triggerLabel?: string;
  align?: "left" | "right";
  className?: string;
  children?: ReactNode;
}

export function KebabMenu({ sections, triggerLabel = "More", align = "right", className = "", children }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const visibleSections = sections
    .map((s) => ({ items: s.items.filter((i) => !i.hidden) }))
    .filter((s) => s.items.length > 0);

  if (visibleSections.length === 0 && !children) return null;

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="5" r="1.4" />
          <circle cx="12" cy="12" r="1.4" />
          <circle cx="12" cy="19" r="1.4" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-50 mt-1 min-w-[200px] rounded-md border border-border bg-card-elevated shadow-xl overflow-hidden ${align === "right" ? "right-0" : "left-0"}`}
        >
          {visibleSections.map((section, si) => (
            <div key={si} className={si > 0 ? "border-t border-border" : ""}>
              {section.items.map((item, ii) => (
                <button
                  key={ii}
                  role="menuitem"
                  type="button"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    item.danger
                      ? "text-red-400 hover:bg-red-500/10"
                      : "text-foreground hover:bg-accent"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
          {children}
        </div>
      )}
    </div>
  );
}
