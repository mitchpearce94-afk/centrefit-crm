import { InvoiceTabs } from "./invoice-tabs";
import { requirePermissionOrNotFound } from "@/lib/auth/route-guards";

/**
 * Shared layout for /invoices/* — renders the tab nav (Invoices / Recurring)
 * above the active page's content. Each tab is its own route so URLs are
 * bookmarkable and server-rendered with no client hydration tax for switching.
 *
 * Permission-gated: staff without invoices.view see a 404 (per D10 — don't
 * leak that the feature exists). Sub-routes inherit because Next runs the
 * layout before the page.
 */
export default async function InvoicesLayout({ children }: { children: React.ReactNode }) {
  await requirePermissionOrNotFound("invoices.view");
  return (
    <div className="space-y-6">
      <InvoiceTabs />
      <div>{children}</div>
    </div>
  );
}
