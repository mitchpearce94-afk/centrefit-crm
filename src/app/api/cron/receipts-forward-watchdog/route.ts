import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { reprocessSnapReceipt } from "@/lib/receipts/snap";

export const maxDuration = 300;

/**
 * Daily ~6:30am AEST — receipts that were stored but never reached Xero
 * (Mitchell 2026-09-16: "sometimes it's not sending through properly").
 *
 * A Snap upload answers the phone as soon as the image is stored; the read +
 * forward run afterwards and can be cut short or fail. This sweep re-forwards
 * anything from the last 14 days that is still unsent and older than 10
 * minutes, then tells the admins about whatever still won't go — so a
 * receipt can never quietly vanish between the phone and the bookkeeper.
 *
 * Auth: X-Cf-Cron-Secret (or Bearer) matches CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cf-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (provided !== secret) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const svc = createServiceRoleClient();
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const settled = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: stuck, error } = await svc
    .from("receipts")
    .select("id, created_at, email_error, vendor, amount, source")
    .eq("email_sent", false)
    .in("source", ["snap", "bulk"])
    .gte("created_at", since)
    .lte("created_at", settled)
    .order("created_at", { ascending: true })
    .limit(25);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const r of stuck ?? []) {
    const res = await reprocessSnapReceipt(svc, r.id);
    results.push({ id: r.id, ok: res.ok, error: res.error });
  }
  const stillFailing = results.filter((r) => !r.ok);
  if (stillFailing.length > 0) {
    await enqueueNotification({
      supabase: svc,
      typeCode: "receipt.forward_failed",
      refType: "receipt",
      refId: stillFailing[0].id,
      audience: { role: "admin" },
      title: `${stillFailing.length} receipt${stillFailing.length === 1 ? "" : "s"} still not forwarded to Xero`,
      body: `Retried this morning and failed again: ${stillFailing.map((r) => r.error ?? "unknown").slice(0, 3).join("; ")}. Open Receipts to check.`,
      href: "/receipts",
    });
  }
  return NextResponse.json({ checked: stuck?.length ?? 0, reforwarded: results.filter((r) => r.ok).length, stillFailing: stillFailing.length, results });
}
