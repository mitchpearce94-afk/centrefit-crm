// Permission system — companion to docs/permissions-CONTEXT.md.
// Mirrors the DB-side public.has_permission() function exactly so the same
// resolution runs on both layers.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { StaffRole } from "@/lib/types";

// Authoritative flag list. New flags ship via DB migration + an addition here
// so the TS compiler knows them. (OQ1 in CONTEXT — chosen "both" path.)
export const PERMISSION_FLAGS = [
  "customers.view", "customers.edit_basic", "customers.create",
  "customers.archive", "customers.edit_billing_terms",
  "sites.view", "sites.edit_basic", "sites.manage_assets",
  "sites.manage_contacts", "sites.edit_key_info",
  "jobs.view", "jobs.view_all", "jobs.update_status",
  "jobs.manage", "jobs.assign_others",
  "quoting.view", "quoting.view_amounts", "quoting.view_cost_prices",
  "quoting.create", "quoting.send", "quoting.accept_manually",
  "invoices.view", "invoices.view_amounts", "invoices.authorise",
  "invoices.send", "invoices.manage_recurring",
  "scheduler.view_all_team", "scheduler.manage", "scheduler.assign_others",
  "procurement.view", "procurement.view_costs", "procurement.manage", "procurement.receive",
  "plans.view", "plans.manage", "plans.send_to_electrician",
  "nbn.view", "nbn.manage", "nbn.view_recurring_revenue",
  "suppliers.view", "suppliers.view_pricing", "suppliers.manage",
  "reports.view_operational", "reports.view_financial",
  "settings.basic", "settings.staff", "settings.integrations",
  "settings.business_units", "settings.products", "settings.electricians",
  "settings.asset_types",
  "vault.access",
] as const;

export type PermissionFlag = (typeof PERMISSION_FLAGS)[number];

export interface StaffPermissionContext {
  staffId: string;
  role: StaffRole;
  /** Role default flag set, resolved from role_default_permissions. */
  defaults: Set<PermissionFlag>;
  /** Per-staff overrides — true = explicit grant, false = explicit revoke. */
  overrides: Map<PermissionFlag, boolean>;
}

/**
 * Resolves effective permission for the given context. Mirrors
 * public.has_permission() in SQL.
 *
 *  - admin role short-circuits to true
 *  - explicit override beats role default
 *  - else role default presence
 */
export function hasPermission(ctx: StaffPermissionContext, flag: PermissionFlag): boolean {
  if (ctx.role === "admin") return true;
  const ov = ctx.overrides.get(flag);
  if (ov !== undefined) return ov;
  return ctx.defaults.has(flag);
}

/**
 * Loads the permission context for the currently signed-in staff. Returns
 * null when unauthenticated or when there's no matching active staff row.
 *
 * Call this once at the top of a Server Component / Route Handler and pass
 * the resulting context to anything that needs to check flags.
 */
export async function loadCurrentPermissions(): Promise<StaffPermissionContext | null> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return loadPermissionsFor(supabase, user.id);
}

/**
 * Loads the permission context for an arbitrary staff_id. Caller is
 * responsible for any auth checks (use this only when the caller is an admin,
 * or when loading the caller's own permissions).
 */
export async function loadPermissionsFor(
  supabase: SupabaseClient,
  staffId: string,
): Promise<StaffPermissionContext | null> {
  const { data: staff } = await supabase
    .from("staff")
    .select("id, role, is_active")
    .eq("id", staffId)
    .single();
  if (!staff || !staff.is_active) return null;

  const role = staff.role as StaffRole;

  const [{ data: defaults }, { data: overrides }] = await Promise.all([
    supabase.from("role_default_permissions").select("flag").eq("role", role),
    supabase.from("staff_permissions").select("flag, granted").eq("staff_id", staffId),
  ]);

  return {
    staffId,
    role,
    defaults: new Set((defaults ?? []).map((r) => r.flag as PermissionFlag)),
    overrides: new Map(
      (overrides ?? []).map((r) => [r.flag as PermissionFlag, r.granted as boolean]),
    ),
  };
}

/**
 * Throws if the staff lacks the flag. Use in Route Handlers / Server Actions
 * for action-level (mutation) authorisation. For read routes that should
 * 404 on no-access, use `requirePermissionOrNotFound()` from the route
 * wrapper instead.
 */
export function assertPermission(
  ctx: StaffPermissionContext | null,
  flag: PermissionFlag,
): asserts ctx is StaffPermissionContext {
  if (!ctx) {
    throw new PermissionError("UNAUTHENTICATED", flag);
  }
  if (!hasPermission(ctx, flag)) {
    throw new PermissionError("FORBIDDEN", flag);
  }
}

export class PermissionError extends Error {
  readonly code: "UNAUTHENTICATED" | "FORBIDDEN";
  readonly flag: PermissionFlag;
  constructor(code: "UNAUTHENTICATED" | "FORBIDDEN", flag: PermissionFlag) {
    super(`Permission ${code} for flag '${flag}'`);
    this.code = code;
    this.flag = flag;
  }
}

// Quick one-shot helper for Server Components that only need a single flag
// and don't want to plumb the context through.
export async function currentUserHasPermission(flag: PermissionFlag): Promise<boolean> {
  const ctx = await loadCurrentPermissions();
  if (!ctx) return false;
  return hasPermission(ctx, flag);
}
