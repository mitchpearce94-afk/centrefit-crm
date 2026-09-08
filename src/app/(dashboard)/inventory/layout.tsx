import { requireAnyPermissionOrNotFound } from "@/lib/auth/route-guards";

/** /inventory gate — view or manage. 404s for anyone else (docs/inventory-CONTEXT.md D7). */
export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  await requireAnyPermissionOrNotFound(["inventory.view", "inventory.manage"]);
  return <>{children}</>;
}
