// Route-level permission guards. Companion to lib/auth/permissions.ts.
// Used in Server Components for the dashboard routes.
//
// Hide / 404 / 403 rule (per docs/permissions-CONTEXT.md D10):
//   - hide nav: filter the sidebar in the layout
//   - 404 (notFound): the staff has no view permission for the route at all
//                     — don't leak that the feature exists
//   - 403: staff CAN view the page but is trying a write action they're not
//          allowed (handled at the Route Handler / Server Action layer, not here)

import { notFound } from "next/navigation";
import {
  loadCurrentPermissions,
  hasPermission,
  type PermissionFlag,
  type StaffPermissionContext,
} from "./permissions";

/**
 * Server Component guard: returns the permissions context if the current
 * staff has the required flag, otherwise triggers a 404. Use at the top of
 * any (dashboard)/<area>/page.tsx that requires view permission.
 *
 *   const perms = await requirePermissionOrNotFound("quoting.view");
 */
export async function requirePermissionOrNotFound(
  flag: PermissionFlag,
): Promise<StaffPermissionContext> {
  const ctx = await loadCurrentPermissions();
  if (!ctx || !hasPermission(ctx, flag)) {
    notFound();
  }
  return ctx;
}

/**
 * Same as requirePermissionOrNotFound, but the page requires ANY of the
 * listed flags (OR logic). Useful for areas like Reports where either the
 * operational or financial flag should be enough to land on the index page.
 */
export async function requireAnyPermissionOrNotFound(
  flags: PermissionFlag[],
): Promise<StaffPermissionContext> {
  const ctx = await loadCurrentPermissions();
  if (!ctx || !flags.some((f) => hasPermission(ctx, f))) {
    notFound();
  }
  return ctx;
}
