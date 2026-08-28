import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getCurrentStaff } from "@/lib/auth/current-staff";
import {
  mintSnapDevice,
  resolveDeviceStaff,
  SNAP_DEVICE_COOKIE,
  SNAP_DEVICE_MAX_AGE_S,
} from "@/lib/receipts/snap-device";

/**
 * POST /api/snap/pair — pair this phone with the signed-in staff member so
 * the Receipts app opens straight into the camera from then on. Deliberately
 * NOT in the middleware public list: pairing always rides a full
 * MFA-satisfied CRM session. The cookie is set server-side (Set-Cookie with
 * explicit expiry) so iOS keeps it across PWA process kills.
 */
export async function POST() {
  const staff = await getCurrentStaff();
  if (!staff?.is_active) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const store = await cookies();
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SNAP_DEVICE_MAX_AGE_S,
  };

  // Already paired to this same person → just re-stamp the expiry so an
  // in-use phone never lapses. Paired to someone else (shared phone) →
  // mint a fresh token for the current user.
  const existing = await resolveDeviceStaff();
  if (existing?.id === staff.id) {
    const raw = store.get(SNAP_DEVICE_COOKIE)?.value;
    if (raw) {
      store.set(SNAP_DEVICE_COOKIE, raw, cookieOpts);
      return NextResponse.json({ ok: true, paired: "existing" });
    }
  }

  const svc = createServiceRoleClient();
  const value = await mintSnapDevice(svc, staff.id);
  store.set(SNAP_DEVICE_COOKIE, value, cookieOpts);
  return NextResponse.json({ ok: true, paired: "new" });
}
