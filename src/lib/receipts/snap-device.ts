import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getCurrentStaff, type CurrentStaff } from "@/lib/auth/current-staff";

/**
 * Snap paired-device auth (Mitchell 2026-08-28).
 *
 * The Receipts home-screen app lives in its own cookie jar and iOS drops
 * script-set session cookies whenever the PWA process is killed — so the
 * Supabase session was gone on nearly every open and the camera bounced to
 * the CRM login. A paired device instead carries a long-lived SERVER-set
 * httpOnly cookie ("<row id>.<secret>"), minted once from an authenticated
 * session (or a one-tap passkey), which /snap and its upload API accept in
 * place of a session. Server-set cookies with an explicit expiry survive
 * PWA process kills, so pairing is once per phone.
 *
 * Scope: the token only ever grants what /snap does — upload receipts and
 * see the owner's today-jobs list. Revoke a phone by deleting its
 * snap_devices row (service-role only table).
 */

export const SNAP_DEVICE_COOKIE = "cf-snap-device";
// Chrome caps cookie lifetime at 400 days; the pair endpoint re-stamps the
// expiry on every session-authed open, so an in-use phone never lapses.
export const SNAP_DEVICE_MAX_AGE_S = 60 * 60 * 24 * 400;

const LAST_SEEN_BUMP_MS = 60 * 60 * 1000; // write last_seen_at at most hourly

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export interface SnapAuth {
  staff: CurrentStaff;
  viaDevice: boolean;
}

/** Mint a device row for this staff member; returns the cookie value. */
export async function mintSnapDevice(svc: SupabaseClient, staffId: string): Promise<string> {
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const { error } = await svc
    .from("snap_devices")
    .insert({ id, staff_id: staffId, token_hash: hashSecret(secret) });
  if (error) throw new Error(`Failed to pair device: ${error.message}`);
  return `${id}.${secret}`;
}

/** The staff member this request's device cookie belongs to, or null. */
export async function resolveDeviceStaff(): Promise<CurrentStaff | null> {
  const store = await cookies();
  const raw = store.get(SNAP_DEVICE_COOKIE)?.value;
  if (!raw) return null;
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  const id = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !secret) return null;

  const svc = createServiceRoleClient();
  const { data } = await svc
    .from("snap_devices")
    .select(
      "token_hash, last_seen_at, staff:staff!snap_devices_staff_id_fkey(id, email, display_name, initials, role, is_active)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;

  const expected = Buffer.from(data.token_hash, "hex");
  const actual = Buffer.from(hashSecret(secret), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const staff = data.staff as unknown as CurrentStaff | null;
  if (!staff?.is_active) return null;

  const lastSeen = data.last_seen_at ? new Date(data.last_seen_at).getTime() : 0;
  if (Date.now() - lastSeen > LAST_SEEN_BUMP_MS) {
    await svc.from("snap_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", id);
  }
  return staff;
}

/**
 * Who is using Snap: a live CRM session (must be MFA-satisfied, mirroring
 * middleware — /snap is a public path so the gate lives here), else a paired
 * device. Null → show the pairing screen.
 */
export async function resolveSnapStaff(): Promise<SnapAuth | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const methods = (aal?.currentAuthenticationMethods ?? []) as Array<string | { method: string }>;
    const passkeyAuthed = methods.some((m) => {
      const name = typeof m === "string" ? m : m?.method ?? "";
      return name.includes("passkey") || name.includes("webauthn");
    });
    if (passkeyAuthed || aal?.currentLevel === "aal2") {
      const staff = await getCurrentStaff();
      if (staff?.is_active) return { staff, viaDevice: false };
    }
  }
  const staff = await resolveDeviceStaff();
  if (staff) return { staff, viaDevice: true };
  return null;
}
