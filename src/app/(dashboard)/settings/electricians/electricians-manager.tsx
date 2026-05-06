"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";

const AU_STATES = ["QLD", "NSW", "VIC", "SA", "WA", "TAS", "NT", "ACT"] as const;
type AuState = (typeof AU_STATES)[number];

interface Row {
  state: string;
  contact_name: string | null;
  email: string;
  phone: string | null;
  notes: string | null;
  updated_at?: string;
}

export function ElectriciansManager({ initial }: { initial: Row[] }) {
  const supabase = createClient();
  const { toast } = useToast();

  // Hydrate every state with a row so the UI is a complete grid; missing
  // rows are blanks until the user types into them.
  const [rows, setRows] = useState<Record<AuState, Row>>(() => {
    const seeded: Partial<Record<AuState, Row>> = {};
    for (const state of AU_STATES) {
      const existing = initial.find((r) => r.state === state);
      seeded[state] = existing ?? { state, contact_name: "", email: "", phone: "", notes: "" };
    }
    return seeded as Record<AuState, Row>;
  });
  const [savingState, setSavingState] = useState<AuState | null>(null);

  const initialByState = useMemo(() => {
    const m: Partial<Record<AuState, Row>> = {};
    for (const r of initial) m[r.state as AuState] = r;
    return m;
  }, [initial]);

  function update(state: AuState, patch: Partial<Row>) {
    setRows((prev) => ({ ...prev, [state]: { ...prev[state], ...patch } }));
  }

  function isDirty(state: AuState): boolean {
    const cur = rows[state];
    const orig = initialByState[state];
    if (!orig) return Boolean(cur.email || cur.contact_name || cur.phone || cur.notes);
    return (
      (cur.email ?? "") !== (orig.email ?? "") ||
      (cur.contact_name ?? "") !== (orig.contact_name ?? "") ||
      (cur.phone ?? "") !== (orig.phone ?? "") ||
      (cur.notes ?? "") !== (orig.notes ?? "")
    );
  }

  async function save(state: AuState) {
    const cur = rows[state];
    const email = (cur.email ?? "").trim();
    if (!email) {
      toast(`${state}: enter an email before saving`, "error");
      return;
    }
    setSavingState(state);
    const { error } = await supabase
      .from("state_electricians")
      .upsert({
        state,
        contact_name: (cur.contact_name ?? "").trim() || null,
        email,
        phone: (cur.phone ?? "").trim() || null,
        notes: (cur.notes ?? "").trim() || null,
        updated_at: new Date().toISOString(),
      });
    setSavingState(null);
    if (error) {
      toast(`${state}: ${error.message}`, "error");
      return;
    }
    toast(`${state} electrician saved`);
  }

  async function clear(state: AuState) {
    if (!initialByState[state]) {
      // nothing to delete; just blank the form
      update(state, { contact_name: "", email: "", phone: "", notes: "" });
      return;
    }
    if (!window.confirm(`Remove the electrician contact for ${state}? Plan-quote emails for ${state} jobs will fail until you set one again.`)) return;
    setSavingState(state);
    const { error } = await supabase.from("state_electricians").delete().eq("state", state);
    setSavingState(null);
    if (error) {
      toast(`${state}: ${error.message}`, "error");
      return;
    }
    update(state, { contact_name: "", email: "", phone: "", notes: "" });
    toast(`${state} electrician removed`);
  }

  return (
    <div className="space-y-3">
      {AU_STATES.map((state) => {
        const cur = rows[state];
        const dirty = isDirty(state);
        return (
          <div key={state} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-3 mb-3">
              <span className="inline-flex items-center justify-center min-w-[44px] px-2 py-0.5 bg-primary/10 text-primary rounded text-xs font-bold uppercase">
                {state}
              </span>
              <span className="text-xs text-muted-foreground">
                {cur.email ? `Saved → ${cur.email}` : "No electrician set"}
              </span>
              {dirty && (
                <span className="ml-auto text-[10px] uppercase tracking-wide text-amber-400 font-medium">unsaved</span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Contact name">
                <input
                  type="text"
                  value={cur.contact_name ?? ""}
                  onChange={(e) => update(state, { contact_name: e.target.value })}
                  placeholder="e.g. John Sparky"
                  className={inputCls}
                />
              </Field>
              <Field label="Email *">
                <input
                  type="email"
                  value={cur.email ?? ""}
                  onChange={(e) => update(state, { email: e.target.value })}
                  placeholder="electrician@example.com.au"
                  className={inputCls}
                />
              </Field>
              <Field label="Phone">
                <input
                  type="tel"
                  value={cur.phone ?? ""}
                  onChange={(e) => update(state, { phone: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Notes">
                <input
                  type="text"
                  value={cur.notes ?? ""}
                  onChange={(e) => update(state, { notes: e.target.value })}
                  placeholder="optional"
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => clear(state)}
                disabled={savingState === state || (!cur.email && !cur.contact_name)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-red-400 hover:border-red-500/40 disabled:opacity-30 transition-colors"
              >
                Remove
              </button>
              <button
                type="button"
                onClick={() => save(state)}
                disabled={savingState === state || !dirty}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-30 transition-colors"
              >
                {savingState === state ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const inputCls =
  "w-full h-9 rounded-md border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  );
}
