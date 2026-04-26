"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

interface LabourTiming {
  id: string;
  code: string;
  name: string;
  minutes_per: number;
  category: string;
  sort_order: number;
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function LabourTimingsManager({ timings: initial }: { timings: LabourTiming[] }) {
  const [timings, setTimings] = useState(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();

  async function updateTiming(id: string, minutes: number) {
    if (minutes < 1 || minutes > 999) return;
    setSaving(id);
    const { error } = await supabase
      .from("labour_timings")
      .update({ minutes_per: minutes, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast(error.message, "error");
    } else {
      setTimings((prev) => prev.map((t) => (t.id === id ? { ...t, minutes_per: minutes } : t)));
      toast("Timing updated");
    }
    setSaving(null);
  }

  async function deleteTiming(t: LabourTiming) {
    if (!confirm(`Delete "${t.name}"?\n\nIf the labour engine has a hardcoded fallback for code "${t.code}", quotes will revert to that default. Otherwise this row had no effect anyway.`)) return;
    setDeletingId(t.id);
    const { error } = await supabase.from("labour_timings").delete().eq("id", t.id);
    if (error) {
      toast(error.message, "error");
    } else {
      setTimings((prev) => prev.filter((x) => x.id !== t.id));
      toast(`Deleted ${t.name}`);
    }
    setDeletingId(null);
  }

  async function addTiming(payload: { code: string; name: string; minutes_per: number }) {
    const nextSort = timings.reduce((max, t) => Math.max(max, t.sort_order), 0) + 1;
    const { data, error } = await supabase
      .from("labour_timings")
      .insert({
        code: payload.code,
        name: payload.name,
        minutes_per: payload.minutes_per,
        category: "fit_off",
        sort_order: nextSort,
      })
      .select("*")
      .single();
    if (error) {
      toast(error.message, "error");
      return false;
    }
    setTimings((prev) => [...prev, data as LabourTiming]);
    setAdding(false);
    toast(`Added ${payload.name}`);
    router.refresh();
    return true;
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <p className="text-sm text-muted-foreground">
          Fit-off labour timings used when generating quotes. Changes apply to new quotes only.
          New rows only affect quotes if the labour engine has a handler for their <code className="font-mono text-xs">code</code>.
        </p>
        <button
          onClick={() => setAdding(true)}
          disabled={adding}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0"
        >
          + New timing
        </button>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-accent/30">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Device</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden md:table-cell">Code</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground w-32">Minutes</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground w-24">Hours</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground w-20"></th>
            </tr>
          </thead>
          <tbody>
            {adding && (
              <AddRow
                existingCodes={timings.map((t) => t.code)}
                onCancel={() => setAdding(false)}
                onSave={addTiming}
              />
            )}
            {timings.map((t) => (
              <tr key={t.id} className="border-b border-border last:border-b-0 hover:bg-accent/20 transition-colors">
                <td className="px-4 py-2.5 text-foreground">{t.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground hidden md:table-cell">{t.code}</td>
                <td className="px-4 py-2.5 text-right">
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={t.minutes_per}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      if (!isNaN(v)) setTimings((prev) => prev.map((x) => (x.id === t.id ? { ...x, minutes_per: v } : x)));
                    }}
                    onBlur={(e) => {
                      const v = parseInt(e.target.value);
                      if (!isNaN(v) && v !== initial.find((x) => x.id === t.id)?.minutes_per) {
                        updateTiming(t.id, v);
                      }
                    }}
                    disabled={saving === t.id}
                    className="w-20 text-right bg-background border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                  />
                </td>
                <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">
                  {(t.minutes_per / 60).toFixed(2)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => deleteTiming(t)}
                    disabled={deletingId === t.id}
                    className="text-[11px] text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                  >
                    {deletingId === t.id ? "…" : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddRow({
  existingCodes,
  onCancel,
  onSave,
}: {
  existingCodes: string[];
  onCancel: () => void;
  onSave: (payload: { code: string; name: string; minutes_per: number }) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeDirty, setCodeDirty] = useState(false);
  const [minutes, setMinutes] = useState("30");
  const [busy, setBusy] = useState(false);

  function onNameChange(v: string) {
    setName(v);
    if (!codeDirty) setCode(slugify(v));
  }

  async function submit() {
    const trimmedName = name.trim();
    const finalCode = (code.trim() || slugify(trimmedName));
    const mins = parseInt(minutes);
    if (!trimmedName) return;
    if (!finalCode) return;
    if (isNaN(mins) || mins < 1 || mins > 999) return;
    if (existingCodes.includes(finalCode)) {
      alert(`Code "${finalCode}" already exists. Pick a different code or edit the existing row.`);
      return;
    }
    setBusy(true);
    const ok = await onSave({ code: finalCode, name: trimmedName, minutes_per: mins });
    setBusy(false);
    if (!ok) return;
  }

  return (
    <tr className="border-b border-border bg-primary/5">
      <td className="px-4 py-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Display name (e.g. Boom gate)"
          className="w-full bg-background border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </td>
      <td className="px-4 py-2 hidden md:table-cell">
        <input
          value={code}
          onChange={(e) => { setCode(e.target.value); setCodeDirty(true); }}
          placeholder="snake_case_code"
          className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </td>
      <td className="px-4 py-2 text-right">
        <input
          type="number"
          min={1}
          max={999}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          className="w-20 text-right bg-background border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </td>
      <td className="px-4 py-2 text-right text-muted-foreground tabular-nums text-xs">
        {(parseInt(minutes) / 60 || 0).toFixed(2)}
      </td>
      <td className="px-4 py-2 text-right">
        <div className="inline-flex gap-2">
          <button
            onClick={submit}
            disabled={busy || !name.trim()}
            className="text-[11px] font-semibold text-primary hover:text-primary/80 disabled:opacity-50 transition-colors"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}
