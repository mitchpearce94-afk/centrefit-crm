import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { resolveSnapStaff } from "@/lib/receipts/snap-device";
import { reprocessSnapReceipt, snapStatusOf } from "@/lib/receipts/snap";

export const maxDuration = 60;

/**
 * POST /api/receipts/snap/retry { id } — the phone's "Retry" for a receipt
 * that was stored but never reached Xero. Re-reads the image from storage
 * and re-runs the read + forward in the request (so the phone gets a real
 * answer, not a fire-and-forget). Only the uploader can retry their own.
 */
export async function POST(req: NextRequest) {
  const auth = await resolveSnapStaff();
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  const id = (body.id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Receipt id required" }, { status: 400 });
  const svc = createServiceRoleClient();
  const { data: own } = await svc.from("receipts").select("id").eq("id", id).eq("uploaded_by", auth.staff.id).maybeSingle();
  if (!own) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });

  const result = await reprocessSnapReceipt(svc, id);
  const { data: row } = await svc.from("receipts").select("id, email_sent, email_error, forwarded_to, vendor, amount").eq("id", id).single();
  return NextResponse.json({ ok: result.ok, error: result.error ?? null, status: row ? snapStatusOf(row) : null }, { status: result.ok ? 200 : 502 });
}
