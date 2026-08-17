"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { PlanVisual } from "./plan-visual";
import { DEVICE_CATALOG } from "@/lib/plan-builder/devices";

// Wireless / uncabled gear has no rough-in step — excluded from RI progress
// and untickable in the Rough In phase.
const NO_CABLE_DEVICES = new Set(
  DEVICE_CATALOG.filter((d) => d.cableType === "none").map((d) => d.id),
);

/**
 * On-site plan install checklist (Mitchell 2026-08-17). One row per device on
 * the linked plan, grouped by floor — tap to mark installed. Optimistic
 * update + rollback, same pattern as JobChecklist. Ticks live in plan_items
 * (Postgres), so desktop plan edits never clobber field progress.
 */

interface PlanFileRow {
  id: string;
  name: string;
  pdf_url: string | null;
  cfp_url: string | null;
  revision: string | null;
}

interface PlanItemRow {
  id: string;
  plan_file_id: string;
  instance_id: string;
  device_id: string;
  floor_name: string | null;
  label: string;
  qty: number;
  status: string;
  installed_at: string | null;
  roughed_in_at: string | null;
  orphaned: boolean;
  sort_order: number;
  installed_staff?: { initials: string } | null;
  roughed_staff?: { initials: string } | null;
}

export function PlanChecklist({
  planFiles,
  items,
  viewerId,
  viewerInitials,
  isNewBuild = false,
}: {
  planFiles: PlanFileRow[];
  items: PlanItemRow[];
  viewerId: string | null;
  viewerInitials: string;
  isNewBuild?: boolean;
}) {
  const [localItems, setLocalItems] = useState<PlanItemRow[]>(items);
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);
  // New builds tick twice: Rough In (cable run) then Fit Off (device on the
  // wall). Other jobs only have the single fit/installed tick.
  const [phase, setPhase] = useState<"rough" | "fit">(isNewBuild ? "rough" : "fit");
  const { toast } = useToast();
  const supabase = createClient();

  async function toggleItem(item: PlanItemRow) {
    if (item.orphaned) return;

    if (phase === "rough") {
      if (NO_CABLE_DEVICES.has(item.device_id)) return; // nothing to rough in
      const nowRoughed = !item.roughed_in_at;
      const patch = {
        roughed_in_at: nowRoughed ? new Date().toISOString() : null,
        roughed_in_by: nowRoughed ? viewerId : null,
        updated_at: new Date().toISOString(),
      };
      setLocalItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, roughed_in_at: patch.roughed_in_at, roughed_staff: nowRoughed ? { initials: viewerInitials } : null }
            : i,
        ),
      );
      const { error } = await supabase.from("plan_items").update(patch).eq("id", item.id);
      if (error) {
        setLocalItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
        toast(error.message, "error");
      }
      return;
    }

    const nowInstalled = item.status !== "installed";
    const patch = {
      status: nowInstalled ? "installed" : "pending",
      installed_at: nowInstalled ? new Date().toISOString() : null,
      installed_by: nowInstalled ? viewerId : null,
      updated_at: new Date().toISOString(),
    };

    setLocalItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? {
              ...i,
              status: patch.status,
              installed_at: patch.installed_at,
              installed_staff: nowInstalled ? { initials: viewerInitials } : null,
            }
          : i,
      ),
    );

    const { error } = await supabase.from("plan_items").update(patch).eq("id", item.id);
    if (error) {
      // Roll the tick back so the UI never shows a state the DB rejected.
      setLocalItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
      toast(error.message, "error");
    }
  }

  if (planFiles.length === 0) return null;

  return (
    <div className="max-w-2xl space-y-6">
      {planFiles.map((plan) => {
        const planItems = localItems
          .filter((i) => i.plan_file_id === plan.id)
          .sort((a, b) => a.sort_order - b.sort_order);
        const live = planItems.filter((i) => !i.orphaned);
        const installed = live.filter((i) => i.status === "installed").length;
        const riEligible = live.filter((i) => !NO_CABLE_DEVICES.has(i.device_id));
        const roughed = riEligible.filter((i) => !!i.roughed_in_at).length;
        const pct =
          phase === "rough"
            ? riEligible.length > 0 ? Math.round((roughed / riEligible.length) * 100) : 0
            : live.length > 0 ? Math.round((installed / live.length) * 100) : 0;

        // Group by floor, preserving sort order.
        const floors: { name: string; rows: PlanItemRow[] }[] = [];
        for (const item of planItems) {
          const name = item.floor_name ?? "Plan";
          const existing = floors.find((f) => f.name === name);
          if (existing) existing.rows.push(item);
          else floors.push({ name, rows: [item] });
        }

        return (
          <div key={plan.id}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold truncate">{plan.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {isNewBuild
                    ? `Rough in ${roughed}/${riEligible.length} · Fit off ${installed}/${live.length}`
                    : `${installed}/${live.length} installed`}
                </p>
              </div>
              {plan.pdf_url && (
                <a
                  href={plan.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm hover:border-primary hover:text-primary transition-colors"
                >
                  Open plan PDF
                </a>
              )}
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${phase === "rough" ? "bg-amber-500" : "bg-primary"}`}
                style={{ width: `${pct}%` }}
              />
            </div>

            {isNewBuild && (
              <div className="mt-3 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setPhase("rough")}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    phase === "rough"
                      ? "border-amber-500 bg-amber-500/10 text-amber-500"
                      : "border-border text-muted-foreground hover:border-amber-500/50"
                  }`}
                >
                  Rough In
                </button>
                <button
                  type="button"
                  onClick={() => setPhase("fit")}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    phase === "fit"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  Fit Off
                </button>
              </div>
            )}

            {live.length === 0 && (
              <p className="mt-4 text-sm text-muted-foreground">
                No checklist yet — save the plan in the plan builder to publish it.
              </p>
            )}

            {/* Fullscreen interactive drawing opens on demand; the tab body
                below is the list — both drive the same plan_items rows. */}
            <div className="mt-3 flex gap-1.5">
              <button
                type="button"
                onClick={() => {
                  if (plan.cfp_url) setOpenPlanId(plan.id);
                  else toast("No drawing file saved for this plan yet — save it in the plan builder first.", "error");
                }}
                className="rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs text-primary transition-colors hover:bg-primary/20"
              >
                Interactive plan
              </button>
              <button
                type="button"
                className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
              >
                List
              </button>
            </div>

            {openPlanId === plan.id && plan.cfp_url && (
              <PlanVisual
                planName={plan.name}
                cfpUrl={plan.cfp_url}
                itemsByInstance={new Map(
                  localItems
                    .filter((i) => i.plan_file_id === plan.id)
                    .map((i) => [i.instance_id, { ...i, roughed: !!i.roughed_in_at }]),
                )}
                onToggle={(item) => {
                  const row = localItems.find((i) => i.id === item.id);
                  if (row) toggleItem(row);
                }}
                onClose={() => setOpenPlanId(null)}
                phase={phase}
                onPhaseChange={setPhase}
                showPhases={isNewBuild}
              />
            )}

            {floors.map((floor) => (
              <div key={floor.name} className="mt-4">
                <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                  {floor.name}
                </h4>
                <div className="space-y-1.5">
                  {floor.rows.map((item) => {
                    const noCable = NO_CABLE_DEVICES.has(item.device_id);
                    const roughedDone = !!item.roughed_in_at;
                    const fitDone = item.status === "installed";
                    const done = phase === "rough" ? roughedDone : fitDone;
                    const inert = item.orphaned || (phase === "rough" && noCable);
                    const fmt = (d: string) =>
                      new Date(d).toLocaleDateString("en-AU", { day: "2-digit", month: "2-digit", year: "2-digit" });
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleItem(item)}
                        disabled={inert}
                        className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                          inert
                            ? "border-border/50 opacity-50"
                            : done
                              ? phase === "rough"
                                ? "border-amber-500/40 bg-amber-500/5"
                                : "border-primary/40 bg-primary/5"
                              : "border-border bg-card hover:border-primary/50"
                        }`}
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs ${
                            done
                              ? phase === "rough"
                                ? "border-amber-500 bg-amber-500 text-white"
                                : "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground/40"
                          }`}
                        >
                          {done && "✓"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm truncate ${done ? "line-through opacity-70" : ""}`}>
                            {item.label}
                            {item.qty > 1 && (
                              <span className="ml-1.5 text-xs text-muted-foreground">×{item.qty}</span>
                            )}
                          </span>
                          {item.orphaned ? (
                            <span className="block text-xs text-destructive/80">
                              Removed from the latest plan revision
                            </span>
                          ) : phase === "rough" && noCable ? (
                            <span className="block text-xs text-muted-foreground">
                              No cable — fit off only
                            </span>
                          ) : phase === "rough" && roughedDone && item.roughed_in_at ? (
                            <span className="block text-xs text-muted-foreground">
                              {item.roughed_staff?.initials ?? ""} {fmt(item.roughed_in_at)}
                            </span>
                          ) : phase === "fit" && fitDone && item.installed_at ? (
                            <span className="block text-xs text-muted-foreground">
                              {item.installed_staff?.initials ?? ""} {fmt(item.installed_at)}
                              {roughedDone && <span className="ml-1.5 text-amber-500">RI ✓</span>}
                            </span>
                          ) : phase === "fit" && roughedDone ? (
                            <span className="block text-xs text-amber-500">RI ✓</span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
