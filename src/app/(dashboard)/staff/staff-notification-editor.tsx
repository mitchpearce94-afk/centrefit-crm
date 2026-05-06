"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";

interface NotificationType {
  code: string;
  label: string;
  category: string;
  description: string | null;
  default_enabled: boolean;
  email_enabled: boolean;
  priority: string;
  sort_order: number;
}

interface PrefRow {
  type_code: string;
  enabled: boolean;
  email_enabled: boolean | null;
}

export function StaffNotificationEditor({
  staffId,
  staffName,
  types,
  initialPrefs,
}: {
  staffId: string;
  staffName: string;
  types: NotificationType[];
  initialPrefs: PrefRow[];
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const [, startTransition] = useTransition();

  const [prefs, setPrefs] = useState<Map<string, { bell: boolean; email: boolean }>>(() => {
    const m = new Map<string, { bell: boolean; email: boolean }>();
    for (const t of types) {
      const row = initialPrefs.find((p) => p.type_code === t.code);
      m.set(t.code, {
        bell: row ? row.enabled : t.default_enabled,
        email: row?.email_enabled ?? t.email_enabled,
      });
    }
    return m;
  });

  function setPref(code: string, channel: "bell" | "email", value: boolean) {
    const cur = prefs.get(code) ?? { bell: false, email: false };
    const next = { ...cur, [channel]: value };
    const newMap = new Map(prefs);
    newMap.set(code, next);
    setPrefs(newMap);
    startTransition(async () => {
      const { error } = await supabase
        .from("staff_notification_preferences")
        .upsert(
          {
            staff_id: staffId,
            type_code: code,
            enabled: next.bell,
            email_enabled: next.email,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "staff_id,type_code" },
        );
      if (error) {
        toast(`${code}: ${error.message}`, "error");
        // Revert on error.
        setPrefs((p) => {
          const reverted = new Map(p);
          reverted.set(code, cur);
          return reverted;
        });
      }
    });
  }

  function bulkToggle(category: string, channel: "bell" | "email", on: boolean) {
    const inCat = types.filter((t) => t.category === category);
    startTransition(async () => {
      const newMap = new Map(prefs);
      for (const t of inCat) {
        const cur = newMap.get(t.code) ?? { bell: false, email: false };
        newMap.set(t.code, { ...cur, [channel]: on });
      }
      setPrefs(newMap);
      const rows = inCat.map((t) => ({
        staff_id: staffId,
        type_code: t.code,
        enabled: newMap.get(t.code)!.bell,
        email_enabled: newMap.get(t.code)!.email,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase
        .from("staff_notification_preferences")
        .upsert(rows, { onConflict: "staff_id,type_code" });
      if (error) {
        toast(error.message, "error");
      } else {
        toast(`${category} ${channel} notifications turned ${on ? "on" : "off"} for ${staffName}`);
      }
    });
  }

  // Group by category for display.
  const byCategory = new Map<string, NotificationType[]>();
  for (const t of types) {
    if (!byCategory.has(t.category)) byCategory.set(t.category, []);
    byCategory.get(t.category)!.push(t);
  }

  return (
    <div className="border-t border-border bg-muted/20">
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Notifications for {staffName}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          🔔 Bell shows in the top bar · ✉ Email goes to {staffName}&apos;s inbox. Each event can fire either, both, or neither.
        </p>
      </div>
      {[...byCategory.entries()].map(([category, items]) => (
        <details key={category} className="group" open>
          <summary className="flex items-center justify-between px-4 py-2 cursor-pointer list-none select-none hover:bg-accent/30 transition-colors">
            <div className="flex items-center gap-2">
              <svg className="h-3 w-3 text-muted-foreground transition-transform group-open:rotate-90"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{category}</span>
              <span className="text-[10px] text-muted-foreground">({items.length})</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>All:</span>
              <button onClick={(e) => { e.preventDefault(); bulkToggle(category, "bell", true); }} className="px-1.5 py-0.5 rounded bg-accent hover:bg-accent/80 transition-colors">🔔 on</button>
              <button onClick={(e) => { e.preventDefault(); bulkToggle(category, "bell", false); }} className="px-1.5 py-0.5 rounded bg-accent hover:bg-accent/80 transition-colors">🔔 off</button>
              <button onClick={(e) => { e.preventDefault(); bulkToggle(category, "email", true); }} className="px-1.5 py-0.5 rounded bg-accent hover:bg-accent/80 transition-colors">✉ on</button>
              <button onClick={(e) => { e.preventDefault(); bulkToggle(category, "email", false); }} className="px-1.5 py-0.5 rounded bg-accent hover:bg-accent/80 transition-colors">✉ off</button>
            </div>
          </summary>
          <div className="divide-y divide-border border-t border-border bg-card">
            {items.map((t) => {
              const cur = prefs.get(t.code) ?? { bell: false, email: false };
              return (
                <div key={t.code} className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{t.label}</div>
                    {t.description && (
                      <div className="text-[11px] text-muted-foreground mt-0.5">{t.description}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <ToggleWithIcon
                      label="Bell"
                      icon="🔔"
                      checked={cur.bell}
                      onChange={(v) => setPref(t.code, "bell", v)}
                    />
                    <ToggleWithIcon
                      label="Email"
                      icon="✉"
                      checked={cur.email}
                      onChange={(v) => setPref(t.code, "email", v)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}

function ToggleWithIcon({
  label, icon, checked, onChange,
}: { label: string; icon: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={`${label}: ${checked ? "on" : "off"}`}
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
        checked
          ? "bg-primary/15 text-primary border border-primary/30"
          : "bg-muted/50 text-muted-foreground border border-border"
      }`}
    >
      <span className="text-sm leading-none">{icon}</span>
      <span className={`relative inline-block h-3.5 w-7 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}>
        <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-transform ${checked ? "left-[14px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}
