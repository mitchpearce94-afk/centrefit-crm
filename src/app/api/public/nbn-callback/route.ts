import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * Receiver for Kinetix Revolution callback notifications (registered via
 * POST /callbacks/register with this URL + bearer token). Lives under
 * /api/public/ (middleware-exempt); authenticated by the shared token.
 *
 * Register with: href=https://crm.centrefit.com.au/api/public/nbn-callback,
 * token_name=bearer, token_value=$NBN_CALLBACK_TOKEN.
 *
 * Event shapes vary per resource — we extract the order/appointment/outage
 * essentials, sync nbn_orders where applicable, and bell-notify staff.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.NBN_CALLBACK_TOKEN;
  if (!expected) return NextResponse.json({ error: "Receiver not configured" }, { status: 503 });
  const auth = req.headers.get("authorization") ?? "";
  if (auth.replace(/^bearer\s+/i, "").trim() !== expected) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = String(payload.eventType ?? "");
  const event = (payload.event ?? {}) as Record<string, unknown>;
  const notificationType = String(event.notificationType ?? eventType ?? "Update");
  const refId = String(event.id ?? "");
  const externalId = String(event.externalId ?? event.externalID ?? "");
  const state = event.state ? String(event.state) : null;
  const subState = event.subState ? String(event.subState) : null;

  const svc = createServiceRoleClient();

  // Sync order state when this event maps to one of our registered orders.
  if (refId.startsWith("ORD") || externalId) {
    const match = refId.startsWith("ORD")
      ? svc.from("nbn_orders").update({
          state, sub_state: subState, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq("nbn_order_id", refId)
      : svc.from("nbn_orders").update({
          state, sub_state: subState, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq("order_reference", externalId);
    const { error } = await match;
    if (error) console.error("[nbn-callback] order sync failed:", error);
  }

  await enqueueNotification({
    typeCode: "nbn.callback",
    refType: "job",
    refId: refId || externalId || "nbn-event",
    audience: { allActive: true },
    title: `NBN: ${humanise(notificationType)}${refId ? ` — ${refId}` : ""}`,
    body: [externalId && `Ref ${externalId}`, state && `State: ${state}${subState ? ` (${subState})` : ""}`]
      .filter(Boolean).join(" · ") || undefined,
    href: "/nbn/orders",
    metadata: { payload },
  });

  return NextResponse.json({ ok: true });
}

function humanise(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/Notification$/, "").trim() || "Event";
}
