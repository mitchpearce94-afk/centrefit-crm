"use client";

import { useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import type { StaffRole } from "@/lib/types";

interface FlagDef {
  flag: string;
  area: string;
  label: string;
  description: string | null;
  sort_order: number;
}

interface OverrideRow {
  flag: string;
  granted: boolean;
}

const ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Admin",
  finance_manager: "Finance Manager",
  project_manager: "Project Manager",
  field_staff: "Field Staff",
};

export function StaffPermissionsEditor({
  staffId,
  staffName,
  staffRole,
  flags,
  defaultsByRole,
  initialOverrides,
}: {
  staffId: string;
  staffName: string;
  staffRole: StaffRole;
  flags: FlagDef[];
  defaultsByRole: Record<string, string[]>;
  initialOverrides: OverrideRow[];
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const [, startTransition] = useTransition();

  const isAdminTarget = staffRole === "admin";

  // The role defaults for the CURRENT role of this staff. Used as the
  // baseline against which overrides are diff'd.
  const roleDefaults = useMemo(() => {
    return new Set<string>(defaultsByRole[staffRole] ?? []);
  }, [defaultsByRole, staffRole]);

  // Local map of overrides: flag → granted (true/false). Absent = no override.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => {
    return new Map(initialOverrides.map((o) => [o.flag, o.granted]));
  });

  function effectiveState(flag: string): boolean {
    if (isAdminTarget) return true; // Admin is always on.
    if (overrides.has(flag)) return overrides.get(flag)!;
    return roleDefaults.has(flag);
  }

  function overrideState(flag: string): "default" | "granted" | "revoked" {
    if (!overrides.has(flag)) return "default";
    return overrides.get(flag) ? "granted" : "revoked";
  }

  /**
   * Toggle a flag.
   *  - If currently matches role default → write an override that flips it.
   *  - If currently has an override → remove the override (back to default).
   *
   * Each change writes audit log via log_permission_change RPC. The DB
   * function enforces is_admin() so a non-admin can't get here even with a
   * forged client call.
   */
  function toggle(flag: string) {
    if (isAdminTarget) return; // Locked.
    const roleHas = roleDefaults.has(flag);
    const currentOverride = overrides.get(flag);

    let nextOverride: boolean | null;
    let action: "grant" | "revoke" | "reset";
    let before: string;
    let after: string;

    if (currentOverride === undefined) {
      // No override yet — flip the role default.
      nextOverride = !roleHas;
      action = nextOverride ? "grant" : "revoke";
      before = roleHas ? "on(default)" : "off(default)";
      after = nextOverride ? "on(override)" : "off(override)";
    } else {
      // Override exists — remove it (reset to default).
      nextOverride = null;
      action = "reset";
      before = currentOverride ? "on(override)" : "off(override)";
      after = roleHas ? "on(default)" : "off(default)";
    }

    // Optimistic UI.
    const prev = new Map(overrides);
    const next = new Map(overrides);
    if (nextOverride === null) next.delete(flag);
    else next.set(flag, nextOverride);
    setOverrides(next);

    startTransition(async () => {
      let dbError: { message: string } | null = null;
      if (nextOverride === null) {
        const { error } = await supabase
          .from("staff_permissions")
          .delete()
          .eq("staff_id", staffId)
          .eq("flag", flag);
        dbError = error;
      } else {
        const { error } = await supabase
          .from("staff_permissions")
          .upsert(
            { staff_id: staffId, flag, granted: nextOverride, granted_at: new Date().toISOString() },
            { onConflict: "staff_id,flag" },
          );
        dbError = error;
      }

      if (dbError) {
        toast(`${flag}: ${dbError.message}`, "error");
        setOverrides(prev); // Revert.
        return;
      }

      // Audit log — best-effort; surface but don't revert the permission
      // change if only the log fails.
      const { error: logErr } = await supabase.rpc("log_permission_change", {
        p_changed_staff_id: staffId,
        p_flag: flag,
        p_action: action,
        p_before: before,
        p_after: after,
      });
      if (logErr) {
        toast(`Audit log failed: ${logErr.message}`, "error");
      }
    });
  }

  function resetAreaToDefaults(area: string) {
    if (isAdminTarget) return;
    const inArea = flags.filter((f) => f.area === area);
    const toReset = inArea.filter((f) => overrides.has(f.flag));
    if (toReset.length === 0) return;

    const prev = new Map(overrides);
    const next = new Map(overrides);
    for (const f of toReset) next.delete(f.flag);
    setOverrides(next);

    startTransition(async () => {
      const { error } = await supabase
        .from("staff_permissions")
        .delete()
        .eq("staff_id", staffId)
        .in("flag", toReset.map((f) => f.flag));
      if (error) {
        toast(error.message, "error");
        setOverrides(prev);
        return;
      }
      // One audit entry per reset so the trail is granular.
      await Promise.all(
        toReset.map((f) =>
          supabase.rpc("log_permission_change", {
            p_changed_staff_id: staffId,
            p_flag: f.flag,
            p_action: "reset",
            p_before: overrides.get(f.flag) ? "on(override)" : "off(override)",
            p_after: roleDefaults.has(f.flag) ? "on(default)" : "off(default)",
          }),
        ),
      );
      toast(`${area}: reset to ${ROLE_LABELS[staffRole]} defaults`);
    });
  }

  // Group flags by area for display.
  const byArea = useMemo(() => {
    const m = new Map<string, FlagDef[]>();
    for (const f of flags) {
      if (!m.has(f.area)) m.set(f.area, []);
      m.get(f.area)!.push(f);
    }
    return m;
  }, [flags]);

  return (
    <div className="border-t border-border bg-muted/20">
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Permissions for {staffName}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {isAdminTarget ? (
            <>
              Admin role has every permission and cannot be modified from this UI.
              Admin status is changed only by a manual SQL operation
              (intentional, prevents accidental privilege escalation).
            </>
          ) : (
            <>
              Role: <span className="font-medium text-foreground">{ROLE_LABELS[staffRole]}</span>.
              Toggles default to role presets; an override appears with a
              <span className="text-primary"> granted </span>/
              <span className="text-amber-500"> revoked </span>
              badge. Click the toggle again to reset.
            </>
          )}
        </p>
      </div>

      {[...byArea.entries()].map(([area, items]) => {
        const overriddenCount = items.filter((f) => overrides.has(f.flag)).length;
        return (
          <details key={area} className="group" open>
            <summary className="flex items-center justify-between px-4 py-2 cursor-pointer list-none select-none hover:bg-accent/30 transition-colors">
              <div className="flex items-center gap-2">
                <svg className="h-3 w-3 text-muted-foreground transition-transform group-open:rotate-90"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{area}</span>
                <span className="text-[10px] text-muted-foreground">({items.length})</span>
                {overriddenCount > 0 && !isAdminTarget && (
                  <span className="rounded-full bg-primary/15 text-primary px-1.5 py-0.5 text-[10px] font-medium">
                    {overriddenCount} override{overriddenCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {!isAdminTarget && overriddenCount > 0 && (
                <button
                  onClick={(e) => { e.preventDefault(); resetAreaToDefaults(area); }}
                  className="px-1.5 py-0.5 rounded bg-accent hover:bg-accent/80 text-[10px] text-muted-foreground transition-colors"
                  title="Remove all overrides in this area, back to role defaults"
                >
                  Reset area
                </button>
              )}
            </summary>
            <div className="divide-y divide-border border-t border-border bg-card">
              {items.map((f) => {
                const eff = effectiveState(f.flag);
                const ovState = overrideState(f.flag);
                return (
                  <div key={f.flag} className="flex items-center justify-between gap-4 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium flex items-center gap-2">
                        {f.label}
                        {ovState !== "default" && !isAdminTarget && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              ovState === "granted"
                                ? "bg-primary/15 text-primary"
                                : "bg-amber-500/15 text-amber-500"
                            }`}
                          >
                            {ovState}
                          </span>
                        )}
                      </div>
                      {f.description && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">{f.description}</div>
                      )}
                      <div className="text-[10px] text-muted-foreground mt-0.5 font-mono opacity-70">
                        {f.flag}
                      </div>
                    </div>
                    <PermissionToggle
                      checked={eff}
                      disabled={isAdminTarget}
                      onChange={() => toggle(f.flag)}
                    />
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function PermissionToggle({
  checked, disabled, onChange,
}: { checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
        checked
          ? "bg-primary/15 text-primary border border-primary/30"
          : "bg-muted/50 text-muted-foreground border border-border"
      } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <span className={`relative inline-block h-3.5 w-7 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}>
        <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-transform ${checked ? "left-[14px]" : "left-0.5"}`} />
      </span>
      <span>{checked ? "On" : "Off"}</span>
    </button>
  );
}
