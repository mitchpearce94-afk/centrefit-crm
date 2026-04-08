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

export function LabourTimingsManager({ timings: initial }: { timings: LabourTiming[] }) {
  const [timings, setTimings] = useState(initial);
  const [saving, setSaving] = useState<string | null>(null);
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

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Fit-off labour timings used when generating quotes. Changes apply to new quotes only.
      </p>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-accent/30">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Device</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground w-32">Minutes</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground w-24">Hours</th>
            </tr>
          </thead>
          <tbody>
            {timings.map((t) => (
              <tr key={t.id} className="border-b border-border last:border-b-0 hover:bg-accent/20 transition-colors">
                <td className="px-4 py-2.5 text-foreground">{t.name}</td>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
