import "server-only";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Finance section access (docs/finance-CONTEXT.md D1): Mitchell's login, or a
// staff id on finance_settings.viewer_staff_ids. Admin role is NOT enough —
// Mark is admin and Mitchell wants this door closed until he opens it. RLS
// (public.is_finance_viewer) enforces the same rule on the tables.
export const FINANCE_OWNER_EMAIL = "mitchell@centrefit.com.au";

export interface FinanceViewer {
  userId: string;
  email: string;
  isOwner: boolean;
}

export async function loadFinanceViewer(supabase?: SupabaseClient): Promise<FinanceViewer | null> {
  const sb = supabase ?? (await createClient());
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) return null;
  const email = user.email.toLowerCase();
  if (email === FINANCE_OWNER_EMAIL) return { userId: user.id, email, isOwner: true };
  const { data } = await sb.from("finance_settings").select("viewer_staff_ids").eq("id", 1).maybeSingle();
  const ids = (data?.viewer_staff_ids as string[] | null) ?? [];
  return ids.includes(user.id) ? { userId: user.id, email, isOwner: false } : null;
}

/** Server Component guard: 404 for anyone who can't see Finance (D1). */
export async function requireFinanceViewerOrNotFound(): Promise<FinanceViewer> {
  const v = await loadFinanceViewer();
  if (!v) notFound();
  return v;
}

/** Route Handler guard: returns the viewer or null (caller responds 404). */
export async function financeViewerOrNull(): Promise<FinanceViewer | null> {
  return loadFinanceViewer();
}
