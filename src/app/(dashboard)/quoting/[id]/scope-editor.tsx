"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import {
  generateScopeOfWorks,
  type ScopeItem,
  type ScopeOverrides,
  type SiteInfo,
} from "@/lib/quote-engine";

interface Props {
  quoteId: string;
  status: string;
  deviceCounts: Record<string, number>;
  siteInfo: SiteInfo;
  initialOverrides: ScopeOverrides | null;
  onClose: () => void;
}

type SectionKey = "rough_in" | "fit_off" | "notes";

const SECTION_LABEL: Record<SectionKey, string> = {
  rough_in: "Rough In",
  fit_off: "Fit Off",
  notes: "Please Note",
};

function genCustomId(): string {
  return `custom_${Math.random().toString(36).slice(2, 10)}`;
}

function computeOverrides(
  roughIn: ScopeItem[],
  fitOff: ScopeItem[],
  notes: ScopeItem[],
): ScopeOverrides | null {
  const overrides: ScopeOverrides = {};
  const sections: Record<SectionKey, ScopeItem[]> = {
    rough_in: roughIn,
    fit_off: fitOff,
    notes,
  };

  for (const [key, items] of Object.entries(sections) as [SectionKey, ScopeItem[]][]) {
    const map: Record<string, { included?: boolean; text?: string }> = {};
    const customs: Array<{ id: string; text: string }> = [];

    for (const item of items) {
      if (item.isCustom) {
        if (item.text.trim()) {
          customs.push({ id: item.id, text: item.text });
        }
        continue;
      }

      const diff: { included?: boolean; text?: string } = {};
      if (item.included !== (item.autoIncluded ?? true)) diff.included = item.included;
      if (item.text !== (item.autoText ?? "")) diff.text = item.text;
      if (Object.keys(diff).length > 0) map[item.id] = diff;
    }

    if (Object.keys(map).length > 0) overrides[key] = map;
    if (customs.length > 0) {
      overrides.custom = overrides.custom ?? {};
      overrides.custom[key] = customs;
    }
  }

  const hasAny =
    overrides.rough_in ||
    overrides.fit_off ||
    overrides.notes ||
    (overrides.custom && Object.keys(overrides.custom).length > 0);

  return hasAny ? overrides : null;
}

export function ScopeEditor({
  quoteId, status, deviceCounts, siteInfo, initialOverrides, onClose,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const readOnly = status !== "draft";

  // Seed state from generator (auto + initial overrides applied)
  const initial = useMemo(
    () => generateScopeOfWorks(deviceCounts, siteInfo, initialOverrides ?? undefined),
    [deviceCounts, siteInfo, initialOverrides],
  );

  const [roughIn, setRoughIn] = useState<ScopeItem[]>(initial.sections[0].items);
  const [fitOff, setFitOff] = useState<ScopeItem[]>(initial.sections[1].items);
  const [notes, setNotes] = useState<ScopeItem[]>(initial.notes);
  const [saving, setSaving] = useState(false);

  function updateItem(
    section: SectionKey,
    id: string,
    patch: Partial<ScopeItem>,
  ) {
    const set = section === "rough_in" ? setRoughIn : section === "fit_off" ? setFitOff : setNotes;
    set((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function revertItem(section: SectionKey, id: string) {
    const set = section === "rough_in" ? setRoughIn : section === "fit_off" ? setFitOff : setNotes;
    set((prev) =>
      prev.map((i) =>
        i.id === id && !i.isCustom
          ? { ...i, text: i.autoText ?? i.text, included: i.autoIncluded ?? true }
          : i,
      ),
    );
  }

  function addCustom(section: SectionKey) {
    const newItem: ScopeItem = {
      id: genCustomId(),
      text: "",
      included: true,
      isCustom: true,
    };
    const set = section === "rough_in" ? setRoughIn : section === "fit_off" ? setFitOff : setNotes;
    set((prev) => [...prev, newItem]);
  }

  function removeCustom(section: SectionKey, id: string) {
    const set = section === "rough_in" ? setRoughIn : section === "fit_off" ? setFitOff : setNotes;
    set((prev) => prev.filter((i) => i.id !== id));
  }

  async function handleSave() {
    setSaving(true);
    const overrides = computeOverrides(roughIn, fitOff, notes);
    const { error } = await supabase
      .from("quotes")
      .update({ scope_overrides: overrides })
      .eq("id", quoteId);
    if (error) {
      toast(error.message, "error");
      setSaving(false);
      return;
    }
    toast(overrides ? "Scope of Works saved" : "Scope reset to auto");
    setSaving(false);
    router.refresh();
    onClose();
  }

  async function handleResetAll() {
    if (!confirm("Reset all Scope of Works customisations back to auto-generated? This can't be undone once saved.")) return;
    setSaving(true);
    const { error } = await supabase
      .from("quotes")
      .update({ scope_overrides: null })
      .eq("id", quoteId);
    if (error) {
      toast(error.message, "error");
      setSaving(false);
      return;
    }
    toast("Scope reset to auto");
    setSaving(false);
    router.refresh();
    onClose();
  }

  function renderSection(key: SectionKey, items: ScopeItem[]) {
    return (
      <div key={key} className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {SECTION_LABEL[key]}
          </h3>
          {!readOnly && (
            <button
              onClick={() => addCustom(key)}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              + Add custom clause
            </button>
          )}
        </div>
        <div className="space-y-2">
          {items.map((item) => {
            const isDirty = !item.isCustom && (
              item.text !== (item.autoText ?? "") ||
              item.included !== (item.autoIncluded ?? true)
            );
            return (
              <div
                key={item.id}
                className={`rounded-lg border p-3 transition-colors ${
                  !item.included
                    ? "border-border/50 bg-muted/30 opacity-60"
                    : isDirty
                    ? "border-amber-500/40 bg-amber-500/5"
                    : item.isCustom
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Include toggle */}
                  <label className="flex items-center pt-2 shrink-0">
                    <input
                      type="checkbox"
                      checked={item.included}
                      disabled={readOnly}
                      onChange={(e) => updateItem(key, item.id, { included: e.target.checked })}
                      className="h-4 w-4 rounded border-border"
                    />
                  </label>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    {readOnly ? (
                      <p className={`text-xs leading-relaxed ${item.included ? "text-foreground" : "text-muted-foreground line-through"}`}>
                        {item.text || <span className="italic text-muted-foreground">empty clause</span>}
                      </p>
                    ) : (
                      <textarea
                        value={item.text}
                        onChange={(e) => updateItem(key, item.id, { text: e.target.value })}
                        placeholder={item.isCustom ? "Custom clause text…" : ""}
                        rows={Math.max(2, Math.ceil(item.text.length / 90))}
                        className="w-full resize-none rounded-md border border-border bg-input px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                    )}

                    {/* Meta row */}
                    <div className="flex items-center justify-between mt-1.5">
                      <div className="flex items-center gap-2">
                        {item.isCustom && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-medium text-primary uppercase tracking-wide">
                            Custom
                          </span>
                        )}
                        {isDirty && (
                          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-400 uppercase tracking-wide">
                            Edited
                          </span>
                        )}
                        {!item.isCustom && !item.autoIncluded && item.included && (
                          <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[9px] font-medium text-blue-400 uppercase tracking-wide">
                            Manually included
                          </span>
                        )}
                        {!item.isCustom && item.autoIncluded && !item.included && (
                          <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[9px] font-medium text-red-400 uppercase tracking-wide">
                            Manually excluded
                          </span>
                        )}
                      </div>
                      {!readOnly && (
                        <div className="flex items-center gap-1">
                          {isDirty && (
                            <button
                              onClick={() => revertItem(key, item.id)}
                              className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                            >
                              Revert
                            </button>
                          )}
                          {item.isCustom && (
                            <button
                              onClick={() => removeCustom(key, item.id)}
                              className="text-[10px] text-red-400/70 hover:text-red-400 underline underline-offset-2"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {items.length === 0 && (
            <p className="text-[11px] text-muted-foreground italic py-2">No clauses in this section.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-[860px] max-h-[90vh] overflow-hidden rounded-xl bg-background border border-border shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Scope of Works</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {readOnly
                ? `Read-only — quote is ${status}`
                : "Edit, exclude, or add custom clauses. Auto clauses are regenerated from the BOM; your changes persist until reset."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18" /><path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {renderSection("rough_in", roughIn)}
          {renderSection("fit_off", fitOff)}
          {renderSection("notes", notes)}
        </div>

        {/* Footer */}
        {!readOnly && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3 bg-muted/30">
            <button
              onClick={handleResetAll}
              disabled={saving}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
            >
              Reset all to auto
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                disabled={saving}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
