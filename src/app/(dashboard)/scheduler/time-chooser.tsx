"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  value: string; // "HH:MM" or ""
  onChange: (value: string) => void;
  placeholder?: string;
  /** Inclusive hour range to offer in the dropdown. */
  startHour?: number;
  endHour?: number;
  className?: string;
}

const MINUTES = [0, 15, 30, 45];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function parseValue(v: string): [number | null, number | null] {
  if (!v) return [null, null];
  const [h, m] = v.split(":").map(Number);
  return [Number.isFinite(h) ? h : null, Number.isFinite(m) ? m : null];
}

function fmtHour12(h: number) {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

function formatDisplay(v: string): string {
  const [h, m] = parseValue(v);
  if (h == null || m == null) return "";
  const period = h < 12 ? "AM" : "PM";
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayH}:${pad(m)} ${period}`;
}

/**
 * Click-driven 15-min time picker. Tap-tap (hour + minute) replaces typing
 * "HH:MM" by hand. "Now" snaps to the current quarter-hour. "Clear" resets
 * to empty (all-day). Avoids native <input type="time"> which is annoying
 * to type into and inconsistent across browsers.
 */
export function TimeChooser({
  value,
  onChange,
  placeholder = "—:—",
  startHour = 6,
  endHour = 22,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [open]);

  const [currH, currM] = parseValue(value);
  const display = value ? formatDisplay(value) : "";
  const hours = Array.from(
    { length: Math.max(0, endHour - startHour + 1) },
    (_, i) => startHour + i,
  );

  function pick(h: number, m: number) {
    onChange(`${pad(h)}:${pad(m)}`);
    setOpen(false);
  }

  function nowRounded() {
    const d = new Date();
    const h = d.getHours();
    const m = Math.floor(d.getMinutes() / 15) * 15;
    onChange(`${pad(h)}:${pad(m)}`);
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-left hover:border-foreground/30 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
      >
        {display ? (
          <span className="font-mono">{display}</span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-card shadow-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center gap-3">
            <button
              type="button"
              onClick={nowRounded}
              className="text-[10px] font-medium text-primary hover:underline"
            >
              Now
            </button>
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="text-[10px] text-muted-foreground hover:text-foreground ml-auto"
              >
                Clear
              </button>
            )}
          </div>
          <div className="grid grid-cols-2">
            <div className="border-r border-border max-h-56 overflow-y-auto">
              {hours.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => pick(h, currM ?? 0)}
                  className={`w-full px-3 py-1.5 text-xs text-left hover:bg-accent transition-colors ${
                    currH === h ? "bg-primary/10 text-primary font-semibold" : ""
                  }`}
                >
                  {fmtHour12(h)}
                </button>
              ))}
            </div>
            <div className="max-h-56 overflow-y-auto">
              {MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => pick(currH ?? startHour, m)}
                  className={`w-full px-3 py-1.5 text-xs text-left hover:bg-accent transition-colors font-mono ${
                    currM === m ? "bg-primary/10 text-primary font-semibold" : ""
                  }`}
                >
                  :{pad(m)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
