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
  type ScopeByOthersBlock,
  type ScopeOngoingCost,
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

interface ByOthersEdit extends ScopeByOthersBlock {
  /** True when the items list has been edited away from the auto state. */
  isDirty?: boolean;
}

interface ListBlockEdit {
  /** True when the block (assumptions / standards) is included on this quote. */
  included: boolean;
  /** Current bullet list — auto-generated or user-edited. */
  items: string[];
  /** True when the items have been edited away from the auto baseline. */
  isDirty: boolean;
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

  // "By Others" blocks (electrician, locksmith). Auto always emits them as
  // included; an override can flip `included` to false or replace the items list.
  const seedByOthers: ByOthersEdit[] = useMemo(() => {
    const includedIds = new Set(initial.byOthers.map((b) => b.id));
    return auto.byOthers.map((autoBlk) => {
      const applied = initial.byOthers.find((b) => b.id === autoBlk.id);
      return {
        ...(applied ?? autoBlk),
        included: includedIds.has(autoBlk.id),
        isDirty: !!applied && JSON.stringify(applied.items) !== JSON.stringify(autoBlk.items),
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [byOthers, setByOthers] = useState<ByOthersEdit[]>(seedByOthers);

  // Assumptions block — single list, auto-generated. Override hides it or replaces items.
  const [assumptions, setAssumptions] = useState<ListBlockEdit>(() => ({
    included: initialOverrides?.assumptions?.included !== false,
    items: initialOverrides?.assumptions?.items ?? auto.assumptions,
    isDirty: Array.isArray(initialOverrides?.assumptions?.items)
      && JSON.stringify(initialOverrides!.assumptions!.items) !== JSON.stringify(auto.assumptions),
  }));

  // Standards block — same shape as assumptions.
  const [standards, setStandards] = useState<ListBlockEdit>(() => ({
    included: initialOverrides?.standards?.included !== false,
    items: initialOverrides?.standards?.items ?? auto.standards,
    isDirty: Array.isArray(initialOverrides?.standards?.items)
      && JSON.stringify(initialOverrides!.standards!.items) !== JSON.stringify(auto.standards),
  }));

  // Ongoing costs — derived per BOM. Override only flips `included` per row.
  const seedOngoing: ScopeOngoingCost[] = useMemo(() => {
    const includedIds = new Set(initial.ongoingCosts.map((c) => c.id));
    return auto.ongoingCosts.map((c) => ({ ...c, included: includedIds.has(c.id) }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [ongoingCosts, setOngoingCosts] = useState<ScopeOngoingCost[]>(seedOngoing);

  const [hideHardExclusion, setHideHardExclusion] = useState(!!initialOverrides?.hideHardExclusion);
  const [summaryLead, setSummaryLead] = useState<string>(
    initialOverrides?.summaryLead ?? auto.summary.lead,
  );
  const [summaryLeadDirty, setSummaryLeadDirty] = useState(
    typeof initialOverrides?.summaryLead === "string" &&
      initialOverrides.summaryLead !== auto.summary.lead,
  );
  const [saving, setSaving] = useState(false);

  function patchSummaryLead(v: string) {
    setSummaryLead(v);
    setSummaryLeadDirty(true);
  }
  function revertSummaryLead() {
    setSummaryLead(auto.summary.lead);
    setSummaryLeadDirty(false);
  }

  function patchSystem(id: string, patch: Partial<SystemEdit>) {
    setSystems((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch, isDirty: true } : s)));
  }

  function toggleByOthers(id: string, included: boolean) {
    setByOthers((prev) => prev.map((b) => (b.id === id ? { ...b, included } : b)));
  }

  function patchByOthersItems(id: string, items: string[]) {
    setByOthers((prev) => prev.map((b) => (b.id === id ? { ...b, items, isDirty: true } : b)));
  }

  function revertByOthers(id: string) {
    const autoBlk = auto.byOthers.find((b) => b.id === id);
    if (!autoBlk) return;
    setByOthers((prev) =>
      prev.map((b) => (b.id === id ? { ...autoBlk, included: true, isDirty: false } : b)),
    );
  }

  function toggleOngoingCost(id: string, included: boolean) {
    setOngoingCosts((prev) => prev.map((c) => (c.id === id ? { ...c, included } : c)));
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

    // Persist "By Others" blocks the user has excluded or whose items they edited.
    const byOthersOverrides: NonNullable<ScopeOverrides["byOthers"]> = {};
    for (const b of byOthers) {
      if (!b.included || b.isDirty) {
        const entry: { included?: boolean; items?: string[] } = {};
        if (!b.included) entry.included = false;
        if (b.isDirty) entry.items = b.items;
        byOthersOverrides[b.id] = entry;
      }
    }
    if (Object.keys(byOthersOverrides).length > 0) ov.byOthers = byOthersOverrides;

    // Ongoing costs — only persist exclusions.
    const ongoingOverrides: NonNullable<ScopeOverrides["ongoingCosts"]> = {};
    for (const c of ongoingCosts) {
      if (!c.included) ongoingOverrides[c.id] = { included: false };
    }
    if (Object.keys(ongoingOverrides).length > 0) ov.ongoingCosts = ongoingOverrides;

    // Assumptions / Standards — persist exclusions and item edits.
    if (!assumptions.included || assumptions.isDirty) {
      ov.assumptions = {};
      if (!assumptions.included) ov.assumptions.included = false;
      if (assumptions.isDirty) ov.assumptions.items = assumptions.items;
    }
    if (!standards.included || standards.isDirty) {
      ov.standards = {};
      if (!standards.included) ov.standards.included = false;
      if (standards.isDirty) ov.standards.items = standards.items;
    }

    if (hideHardExclusion) ov.hideHardExclusion = true;
    if (summaryLeadDirty) ov.summaryLead = summaryLead;

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
          {/* Summary lead — the intro paragraph at the top of the SoW / PDF */}
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-foreground text-[11px] font-bold text-background">¶</span>
                <span className="text-sm font-semibold text-foreground">Intro paragraph</span>
                <span className="text-[11px] text-muted-foreground">— top of the quote PDF</span>
                {summaryLeadDirty && (
                  <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400">Edited</span>
                )}
              </div>
              {!readOnly && summaryLeadDirty && (
                <button
                  onClick={revertSummaryLead}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Revert
                </button>
              )}
            </div>
            <div className="p-4">
              <textarea
                value={summaryLead}
                onChange={(e) => patchSummaryLead(e.target.value)}
                readOnly={readOnly}
                rows={4}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

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

          {/* By Others blocks (electrician / locksmith) — include/exclude + edit items */}
          {byOthers.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5">
              <div className="px-4 py-2.5 border-b border-amber-500/20">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">By Others</span>
                <span className="text-[11px] text-muted-foreground ml-2">— work the engine flags as someone else's responsibility. Untick to remove from the quote, or edit the items below.</span>
              </div>
              <div className="p-4 space-y-3">
                {byOthers.map((blk) => (
                  <div
                    key={blk.id}
                    className={`rounded-md border ${blk.included ? "border-amber-500/30 bg-amber-500/5" : "border-dashed border-border bg-muted/20 opacity-70"}`}
                  >
                    <div className="flex items-center justify-between px-3 py-2 border-b border-amber-500/20">
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={blk.included}
                          onChange={(e) => toggleByOthers(blk.id, e.target.checked)}
                          disabled={readOnly}
                          className="h-4 w-4 rounded accent-primary"
                        />
                        <span className="text-sm font-semibold text-foreground">{blk.name}</span>
                        {!blk.included && (
                          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400">Excluded</span>
                        )}
                        {blk.isDirty && blk.included && (
                          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400">Edited</span>
                        )}
                      </label>
                      {!readOnly && (blk.isDirty || !blk.included) && (
                        <button
                          onClick={() => revertByOthers(blk.id)}
                          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Revert
                        </button>
                      )}
                    </div>
                    {blk.included && (
                      <div className="p-3">
                        <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
                          Items (one per line)
                        </label>
                        <textarea
                          value={blk.items.join("\n")}
                          onChange={(e) => patchByOthersItems(blk.id, e.target.value.split("\n").filter((l) => l.trim().length > 0 || true))}
                          onBlur={(e) => patchByOthersItems(blk.id, e.target.value.split("\n").map((l) => l.trim()).filter(Boolean))}
                          readOnly={readOnly}
                          rows={Math.max(2, blk.items.length + 1)}
                          placeholder="One bullet per line. Use <strong>...</strong> for bold."
                          className="w-full rounded-md border border-border bg-input px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ongoing costs — toggle per row */}
          {auto.ongoingCosts.length > 0 && (
            <div className="rounded-lg border border-border bg-card">
              <div className="px-4 py-2.5 border-b border-border">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ongoing Costs</span>
                <span className="text-[11px] text-muted-foreground ml-2">— recurring charges shown on the quote. Untick to hide.</span>
              </div>
              <div className="p-3 space-y-1.5">
                {ongoingCosts.map((c) => (
                  <label
                    key={c.id}
                    className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent ${c.included ? "" : "opacity-60"}`}
                  >
                    <input
                      type="checkbox"
                      checked={c.included}
                      onChange={(e) => toggleOngoingCost(c.id, e.target.checked)}
                      disabled={readOnly}
                      className="h-4 w-4 rounded accent-primary"
                    />
                    <span className={`flex-1 text-xs ${c.included ? "text-foreground" : "text-muted-foreground line-through"}`}>{c.desc}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{c.price}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Assumptions block — toggle + edit items */}
          {auto.assumptions.length > 0 && (
            <div className={`rounded-lg border ${assumptions.included ? "border-border bg-card" : "border-dashed border-border bg-muted/20 opacity-70"}`}>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assumptions.included}
                    onChange={(e) => setAssumptions((prev) => ({ ...prev, included: e.target.checked }))}
                    disabled={readOnly}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  <span className="text-sm font-semibold text-foreground">Assumptions</span>
                  {!assumptions.included && (
                    <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400">Hidden</span>
                  )}
                  {assumptions.isDirty && assumptions.included && (
                    <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400">Edited</span>
                  )}
                </label>
                {!readOnly && (assumptions.isDirty || !assumptions.included) && (
                  <button
                    onClick={() => setAssumptions({ included: true, items: auto.assumptions, isDirty: false })}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Revert
                  </button>
                )}
              </div>
              {assumptions.included && (
                <div className="p-4">
                  <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
                    Items (one per line)
                  </label>
                  <textarea
                    value={assumptions.items.join("\n")}
                    onChange={(e) => setAssumptions((prev) => ({ ...prev, items: e.target.value.split("\n").filter((l) => l.trim().length > 0 || true), isDirty: true }))}
                    onBlur={(e) => setAssumptions((prev) => ({ ...prev, items: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean), isDirty: true }))}
                    readOnly={readOnly}
                    rows={Math.max(3, assumptions.items.length + 1)}
                    placeholder="One bullet per line."
                    className="w-full rounded-md border border-border bg-input px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                  />
                </div>
              )}
            </div>
          )}

          {/* Standards block — toggle + edit items */}
          {auto.standards.length > 0 && (
            <div className={`rounded-lg border ${standards.included ? "border-border bg-card" : "border-dashed border-border bg-muted/20 opacity-70"}`}>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={standards.included}
                    onChange={(e) => setStandards((prev) => ({ ...prev, included: e.target.checked }))}
                    disabled={readOnly}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  <span className="text-sm font-semibold text-foreground">Standards & Codes of Practice</span>
                  {!standards.included && (
                    <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400">Hidden</span>
                  )}
                  {standards.isDirty && standards.included && (
                    <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400">Edited</span>
                  )}
                </label>
                {!readOnly && (standards.isDirty || !standards.included) && (
                  <button
                    onClick={() => setStandards({ included: true, items: auto.standards, isDirty: false })}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Revert
                  </button>
                )}
              </div>
              {standards.included && (
                <div className="p-4">
                  <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
                    Items (one per line)
                  </label>
                  <textarea
                    value={standards.items.join("\n")}
                    onChange={(e) => setStandards((prev) => ({ ...prev, items: e.target.value.split("\n").filter((l) => l.trim().length > 0 || true), isDirty: true }))}
                    onBlur={(e) => setStandards((prev) => ({ ...prev, items: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean), isDirty: true }))}
                    readOnly={readOnly}
                    rows={Math.max(3, standards.items.length + 1)}
                    placeholder="One bullet per line."
                    className="w-full rounded-md border border-border bg-input px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                  />
                </div>
              )}
            </div>
          )}

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
