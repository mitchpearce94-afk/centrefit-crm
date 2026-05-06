"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";

const AU_STATES = ["QLD", "NSW", "VIC", "SA", "WA", "TAS", "NT", "ACT"] as const;
type AuState = (typeof AU_STATES)[number];

interface Row {
  state: string;
  company_name: string | null;
  contact_name: string | null;
  email: string;
  phone: string | null;
  notes: string | null;
  updated_at?: string;
}

function emptyRow(state: AuState): Row {
  return { state, company_name: "", contact_name: "", email: "", phone: "", notes: "" };
}

function rowsEqual(a: Row, b: Row): boolean {
  return (
    (a.email ?? "") === (b.email ?? "") &&
    (a.company_name ?? "") === (b.company_name ?? "") &&
    (a.contact_name ?? "") === (b.contact_name ?? "") &&
    (a.phone ?? "") === (b.phone ?? "") &&
    (a.notes ?? "") === (b.notes ?? "")
  );
}

export function ElectriciansManager({ initial }: { initial: Row[] }) {
  const supabase = createClient();
  const { toast } = useToast();

  // The form values being edited.
  const [rows, setRows] = useState<Record<AuState, Row>>(() => {
    const seeded: Partial<Record<AuState, Row>> = {};
    for (const state of AU_STATES) {
      const existing = initial.find((r) => r.state === state);
      seeded[state] = existing ?? emptyRow(state);
    }
    return seeded as Record<AuState, Row>;
  });

  // The last-saved snapshot, mirrors what's actually in the DB. Updated on
  // every successful save so the "unsaved" indicator clears immediately
  // (the previous version compared against the immutable initial prop, so
  // the badge stuck around forever after the first save).
  const [saved, setSaved] = useState<Record<AuState, Row | null>>(() => {
    const m: Partial<Record<AuState, Row | null>> = {};
    for (const state of AU_STATES) {
      const existing = initial.find((r) => r.state === state);
      m[state] = existing ?? null;
    }
    return m as Record<AuState, Row | null>;
  });

  const [savingState, setSavingState] = useState<AuState | null>(null);

  function update(state: AuState, patch: Partial<Row>) {
    setRows((prev) => ({ ...prev, [state]: { ...prev[state], ...patch } }));
  }

  function isDirty(state: AuState): boolean {
    const cur = rows[state];
    const baseline = saved[state];
    if (!baseline) {
      return Boolean(cur.email || cur.contact_name || cur.company_name || cur.phone || cur.notes);
    }
    return !rowsEqual(cur, baseline);
  }

  async function save(state: AuState) {
    const cur = rows[state];
    const email = (cur.email ?? "").trim();
    if (!email) {
      toast(`${state}: enter an email before saving`, "error");
      return;
    }
    setSavingState(state);
    const payload = {
      state,
      company_name: (cur.company_name ?? "").trim() || null,
      contact_name: (cur.contact_name ?? "").trim() || null,
      email,
      phone: (cur.phone ?? "").trim() || null,
      notes: (cur.notes ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("state_electricians").upsert(payload);
    setSavingState(null);
    if (error) {
      toast(`${state}: ${error.message}`, "error");
      return;
    }
    // Sync the form values into the saved baseline so isDirty clears.
    const newBaseline: Row = { ...payload };
    setSaved((prev) => ({ ...prev, [state]: newBaseline }));
    setRows((prev) => ({ ...prev, [state]: { ...newBaseline } }));
    toast(`${state} electrician saved`);
  }

  async function clear(state: AuState) {
    if (!saved[state]) {
      // Nothing in the DB; just blank the form locally.
      setRows((prev) => ({ ...prev, [state]: emptyRow(state) }));
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
    setRows((prev) => ({ ...prev, [state]: emptyRow(state) }));
    setSaved((prev) => ({ ...prev, [state]: null }));
    toast(`${state} electrician removed`);
  }

  return (
    <div className="space-y-3">
      {AU_STATES.map((state) => {
        const cur = rows[state];
        const dirty = isDirty(state);
        const baseline = saved[state];
        return (
          <div key={state} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-3 mb-3">
              <span className="inline-flex items-center justify-center min-w-[44px] px-2 py-0.5 bg-primary/10 text-primary rounded text-xs font-bold uppercase">
                {state}
              </span>
              <span className="text-xs text-muted-foreground">
                {baseline?.email
                  ? `Saved → ${[baseline.company_name, baseline.contact_name, baseline.email].filter(Boolean).join(" · ")}`
                  : "No electrician set"}
              </span>
              {dirty && (
                <span className="ml-auto text-[10px] uppercase tracking-wide text-amber-400 font-medium">unsaved</span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Company name">
                <input
                  type="text"
                  value={cur.company_name ?? ""}
                  onChange={(e) => update(state, { company_name: e.target.value })}
                  placeholder="e.g. Sparky & Sons Pty Ltd"
                  className={inputCls}
                />
              </Field>
              <Field label="Contact name">
                <input
                  type="text"
                  value={cur.contact_name ?? ""}
                  onChange={(e) => update(state, { contact_name: e.target.value })}
                  placeholder="e.g. John Smith"
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
              <Field label="Notes" wide>
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
                disabled={savingState === state || (!cur.email && !cur.contact_name && !cur.company_name)}
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

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? "md:col-span-2" : ""}`}>
      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  );
}
