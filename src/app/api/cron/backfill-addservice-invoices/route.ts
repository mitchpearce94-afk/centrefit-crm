import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { mirrorServiceToXero } from "@/lib/recurring/mirror-service-invoice";

/**
 * One-shot catch-up for add-service GC subscriptions created BEFORE the Xero
 * mirror existed (gap found 2026-07-09: add-service made the GC sub and
 * nothing else — money collected, no invoice anywhere).
 *
 * Deliberately takes EXPLICIT link-row ids — no auto-sweep. The June
 * backfill-subscriptions rows share source='crm' but their plans already
 * invoice via existing RIs; blindly mirroring them would double-invoice.
 * Idempotent per row via xero_mirrored_at, so a retry is safe.
 *
 * POST { linkIds: string[] }
 * Auth: X-Cf-Cron-Secret matches CRON_SECRET (same pattern as the other
 * cron routes; this one is invoked manually, not scheduled).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided =
    req.headers.get("x-cf-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  let body: { linkIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const linkIds = (body.linkIds ?? []).filter((v) => typeof v === "string" && v.length > 0);
  if (linkIds.length === 0) {
    return NextResponse.json({ error: "linkIds required — this route never sweeps" }, { status: 400 });
  }

  const svc = createServiceRoleClient();
  const results: Array<Record<string, unknown>> = [];

  for (const linkId of linkIds) {
    const { data: link } = await svc
      .from("recurring_plan_gc_subscriptions")
      .select("id, plan_id, name, amount_cents, interval_unit, start_date, gc_status, source, xero_mirrored_at")
      .eq("id", linkId)
      .maybeSingle();
    if (!link) {
      results.push({ linkId, ok: false, error: "link row not found" });
      continue;
    }
    if (link.source !== "crm") {
      results.push({ linkId, ok: false, error: `source is '${link.source}' — only crm rows can be mirrored` });
      continue;
    }
    if (link.xero_mirrored_at) {
      results.push({ linkId, ok: true, skipped: "already mirrored" });
      continue;
    }

    // Pull the matching plan item for description/account-code context; fall
    // back to sensible defaults when the names drifted.
    const { data: item } = await svc
      .from("recurring_plan_items")
      .select("service_name, description, account_code, price_inc_gst, quantity")
      .eq("recurring_plan_id", link.plan_id)
      .eq("service_name", link.name)
      .maybeSingle();

    const quantity = item?.quantity ?? 1;
    const priceIncGst = item
      ? Number(item.price_inc_gst)
      : Math.round(link.amount_cents / quantity) / 100;

    try {
      const mirror = await mirrorServiceToXero(svc, {
        planId: link.plan_id,
        subscriptionLinkId: link.id,
        serviceName: link.name,
        description: item?.description ?? null,
        priceIncGst,
        quantity,
        accountCode: item?.account_code ?? "200",
        frequency: link.interval_unit === "yearly" ? "yearly" : "monthly",
        startDate: link.start_date,
      });
      results.push({
        linkId,
        ok: true,
        repeatingInvoiceId: mirror.repeatingInvoiceId,
        createdTemplate: mirror.createdTemplate,
      });
    } catch (err) {
      results.push({ linkId, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ ok: results.every((r) => r.ok), results });
}
