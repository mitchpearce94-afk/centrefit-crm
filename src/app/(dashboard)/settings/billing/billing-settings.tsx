"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

const inputClass = "block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

interface Settings {
  id: string;
  labour_cost_rate: number;
  labour_sell_rate: number;
  callout_fee_cost: number;
  callout_fee_sell: number;
  callout_hours: number;
  admin_rate_cost: number;
  admin_rate_sell: number;
  incidentals_cost: number;
  incidentals_sell: number;
  default_markup: number;
  gst_rate: number;
  quote_validity_days: number;
  uplift_percent: number;
  default_payment_terms: string;
  progress_payment_enabled: boolean;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 mb-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">{title}</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {children}
      </div>
    </div>
  );
}

function Field({ label, suffix, children }: { label: string; suffix?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <div className="relative">
        {children}
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{suffix}</span>}
      </div>
    </div>
  );
}

export function BillingSettings({ settings }: { settings: Settings | null }) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [s, setS] = useState<Settings>(settings ?? {
    id: "", labour_cost_rate: 75, labour_sell_rate: 150,
    callout_fee_cost: 80, callout_fee_sell: 80, callout_hours: 8,
    admin_rate_cost: 140, admin_rate_sell: 240,
    incidentals_cost: 200, incidentals_sell: 200,
    default_markup: 0.50, gst_rate: 0.10,
    quote_validity_days: 30, uplift_percent: 5,
    default_payment_terms: "Due on completion",
    progress_payment_enabled: true,
  });

  function set(field: keyof Settings, value: number | string | boolean) {
    setS(prev => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    const { id, ...payload } = s;
    const { error } = await supabase.from("billing_settings").update(payload).eq("id", id);
    if (error) toast(error.message, "error");
    else { toast("Billing settings saved"); router.refresh(); }
    setSaving(false);
  }

  const margin = s.labour_sell_rate > 0 ? ((s.labour_sell_rate - s.labour_cost_rate) / s.labour_sell_rate * 100).toFixed(0) : "0";

  return (
    <div>
      <Section title="Labour Rates">
        <Field label="Cost Rate (per hour)">
          <input type="number" step="0.01" value={s.labour_cost_rate} onChange={e => set("labour_cost_rate", parseFloat(e.target.value) || 0)} className={inputClass} />
        </Field>
        <Field label="Sell Rate (per hour)">
          <input type="number" step="0.01" value={s.labour_sell_rate} onChange={e => set("labour_sell_rate", parseFloat(e.target.value) || 0)} className={inputClass} />
        </Field>
        <Field label="Labour Margin">
          <div className={`${inputClass} bg-muted text-muted-foreground`}>{margin}%</div>
        </Field>
      </Section>

      {/* Callout, Admin, Incidentals removed — now variable per-quote items in the Other labour section */}

      <Section title="Markup & Tax">
        <Field label="Default Product Markup" suffix="%">
          <input type="number" step="1" value={Math.round(s.default_markup * 100)} onChange={e => set("default_markup", (parseInt(e.target.value) || 0) / 100)} className={inputClass} />
        </Field>
        <Field label="GST Rate" suffix="%">
          <input type="number" step="1" value={Math.round(s.gst_rate * 100)} onChange={e => set("gst_rate", (parseInt(e.target.value) || 0) / 100)} className={inputClass} />
        </Field>
        <Field label="Quote Uplift" suffix="%">
          <input type="number" step="0.5" value={s.uplift_percent} onChange={e => set("uplift_percent", parseFloat(e.target.value) || 0)} className={inputClass} />
        </Field>
      </Section>

      <Section title="Quote Settings">
        <Field label="Quote Validity (days)">
          <input type="number" value={s.quote_validity_days} onChange={e => set("quote_validity_days", parseInt(e.target.value) || 30)} className={inputClass} />
        </Field>
        <Field label="Default Payment Terms">
          <input type="text" value={s.default_payment_terms} onChange={e => set("default_payment_terms", e.target.value)} className={inputClass} />
        </Field>
        <div className="flex items-center gap-2 pt-5">
          <button
            type="button"
            onClick={() => set("progress_payment_enabled", !s.progress_payment_enabled)}
            className={`relative h-5 w-9 rounded-full transition-colors ${s.progress_payment_enabled ? "bg-primary" : "bg-muted"}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${s.progress_payment_enabled ? "left-[18px]" : "left-0.5"}`} />
          </button>
          <span className="text-sm text-muted-foreground">Progress payments enabled</span>
        </div>
      </Section>

      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving} className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
