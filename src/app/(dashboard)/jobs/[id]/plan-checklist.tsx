"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { PlanVisual } from "./plan-visual";

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
  floor_name: string | null;
  label: string;
  qty: number;
  status: string;
  installed_at: string | null;
  orphaned: boolean;
  sort_order: number;
  installed_staff?: { initials: string } | null;
}

export function PlanChecklist({
  planFiles,
  items,
  viewerId,
  viewerInitials,
}: {
  planFiles: PlanFileRow[];
  items: PlanItemRow[];
  viewerId: string | null;
  viewerInitials: string;
}) {
  const [localItems, setLocalItems] = useState<PlanItemRow[]>(items);
  const [view, setView] = useState<"plan" | "list">("plan");
  const { toast } = useToast();
  const supabase = createClient();

  async function toggleItem(item: PlanItemRow) {
    if (item.orphaned) return;
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
        const pct = live.length > 0 ? Math.round((installed / live.length) * 100) : 0;

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
                  {installed}/{live.length} installed
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
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>

            {live.length === 0 && (
              <p className="mt-4 text-sm text-muted-foreground">
                No checklist yet — save the plan in the plan builder to publish it.
              </p>
            )}

            {/* View toggle: the drawing is the primary surface; the list is
                the progress/orphan summary. */}
            <div className="mt-3 flex gap-1.5">
              <button
                type="button"
                onClick={() => setView("plan")}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  view === "plan"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                Plan drawing
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  view === "list"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                List
              </button>
            </div>

            {view === "plan" && plan.cfp_url && (
              <div className="mt-3">
                <PlanVisual
                  cfpUrl={plan.cfp_url}
                  itemsByInstance={new Map(planItems.map((i) => [i.instance_id, i]))}
                  onToggle={(item) => {
                    const row = planItems.find((i) => i.id === item.id);
                    if (row) toggleItem(row);
                  }}
                />
              </div>
            )}
            {view === "plan" && !plan.cfp_url && (
              <p className="mt-3 text-sm text-muted-foreground">
                No drawing file saved for this plan yet — using the list instead.
              </p>
            )}

            {view === "list" && floors.map((floor) => (
              <div key={floor.name} className="mt-4">
                <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                  {floor.name}
                </h4>
                <div className="space-y-1.5">
                  {floor.rows.map((item) => {
                    const done = item.status === "installed";
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleItem(item)}
                        disabled={item.orphaned}
                        className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                          item.orphaned
                            ? "border-border/50 opacity-50"
                            : done
                              ? "border-primary/40 bg-primary/5"
                              : "border-border bg-card hover:border-primary/50"
                        }`}
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs ${
                            done
                              ? "border-primary bg-primary text-primary-foreground"
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
                          ) : done && item.installed_at ? (
                            <span className="block text-xs text-muted-foreground">
                              {item.installed_staff?.initials ?? ""}{" "}
                              {new Date(item.installed_at).toLocaleDateString("en-AU", {
                                day: "2-digit",
                                month: "2-digit",
                                year: "2-digit",
                              })}
                            </span>
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
