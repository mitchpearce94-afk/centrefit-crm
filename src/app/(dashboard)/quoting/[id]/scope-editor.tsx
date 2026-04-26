"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import {
  generateScopeOfWorks,
  type ScopeOverrides,
  type SiteInfo,
  type ScopeSystemBlock,
} from "@/lib/quote-engine";

interface Props {
  quoteId: string;
  status: string;
  bom: { product_id: string | null; quantity: number }[];
  productScopeRoles: { id: string; scope_role: string }[];
  siteInfo: SiteInfo;
  initialOverrides: ScopeOverrides | null;
  roleDescriptions: Record<string, string>;
  onClose: () => void;
}

interface SystemEdit extends ScopeSystemBlock {
  /** True when the user has edited away from the auto state. */
  isDirty?: boolean;
}

/**
 * Per-quote Scope of Works editor.
 *
 * The scope is auto-generated from the BOM. Per-quote tweaks are stored on
 * `quotes.scope_overrides` keyed by system id (security_alarm, cctv, etc).
 *
 * For each system the user can:
 *   - Toggle include / exclude
 *   - Override the lead paragraph
 *   - Override the bullet items (one per line in a textarea)
 *   - Revert any of the above to the auto-generated value
 */
export function ScopeEditor({
  quoteId, status, bom, productScopeRoles, siteInfo, initialOverrides, roleDescriptions, onClose,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const readOnly = status !== "draft";

  // The auto version (no overrides) is the baseline for compare / revert.
  const auto = useMemo(
    () => generateScopeOfWorks(bom, productScopeRoles, siteInfo, undefined, roleDescriptions),
    [bom, productScopeRoles, siteInfo, roleDescriptions],
  );

  // The applied version (with current overrides) is what we render.
  const initial = useMemo(
    () => generateScopeOfWorks(bom, productScopeRoles, siteInfo, initialOverrides ?? undefined, roleDescriptions),
    [bom, productScopeRoles, siteInfo, initialOverrides, roleDescriptions],
  );

  // We seed editor state from the applied version. Note that excluded systems
  // don't appear in initial.systems — we layer them on from auto so users can
  // toggle them back on.
  const seedSystems: SystemEdit[] = useMemo(() => {
    const includedIds = new Set(initial.systems.map((s) => s.id));
    return auto.systems.map((autoSys) => {
      const applied = initial.systems.find((s) => s.id === autoSys.id);
      const overrideMissing = !includedIds.has(autoSys.id);
      return {
        ...(applied ?? autoSys),
        included: !overrideMissing,
        isDirty: !!applied && (applied.lead !== autoSys.lead || JSON.stringify(applied.items) !== JSON.stringify(autoSys.items)),
      } satisfies SystemEdit;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [systems, setSystems] = useState<SystemEdit[]>(seedSystems);
  const [hideHardExclusion, setHideHardExclusion] = useState(!!initialOverrides?.hideHardExclusion);
  const [saving, setSaving] = useState(false);

  function patchSystem(id: string, patch: Partial<SystemEdit>) {
    setSystems((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch, isDirty: true } : s)));
  }

  function revertSystem(id: string) {
    const autoSys = auto.systems.find((s) => s.id === id);
    if (!autoSys) return;
    setSystems((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...autoSys, included: true, isDirty: false }
          : s,
      ),
    );
  }

  function buildOverrides(): ScopeOverrides | null {
    const ov: ScopeOverrides = {};
    const sysOverrides: NonNullable<ScopeOverrides["systems"]> = {};

    // Trust per-system dirty state: if the user touched a system, persist its
    // current lead + items + included flag verbatim. Trying to diff against
    // the auto baseline is too brittle (whitespace, item-list ordering, blur
    // trims) and silently dropped real edits.
    for (const sys of systems) {
      if (!sys.isDirty && sys.included === true) continue;
      const entry: { included?: boolean; lead?: string; items?: string[] } = {};
      if (sys.included !== true) entry.included = sys.included;
      if (sys.isDirty) {
        entry.lead = sys.lead;
        entry.items = sys.items;
      }
      sysOverrides[sys.id] = entry;
    }

    if (Object.keys(sysOverrides).length > 0) ov.systems = sysOverrides;
    if (hideHardExclusion) ov.hideHardExclusion = true;

    return Object.keys(ov).length > 0 ? ov : null;
  }

  async function save() {
    setSaving(true);
    const overrides = buildOverrides();
    const { data, error } = await supabase
      .from("quotes")
      .update({ scope_overrides: overrides })
      .eq("id", quoteId)
      .select("id")
      .maybeSingle();
    setSaving(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    if (!data) {
      toast("Save returned no rows — your session may have expired. Try reloading.", "error");
      return;
    }
    toast(overrides ? "Scope overrides saved" : "Reverted to auto-generated scope");
    onClose();
    router.refresh();
  }

  async function clearAll() {
    if (!confirm("Clear all overrides and revert to the auto-generated scope?")) return;
    setSaving(true);
    const { error } = await supabase
      .from("quotes")
      .update({ scope_overrides: null })
      .eq("id", quoteId);
    setSaving(false);
    if (error) {
      toast(error.message, "error");
    } else {
      toast("Reverted to auto-generated scope");
      onClose();
      router.refresh();
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[920px] max-h-[92vh] overflow-hidden rounded-xl bg-background border border-border shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Edit Scope of Works</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {readOnly ? "Read-only — quote is not in draft" : "Tweaks save on this quote only. The auto-generated baseline still tracks BOM changes."}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {systems.length === 0 && (
            <p className="text-sm text-muted-foreground italic text-center py-12">
              No systems on this quote — add items to the BOM to populate the scope.
            </p>
          )}

          {systems.map((sys) => (
            <div
              key={sys.id}
              className={`rounded-lg border ${sys.included ? "border-border bg-card" : "border-dashed border-border bg-muted/20 opacity-70"}`}
            >
              {/* System head */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={sys.included}
                    onChange={(e) => patchSystem(sys.id, { included: e.target.checked })}
                    disabled={readOnly}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-foreground text-[11px] font-bold text-background">
                    {sys.iconLabel}
                  </span>
                  <span className="text-sm font-semibold text-foreground">{sys.name}</span>
                  {sys.countSummary && (
                    <span className="text-[11px] font-mono text-muted-foreground">{sys.countSummary}</span>
                  )}
                  {sys.isDirty && (
                    <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400">Edited</span>
                  )}
                </div>
                {!readOnly && sys.isDirty && (
                  <button
                    onClick={() => revertSystem(sys.id)}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Revert
                  </button>
                )}
              </div>

              {/* Body */}
              {sys.included && (
                <div className="p-4 space-y-3">
                  <div>
                    <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
                      Lead paragraph
                    </label>
                    <textarea
                      value={sys.lead}
                      onChange={(e) => patchSystem(sys.id, { lead: e.target.value })}
                      readOnly={readOnly}
                      rows={2}
                      className="w-full rounded-md border border-border bg-input px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
                      Items (one per line)
                    </label>
                    <textarea
                      value={sys.items.join("\n")}
                      onChange={(e) => patchSystem(sys.id, { items: e.target.value.split("\n").filter((l) => l.trim().length > 0 || true) })}
                      onBlur={(e) => patchSystem(sys.id, { items: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean) })}
                      readOnly={readOnly}
                      rows={Math.max(3, sys.items.length + 1)}
                      placeholder="One bullet per line. Use <strong>...</strong> for bold."
                      className="w-full rounded-md border border-border bg-input px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Hard exclusion toggle */}
          {auto.hardExclusion && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t border-border mt-4">
              <input
                type="checkbox"
                checked={hideHardExclusion}
                onChange={(e) => setHideHardExclusion(e.target.checked)}
                disabled={readOnly}
                className="h-4 w-4 rounded accent-primary"
              />
              Hide the "ALL ELECTRICAL WORKS NOT INCLUDED" banner on this quote
            </label>
          )}
        </div>

        {/* Footer */}
        {!readOnly && (
          <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4 bg-muted/30">
            <button
              onClick={clearAll}
              disabled={saving}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
            >
              Clear all overrides
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                disabled={saving}
                className="rounded-md border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="rounded-md bg-primary px-5 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving..." : "Save scope"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
