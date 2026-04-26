import { createClient } from "@/lib/supabase/server";
import type { StaffRole } from "@/lib/types";

export interface CurrentStaff {
  id: string;
  email: string;
  display_name: string;
  initials: string;
  role: StaffRole;
  is_active: boolean;
}

/**
 * Resolves the currently logged-in staff member. Returns null when the user
 * is unauthenticated or has no matching staff row.
 */
export async function getCurrentStaff(): Promise<CurrentStaff | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: staff } = await supabase
    .from("staff")
    .select("id, email, display_name, initials, role, is_active")
    .eq("id", user.id)
    .single();

  return (staff as CurrentStaff | null) ?? null;
}

/**
 * Convenience: true when the current user is admin.
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const staff = await getCurrentStaff();
  return staff?.role === "admin";
}

/**
 * Convenience: true when the current user is admin or finance_manager.
 */
export async function isCurrentUserFinance(): Promise<boolean> {
  const staff = await getCurrentStaff();
  return staff?.role === "admin" || staff?.role === "finance_manager";
}
