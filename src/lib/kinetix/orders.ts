import "server-only";
import { kinetixGet, kinetixSendQ } from "./client";

/**
 * Kinetix Rev3 write-side domain functions: end users (party), product
 * qualification, appointments, product orders, provisioning and callbacks.
 * Contracts per docs/kinetix-nbn-api.md (full swagger in docs/kinetix-swagger.json).
 *
 * EVERY mutating function takes `testingMode` — when true Revolution simulates
 * the call and nothing reaches NBN. The CRM UI defaults to testing mode; the
 * live switch is a deliberate staff action.
 */

type Params = Record<string, string | number | boolean | undefined>;

/* ── Party (end users) ─────────────────────────────────────────────── */

export function searchEndUsers(filter: { name?: string; email_address?: string; nbn_biz_ref?: string }) {
  return kinetixGet("/party/end_users", filter);
}

export function getEndUser(reference: string) {
  return kinetixGet(`/party/end_user/${encodeURIComponent(reference)}`);
}

export function createResidentialEndUser(p: {
  contact_name: string; phone_number?: string; email_address?: string;
}, testingMode: boolean) {
  return kinetixSendQ("POST", "/party/end_users/residential", { ...p, TESTING_MODE: testingMode || undefined });
}

export function createBusinessEndUser(p: {
  company_name: string; trading_name: string; contact_name?: string;
  phone_number?: string; email_address?: string; business_id?: string; business_size?: string;
}, testingMode: boolean) {
  return kinetixSendQ("POST", "/party/end_users/business", { ...p, TESTING_MODE: testingMode || undefined });
}

/* ── Product qualification ─────────────────────────────────────────── */

export function fetchServiceTypes(locationRef: string) {
  return kinetixGet("/product_qualification/service_types", { location_ref: locationRef });
}

export function fetchBandwidths(locationRef: string, serviceType: string, cpiRef?: string) {
  return kinetixGet("/product_qualification/bandwidths", {
    location_ref: locationRef, service_type: serviceType, cpi_ref: cpiRef,
  });
}

export function fetchRestorationSlas(locationRef: string, bandwidthSku: string) {
  return kinetixGet("/product_qualification/restoration_sla", {
    location_ref: locationRef, bandwidth_product_sku: bandwidthSku,
  });
}

/* ── Appointments ──────────────────────────────────────────────────── */

export function queryNewTimeslots(p: {
  location_id: string; start_date_time: string; end_date_time?: string;
  demand_type: string; appointment_sla?: string; appointment_slot_type?: string;
  priority_assist: boolean; alternative_technology?: string;
}) {
  return kinetixGet("/appointments/query/new", p as Params);
}

export function reserveAppointment(p: Params, testingMode: boolean) {
  return kinetixSendQ("POST", "/appointments/reserve", { ...p, TESTING_MODE: testingMode || undefined });
}

export function getAppointment(appointmentId: string) {
  return kinetixGet(`/appointments/appointment/${encodeURIComponent(appointmentId)}`);
}

export function cancelAppointment(appointmentId: string, testingMode: boolean) {
  return kinetixSendQ("DELETE", `/appointments/appointment/${encodeURIComponent(appointmentId)}`, {
    TESTING_MODE: testingMode || undefined,
  });
}

export function queryRescheduleTimeslots(appointmentId: string, startDateTime: string, endDateTime?: string) {
  return kinetixGet("/appointments/query/reschedule", {
    appointment_id: appointmentId, start_date_time: startDateTime, end_date_time: endDateTime,
  });
}

export function rescheduleAppointment(
  appointmentId: string,
  p: { slot_type: string; start_date_time: string; end_date_time: string },
  testingMode: boolean,
) {
  return kinetixSendQ("PATCH", `/appointments/appointment/${encodeURIComponent(appointmentId)}/reschedule`, {
    ...p, TESTING_MODE: testingMode || undefined,
  });
}

/* ── Product orders ────────────────────────────────────────────────── */

export type OrderProductClass = "ncas" | "nfas" | "nhas" | "nwas";

/** Map a qualification's primary access technology to the order product class. */
export function productClassForTech(primaryTech: string | null | undefined): OrderProductClass | null {
  const t = (primaryTech ?? "").toLowerCase();
  if (!t) return null;
  if (t === "fibre" || t.includes("premises") || t === "fttp") return "nfas";
  if (t.includes("node") || t.includes("building") || t.includes("curb") || t.startsWith("ftt")) return "ncas";
  if (t.includes("hfc")) return "nhas";
  if (t.includes("wireless")) return "nwas";
  return null;
}

export function submitProductOrder(productClass: OrderProductClass, p: Params, testingMode: boolean) {
  return kinetixSendQ("POST", `/orders/products/${productClass}`, {
    ...p, TESTING_MODE: testingMode || undefined,
  });
}

export function getOrder(orderId: string) {
  return kinetixGet(`/orders/product/${encodeURIComponent(orderId)}`);
}

export function getOrderHistory(orderId: string) {
  return kinetixGet(`/orders/product/${encodeURIComponent(orderId)}/history`);
}

export function cancelOrder(orderId: string) {
  return kinetixSendQ("DELETE", `/orders/product/${encodeURIComponent(orderId)}`);
}

export function addOrderNote(orderId: string, text: string, author?: string, nbnActionRequired?: boolean, testingMode?: boolean) {
  return kinetixSendQ("POST", "/orders/add_note", {
    order_id: orderId, text, author,
    nbn_action_required: nbnActionRequired || undefined,
    TESTING_MODE: testingMode || undefined,
  });
}

export function addAppointmentToOrder(orderId: string, appointmentId: string) {
  return kinetixSendQ("PATCH", "/orders/add_appointment", { order_id: orderId, appointment_id: appointmentId });
}

export function attachEndUserToOrder(orderId: string, endUserRef: string) {
  return kinetixSendQ("PATCH", "/orders/attach_end_user", { order_id: orderId, end_user_ref: endUserRef });
}

export function watchOrder(orderRef: string) {
  return kinetixSendQ("POST", `/orders/watch/${encodeURIComponent(orderRef)}`);
}

export function disconnectProduct(productId: string, testingMode: boolean) {
  return kinetixSendQ("POST", "/orders/disconnect_product", {
    product_id: productId, TESTING_MODE: testingMode || undefined,
  });
}

/* ── Provisioning ──────────────────────────────────────────────────── */

export function provisionOrder(p: {
  order_ref: string; fixed_ip?: string; ipv6_method?: "Disabled" | "DHCPv6";
  protocol?: "IPoE" | "PPPoE"; username?: string; password?: string;
}, testingMode: boolean) {
  return kinetixSendQ("POST", "/provisioning/order", { ...p, TESTING_MODE: testingMode || undefined });
}

export function getOrderProvisioning(orderRef: string) {
  return kinetixGet(`/provisioning/order/${encodeURIComponent(orderRef)}`);
}

export function getRadiusStatus(reference: string) {
  return kinetixGet(`/provisioning/radius/${encodeURIComponent(reference)}`);
}

/* ── Diagnostics (run) ─────────────────────────────────────────────── */

export function runAvcServiceTest(p: {
  avc_ref: string; test: string; traffic_class?: string; resync_type?: string;
  monitoring_duration?: number; force_test?: boolean; force_measurement?: boolean; technology?: string;
}, testingMode: boolean) {
  return kinetixSendQ("POST", "/diagnostics/avc/service_test", { ...p, TESTING_MODE: testingMode || undefined });
}

export function getDiagnosticTest(testRef: string) {
  return kinetixGet(`/diagnostics/${encodeURIComponent(testRef)}`);
}

/* ── Callbacks (webhooks) ──────────────────────────────────────────── */

export function registerCallback(p: {
  href: string; resource: string; query?: string; token_name?: string; token_value?: string;
}, testingMode: boolean) {
  return kinetixSendQ("POST", "/callbacks/register", { ...p, TESTING_MODE: testingMode || undefined });
}

export function listCallbacks() {
  return kinetixGet("/callbacks/list");
}

export function deleteCallback(callbackId: string) {
  return kinetixSendQ("DELETE", `/callbacks/${encodeURIComponent(callbackId)}`);
}
