"use client";

import { useState } from "react";
import { ActionButton, usePost } from "../finance-actions";

interface Settings {
  gc_payouts_mode: "off" | "dry_run" | "live"; stripe_verify_mode: string; draft_bills_mode: string; paused: boolean;
  bank_account_code: string; fee_account_code: string; fee_tax_type: string; fee_contact_name: string;
  match_window_days: number; ingest_since: string; xero_day_floor: number; viewer_staff_ids: string[];
  last_run_at: string | null; last_run_report: Record<string, unknown> | null;
}
interface Staff { id: string; display_name: string; role: string }

export function SettingsForm({ settings, staff, isOwner }: { settings: Settings; staff: Staff[]; isOwner: boolean }) {
  const { post, busy } = usePost();
  const [s, setS] = useState(settings);
  const field = "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm";
  const label = "block text-[11px] uppercase tracking-wide text-muted-foreground";
  const save = (patch: Partial<Settings>, ok = "Saved") => post("/api/finance/settings", patch, JSON.stringify(patch), ok);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Jobs</h2>
        <p className="text-xs text-muted-foreground">Every job starts in dry run: it matches and writes a plan, nothing reaches Xero. Live posts the plan. Pause stops everything.</p>
        {([["gc_payouts_mode", "GoCardless payouts"], ["stripe_verify_mode", "Stripe payout checks (phase 2)"], ["draft_bills_mode", "Draft bills (phase 3)"]] as const).map(([k, name]) => (
          <div key={k} className="flex items-center justify-between gap-3">
            <span className="text-sm">{name}</span>
            <div className="flex overflow-hidden rounded-md border border-border text-xs">
              {(["off", "dry_run", "live"] as const).map((m) => (
                <button key={m} type="button" disabled={!!busy || (m === "live" && !isOwner) || (k !== "gc_payouts_mode" && m !== "off")}
                  onClick={() => { setS({ ...s, [k]: m }); save({ [k]: m } as never, `${name}: ${m.replace("_", " ")}`); }}
                  className={`px-3 py-1.5 disabled:opacity-40 ${s[k] === m ? (m === "live" ? "bg-emerald-500/20 text-emerald-300" : m === "off" ? "bg-zinc-500/20" : "bg-sky-500/20 text-sky-300") : "hover:bg-accent"}`}>
                  {m === "dry_run" ? "Dry run" : m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <span className="text-sm">{s.paused ? "Paused — nothing runs" : "Running on schedule (06:30 daily) and on Run now"}</span>
          <button type="button" disabled={!!busy} onClick={() => { const paused = !s.paused; setS({ ...s, paused }); save({ paused }, paused ? "Paused" : "Resumed"); }} className={`rounded-md px-3 py-1.5 text-sm font-medium ${s.paused ? "bg-emerald-500/20 text-emerald-300" : "border border-amber-500/40 text-amber-300 hover:bg-amber-500/10"}`}>{s.paused ? "Resume" : "Pause"}</button>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">Last run {s.last_run_at ? new Date(s.last_run_at).toLocaleString("en-AU", { timeZone: "Australia/Brisbane" }) : "never"}</span>
          <ActionButton url="/api/finance/run" body={{}} label="Run now" busyLabel="Running…" okMessage="Cycle finished — see Payouts" variant="primary" />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Xero posting</h2>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>Bank account code</label><input className={field} value={s.bank_account_code} onChange={(e) => setS({ ...s, bank_account_code: e.target.value })} /></div>
          <div><label className={label}>Fee account code</label><input className={field} value={s.fee_account_code} onChange={(e) => setS({ ...s, fee_account_code: e.target.value })} /></div>
          <div><label className={label}>Fee tax type</label><input className={field} value={s.fee_tax_type} onChange={(e) => setS({ ...s, fee_tax_type: e.target.value })} placeholder="INPUT" /></div>
          <div><label className={label}>Fee contact name</label><input className={field} value={s.fee_contact_name} onChange={(e) => setS({ ...s, fee_contact_name: e.target.value })} /></div>
          <div><label className={label}>Match window (days)</label><input type="number" className={field} value={s.match_window_days} onChange={(e) => setS({ ...s, match_window_days: Number(e.target.value) })} /></div>
          <div><label className={label}>Ingest payouts since</label><input type="date" className={field} value={s.ingest_since} onChange={(e) => setS({ ...s, ingest_since: e.target.value })} /></div>
          <div><label className={label}>Xero daily-call floor</label><input type="number" className={field} value={s.xero_day_floor} onChange={(e) => setS({ ...s, xero_day_floor: Number(e.target.value) })} /></div>
        </div>
        <p className="text-xs text-muted-foreground">Xero allows 5,000 calls a day for the whole tenant, shared with the live CRM. The agent stops bulk work when fewer than the floor remain.</p>
        <button type="button" disabled={!!busy} onClick={() => save({ bank_account_code: s.bank_account_code, fee_account_code: s.fee_account_code, fee_tax_type: s.fee_tax_type, fee_contact_name: s.fee_contact_name, match_window_days: s.match_window_days, ingest_since: s.ingest_since, xero_day_floor: s.xero_day_floor })} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">Save</button>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 space-y-3 md:col-span-2">
        <h2 className="text-sm font-semibold">Who can see Finance</h2>
        <p className="text-xs text-muted-foreground">Mitchell always. Tick anyone else to let them in — it applies to the menu, the pages and the data. {isOwner ? "" : "Only Mitchell can change this."}</p>
        <div className="grid gap-1 sm:grid-cols-2 md:grid-cols-3">
          {staff.map((st) => {
            const on = s.viewer_staff_ids.includes(st.id);
            return (
              <label key={st.id} className={`flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm ${isOwner ? "cursor-pointer hover:bg-accent" : "opacity-60"}`}>
                <input type="checkbox" disabled={!isOwner || !!busy} checked={on} onChange={() => { const ids = on ? s.viewer_staff_ids.filter((i) => i !== st.id) : [...s.viewer_staff_ids, st.id]; setS({ ...s, viewer_staff_ids: ids }); save({ viewer_staff_ids: ids }, `${st.display_name} ${on ? "removed" : "added"}`); }} />
                <span>{st.display_name}</span><span className="text-xs text-muted-foreground">{st.role}</span>
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
}
