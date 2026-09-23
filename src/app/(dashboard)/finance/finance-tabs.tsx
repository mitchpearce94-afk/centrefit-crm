"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { name: "Payouts", href: "/finance" },
  { name: "Review", href: "/finance/review" },
  { name: "Contacts", href: "/finance/contacts" },
  { name: "Audit", href: "/finance/audit" },
  { name: "Settings", href: "/finance/settings" },
];

export function FinanceTabs() {
  const pathname = usePathname();
  return (
    <div className="border-b border-border">
      <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Finance sections">
        {TABS.map((t) => {
          const active = t.href === "/finance" ? pathname === "/finance" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${active ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t.name}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
