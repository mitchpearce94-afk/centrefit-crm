import { requireAnyPermissionOrNotFound } from "@/lib/auth/route-guards";

/**
 * /procurement/* gate. Field staff have procurement.receive but not
 * procurement.view by default. They need to land on the area to actually
 * mark stock received, so we gate on either flag.
 *
 * The page itself decides what to render based on which flag the staff
 * actually has — receive-only staff should ultimately get a stripped-down
 * receive UI. For now, the page falls through; tighten later.
 */
export default async function ProcurementLayout({ children }: { children: React.ReactNode }) {
  await requireAnyPermissionOrNotFound(["procurement.view", "procurement.receive"]);
  return <>{children}</>;
}
