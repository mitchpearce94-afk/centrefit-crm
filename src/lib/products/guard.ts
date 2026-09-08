import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUserHasPermission } from "@/lib/auth/permissions";

/**
 * Shared gate for the product catalogue mutation routes. Product writes used
 * to go straight from the browser through RLS (admin-only); routing them here
 * keeps that floor AND gives one place for validation + business rules like
 * the margin-preserving supplier flip.
 */
export async function requireProductsManager(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  if (!(await currentUserHasPermission("settings.products"))) {
    return { ok: false, response: NextResponse.json({ error: "You don't have permission to manage products" }, { status: 403 }) };
  }
  return { ok: true, userId: user.id };
}

export function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
