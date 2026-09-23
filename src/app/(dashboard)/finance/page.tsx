import { createClient } from "@/lib/supabase/server";
import { PayoutsTable } from "./payouts-table";
import { ActionButton } from "./finance-actions";

export const dynamic = "force-dynamic";

export default async function FinancePayoutsPage() {
  const supabase = await createClient();
  const [{ data: settings }, { data: payouts }, { data: note }, { count: openReview }] = await Promise.all([
    supabase.from("finance_settings").select("gc_payouts_mode, paused, last_run_at, last_run_report").eq("id", 1).maybeSingle(),
    supabase.from("finance_payouts").select("id, provider, provider_payout_id, arrival_date, net_cents, fee_cents, gross_cents, status, items_total, items_matched, plan, exception, posted_at, reconciled_at").order("arrival_date", { ascending: false }).limit(200),
    supabase.from("finance_daily_notes").select("date, body").order("date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("finance_review_items").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);
  const report = (settings?.last_run_report ?? null) as { xero?: { dayRemaining?: number | null }; errors?: string[] } | null;
  const counts: Record<string, number> = {};
  for (const p of payouts ?? []) counts[p.status as string] = (counts[p.status as string] ?? 0) + 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 text-sm">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${settings?.paused ? "bg-amber-500/15 text-amber-400" : settings?.gc_payouts_mode === "live" ? "bg-emerald-500/15 text-emerald-400" : "bg-sky-500/15 text-sky-400"}`}>
          {settings?.paused ? "Paused" : settings?.gc_payouts_mode === "live" ? "Live" : settings?.gc_payouts_mode === "off" ? "Off" : "Dry run"}
        </span>
        <span className="text-muted-foreground">
          Last run {settings?.last_run_at ? new Date(settings.last_run_at).toLocaleString("en-AU", { timeZone: "Australia/Brisbane", dateStyle: "medium", timeStyle: "short" }) : "never"}
          {report?.xero?.dayRemaining != null ? ` · Xero calls left today ${report.xero.dayRemaining}` : ""}
          {report?.errors?.length ? ` · ${report.errors.length} error${report.errors.length === 1 ? "" : "s"} (see Audit)` : ""}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {openReview ? <a href="/finance/review" className="text-amber-400 hover:underline">{openReview} to review</a> : null}
          <ActionButton url="/api/finance/run" body={{}} label="Run now" busyLabel="Running…" okMessage="Cycle finished" variant="primary" />
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {(["new", "planned", "posted", "reconciled", "exception", "skipped"] as const).map((s) => (
          <div key={s} className="rounded-lg border border-border bg-card px-3 py-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{s}</div>
            <div className="text-lg font-semibold">{counts[s] ?? 0}</div>
          </div>
        ))}
      </div>

      <PayoutsTable payouts={(payouts ?? []) as never} mode={(settings?.gc_payouts_mode as string) ?? "dry_run"} />

      {note ? (
        <details className="rounded-xl border border-border bg-card p-3 text-sm">
          <summary className="cursor-pointer font-medium">Daily note — {note.date}</summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground">{note.body}</pre>
        </details>
      ) : null}
    </div>
  );
}
