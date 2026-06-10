import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { KinetixError } from "@/lib/kinetix/client";
import * as kx from "@/lib/kinetix/orders";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * Staff-side action router for the Kinetix Rev3 write surface (auth enforced
 * by middleware — dashboard API). One endpoint, action-dispatched, so the
 * order wizard has a single call shape:
 *   POST { action, params, testingMode }
 *
 * SAFETY: testingMode defaults to TRUE here as well as in the UI — a caller
 * has to explicitly send testingMode:false to touch the real NBN network.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { action?: string; params?: Record<string, unknown>; testingMode?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const action = body.action ?? "";
  // Params flow straight through to the Kinetix query string — shape is per
  // action and validated by Revolution, so a permissive cast is correct here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (body.params ?? {}) as any;
  const testing = body.testingMode !== false; // default SAFE

  try {
    switch (action) {
      /* party */
      case "party.search": return ok(await kx.searchEndUsers(p));
      case "party.createResidential": return ok(await kx.createResidentialEndUser(p, testing));
      case "party.createBusiness": return ok(await kx.createBusinessEndUser(p, testing));

      /* product qualification */
      case "qual.serviceTypes": return ok(await kx.fetchServiceTypes(p["location_ref"]));
      case "qual.bandwidths": return ok(await kx.fetchBandwidths(p["location_ref"], p["service_type"], p["cpi_ref"]));
      case "qual.slas": return ok(await kx.fetchRestorationSlas(p["location_ref"], p["bandwidth_product_sku"]));

      /* appointments */
      case "appointments.queryNew": return ok(await kx.queryNewTimeslots(p));
      case "appointments.reserve": return ok(await kx.reserveAppointment(p, testing));
      case "appointments.cancel": return ok(await kx.cancelAppointment(p["appointment_id"], testing));

      /* orders */
      case "orders.submit": {
        const { productClass, formattedAddress, customerId, ...orderParams } = p as Record<string, string>;
        if (!["ncas", "nfas", "nhas", "nwas"].includes(productClass)) {
          return NextResponse.json({ error: "Invalid productClass" }, { status: 400 });
        }
        const result = await kx.submitProductOrder(
          productClass as kx.OrderProductClass,
          orderParams as Record<string, string>,
          testing,
        );
        const r = result as { id?: string; state?: string; subState?: string; testingMode?: unknown };

        // Register in the CRM (service role — nbn_orders has no user INSERT policy)
        const svc = createServiceRoleClient();
        const { error: insErr } = await svc.from("nbn_orders").insert({
          nbn_order_id: r.id ?? null,
          order_reference: String(orderParams.order_reference ?? ""),
          location_id: String(orderParams.location_id ?? ""),
          formatted_address: formattedAddress ?? null,
          product_class: productClass,
          technology: (p as Record<string, string>).technology ?? null,
          bandwidth_sku: String(orderParams.bandwidth_product_sku ?? ""),
          sla_sku: String(orderParams.restoration_sla_sku ?? ""),
          end_user_ref: orderParams.end_user_ref ?? null,
          appointment_id: orderParams.appointment_id ?? null,
          state: r.state ?? "Acknowledged",
          sub_state: r.subState ?? null,
          testing_mode: testing,
          customer_id: customerId || null,
          raw: result,
          created_by: user.id,
          last_synced_at: new Date().toISOString(),
        });
        if (insErr) console.error("[nbn] order register failed:", insErr);

        await enqueueNotification({
          typeCode: "nbn.order.submitted",
          refType: "job",
          refId: r.id ?? String(orderParams.order_reference ?? "nbn-order"),
          audience: { allActive: true },
          title: `${testing ? "[TEST] " : ""}NBN order submitted — ${orderParams.order_reference}`,
          body: `${formattedAddress ?? orderParams.location_id} · ${String(productClass).toUpperCase()} · ${r.state ?? "Acknowledged"}`,
          href: "/nbn/orders",
        });
        return ok(result);
      }
      case "orders.refresh": {
        const orderId = p["nbn_order_id"] as string;
        const detail = await kx.getOrder(orderId);
        const d = detail as { state?: string; subState?: string };
        const svc = createServiceRoleClient();
        await svc.from("nbn_orders").update({
          state: d.state ?? null,
          sub_state: d.subState ?? null,
          raw: detail,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("nbn_order_id", orderId);
        return ok(detail);
      }
      case "orders.history": return ok(await kx.getOrderHistory(p["nbn_order_id"]));
      case "orders.cancel": {
        const result = await kx.cancelOrder(p["nbn_order_id"]);
        const svc = createServiceRoleClient();
        await svc.from("nbn_orders").update({
          state: "Cancelled", updated_at: new Date().toISOString(),
        }).eq("nbn_order_id", p["nbn_order_id"]);
        return ok(result);
      }
      case "orders.note":
        return ok(await kx.addOrderNote(p["nbn_order_id"], p["text"], p["author"], p["nbn_action_required"], testing));
      case "orders.watch": return ok(await kx.watchOrder(p["order_ref"]));
      case "orders.provision": return ok(await kx.provisionOrder(p, testing));
      case "orders.provisioningStatus": return ok(await kx.getOrderProvisioning(p["order_ref"]));

      /* diagnostics */
      case "diagnostics.run": return ok(await kx.runAvcServiceTest(p, testing));
      case "diagnostics.get": return ok(await kx.getDiagnosticTest(p["test_ref"]));

      /* radius */
      case "radius.status": return ok(await kx.getRadiusStatus(p["reference"]));

      /* callbacks admin */
      case "callbacks.list": return ok(await kx.listCallbacks());
      case "callbacks.register": return ok(await kx.registerCallback(p, testing));
      case "callbacks.delete": return ok(await kx.deleteCallback(p["callback_id"]));

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof KinetixError) {
      return NextResponse.json({ error: err.message, detail: err.detail }, { status: err.status >= 400 && err.status < 600 ? err.status : 502 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Kinetix request failed" }, { status: 502 });
  }
}

function ok(result: unknown) {
  return NextResponse.json({ result });
}
