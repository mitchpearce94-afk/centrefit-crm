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
  priority: string;
  sort_order: number;
}

export function NotificationPreferences({
  types,
  initialPrefs,
}: {
  types: NotificationType[];
  initialPrefs: [string, boolean][];
}) {
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const [prefs, setPrefs] = useState<Map<string, boolean>>(
    () => new Map(initialPrefs),
  );

  // Effective enabled = explicit pref if present, otherwise type default.
  function isEnabled(t: NotificationType): boolean {
    return prefs.has(t.code) ? prefs.get(t.code)! : t.default_enabled;
  }

  function toggle(t: NotificationType) {
    const next = !isEnabled(t);
    const newPrefs = new Map(prefs);
    newPrefs.set(t.code, next);
    setPrefs(newPrefs);
    startTransition(async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          toast("Not logged in", "error");
          return;
        }
        const { error } = await supabase
          .from("staff_notification_preferences")
          .upsert(
            { staff_id: user.id, type_code: t.code, enabled: next, updated_at: new Date().toISOString() },
            { onConflict: "staff_id,type_code" },
          );
        if (error) {
          toast(`Couldn't save: ${error.message}`, "error");
          // Roll back optimistic update.
          setPrefs((p) => {
            const reverted = new Map(p);
            reverted.set(t.code, !next);
            return reverted;
          });
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : "Network error", "error");
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
    <div className="mt-6 space-y-6">
      {[...byCategory.entries()].map(([category, items]) => (
        <section key={category} className="surface-card overflow-hidden">
          <h2 className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/30">
            {category}
          </h2>
          <div className="divide-y divide-border">
            {items.map((t) => (
              <div key={t.code} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{t.label}</div>
                  {t.description && (
                    <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
                  )}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isEnabled(t)}
                  onClick={() => toggle(t)}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                    isEnabled(t) ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isEnabled(t) ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
