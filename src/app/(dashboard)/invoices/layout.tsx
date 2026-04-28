import { InvoiceTabs } from "./invoice-tabs";

/**
 * Shared layout for /invoices/* — renders the tab nav (Invoices / Recurring)
 * above the active page's content. Each tab is its own route so URLs are
 * bookmarkable and server-rendered with no client hydration tax for switching.
 */
export default function InvoicesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <InvoiceTabs />
      <div>{children}</div>
    </div>
  );
}
