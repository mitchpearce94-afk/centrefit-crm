import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { scanAllCouncils } from "@/lib/bd/da-scanner";

/**
 * Nightly SEQ development-application lead scanner (QLD growth phase 1 —
 * docs/qld-growth-CONTEXT.md D5). Polls six council DA feeds, filters to the
 * phase-1 verticals, inserts NEW matches into bd_leads and bells the admins.
 * Mondays additionally get a weekly pipeline summary.
 *
 * 7-day lookback with insert-only-new dedupe: a council being down one night
 * self-heals the next, and re-runs are idempotent.
 *
 * Auth: X-Cf-Cron-Secret must match CRON_SECRET (same as other crons).
 */

export const maxDuration = 300;

const LOOKBACK_DAYS = 7;

function brisbaneDay(): number {
  // 0 = Sunday … 1 = Monday, in Brisbane local time.
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane",
    weekday: "short",
  }).format(new Date());
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided =
    req.headers.get("x-cf-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (provided !== secret) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const svc = createServiceRoleClient();
  const results = await scanAllCouncils(LOOKBACK_DAYS);
  // Councils return one row per land parcel, so a single DA can appear
  // several times in one batch — dedupe within the run first.
  const byKey = new Map<string, (typeof results)[number]["leads"][number]>();
  for (const lead of results.flatMap((r) => r.leads)) {
    const key = `${lead.source}:${lead.application_number}`;
    if (!byKey.has(key)) byKey.set(key, lead);
  }
  const candidates = [...byKey.values()];

  // Insert only rows we haven't seen — dedupe on (source, application_number).
  let inserted = 0;
  const freshSamples: string[] = [];
  if (candidates.length > 0) {
    const { data: existing } = await svc
      .from("bd_leads")
      .select("source, application_number")
      .in("application_number", candidates.map((c) => c.application_number));
    const seen = new Set((existing ?? []).map((r) => `${r.source}:${r.application_number}`));
    const fresh = candidates.filter((c) => !seen.has(`${c.source}:${c.application_number}`));

    if (fresh.length > 0) {
      const { error } = await svc.from("bd_leads").insert(fresh);
      if (error) {
        console.error("[da-scanner] insert failed", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      inserted = fresh.length;
      for (const f of fresh.slice(0, 5)) {
        freshSamples.push(
          `${f.matched_keywords[0] ?? "lead"} · ${f.address ?? f.application_number} (${f.source})`,
        );
      }
    }
  }

  if (inserted > 0) {
    await enqueueNotification({
      typeCode: "bd.lead",
      refType: "enquiry",
      refId: "da-scanner",
      audience: { role: "admin" },
      title: `${inserted} new construction lead${inserted === 1 ? "" : "s"} — DA scanner`,
      body: freshSamples.join(" • "),
      href: "/bd-leads",
      metadata: { perCouncil: results.map((r) => ({ source: r.source, matched: r.matched, error: r.error ?? null })) },
    });
  }

  // Monday: weekly pipeline digest regardless of tonight's haul.
  if (brisbaneDay() === 1) {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const [{ count: weekNew }, { count: stillNew }] = await Promise.all([
      svc.from("bd_leads").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
      svc.from("bd_leads").select("id", { count: "exact", head: true }).eq("status", "new"),
    ]);
    await enqueueNotification({
      typeCode: "bd.lead",
      refType: "enquiry",
      refId: "da-scanner-digest",
      audience: { role: "admin" },
      title: `BD pipeline — ${weekNew ?? 0} new lead${(weekNew ?? 0) === 1 ? "" : "s"} this week`,
      body: `${stillNew ?? 0} lead${(stillNew ?? 0) === 1 ? "" : "s"} sitting untouched in "New". Worth a scan before the week runs away.`,
      href: "/bd-leads",
    });
  }

  const errors = results.filter((r) => r.error).map((r) => `${r.source}: ${r.error}`);
  if (errors.length > 0) console.warn("[da-scanner] council errors", errors);

  return NextResponse.json({
    inserted,
    perCouncil: results.map((r) => ({
      source: r.source,
      fetched: r.fetched,
      matched: r.matched,
      error: r.error ?? null,
    })),
  });
}
