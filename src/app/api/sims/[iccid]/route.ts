import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasPermission, loadCurrentPermissions } from "@/lib/auth/permissions";
import {
  DEVICE_STATUSES,
  JasperError,
  fetchDevice,
  fetchDeviceUsage,
  isJasperConfigured,
  updateDevice,
  type DeviceStatus,
} from "@/lib/jasper/client";

/**
 * One M2M One SIM in Jasper Control Centre.
 *   GET   → { device, usage }                      (any signed-in user)
 *   PATCH { ratePlan?, status? } → { device }      (nbn.manage) — writes straight to Jasper
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ iccid: string }> }) {
  const { iccid } = await params;
  if (!isJasperConfigured()) return NextResponse.json({ error: "Jasper not configured" }, { status: 503 });
  try {
    const [device, usage] = await Promise.all([fetchDevice(iccid), fetchDeviceUsage(iccid).catch(() => null)]);
    return NextResponse.json({ device, usage });
  } catch (err) {
    return jasperFail(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ iccid: string }> }) {
  const { iccid } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const perms = await loadCurrentPermissions();
  if (!perms || !hasPermission(perms, "nbn.manage")) {
    return NextResponse.json({ error: "You don't have permission to change SIMs" }, { status: 403 });
  }
  if (!isJasperConfigured()) return NextResponse.json({ error: "Jasper not configured" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { ratePlan?: unknown; status?: unknown };
  const ratePlan = typeof body.ratePlan === "string" && body.ratePlan.trim() ? body.ratePlan.trim() : undefined;
  const status = typeof body.status === "string" && (DEVICE_STATUSES as readonly string[]).includes(body.status)
    ? (body.status as DeviceStatus)
    : undefined;
  if (typeof body.status === "string" && !status) {
    return NextResponse.json({ error: `Unknown status "${body.status}"` }, { status: 400 });
  }
  if (!ratePlan && !status) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

  try {
    await updateDevice(iccid, { ratePlan, status });
    const device = await fetchDevice(iccid);
    return NextResponse.json({ device });
  } catch (err) {
    return jasperFail(err);
  }
}

function jasperFail(err: unknown) {
  if (err instanceof JasperError) {
    return NextResponse.json({ error: err.message }, { status: err.status >= 400 && err.status < 600 ? err.status : 502 });
  }
  return NextResponse.json({ error: err instanceof Error ? err.message : "Jasper request failed" }, { status: 502 });
}
