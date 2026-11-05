import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Shared by the site builder routes (docs/job-lifecycle-CONTEXT.md D9). */
export const BUILDER_FIELDS = {
  name: "name",
  abn: "abn",
  contactName: "contact_name",
  email: "email",
  phone: "phone",
  address: "address",
  notes: "notes",
  xeroContactId: "xero_contact_id",
} as const;

export async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: staffRow } = await supabase.from("staff").select("is_active").eq("id", user.id).maybeSingle();
  if (!staffRow?.is_active) return { error: NextResponse.json({ error: "Staff only" }, { status: 403 }) };
  return { user };
}

export function builderPatchFromBody(body: Record<string, unknown>): { patch: Record<string, string | null>; error?: string } {
  const patch: Record<string, string | null> = {};
  for (const [key, column] of Object.entries(BUILDER_FIELDS)) {
    if (body[key] === undefined) continue;
    const v = typeof body[key] === "string" ? (body[key] as string).trim() : null;
    patch[column] = v || null;
  }
  if (patch.email) {
    const bad = patch.email.split(",").map((e) => e.trim()).find((e) => e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (bad) return { patch, error: `"${bad}" isn't a valid email address` };
  }
  return { patch };
}

