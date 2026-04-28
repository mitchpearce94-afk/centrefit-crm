"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/invoices",            label: "Invoices",  match: (p: string) => p === "/invoices" || (p.startsWith("/invoices/") && !p.startsWith("/invoices/recurring")) },
  { href: "/invoices/recurring",  label: "Recurring", match: (p: string) => p.startsWith("/invoices/recurring") },
];

/**
 * Tabbed navigation between the existing one-off invoice list and the new
 * recurring (direct-debit) plans list. Each tab is a real route so
 * deep-links work and server-rendered content doesn't need to be lifted
 * into client components just to switch.
 */
export function InvoiceTabs() {
  const pathname = usePathname();

  return (
    <div className="border-b border-border">
      <nav className="flex gap-1" aria-label="Invoice sections">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {active && (
                <span className="absolute inset-x-3 -bottom-px h-0.5 bg-primary" />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
