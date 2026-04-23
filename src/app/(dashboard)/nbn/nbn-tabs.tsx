"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/nbn", label: "Overview", match: (p: string) => p === "/nbn" },
  {
    href: "/nbn/active-connections",
    label: "Active Connections",
    match: (p: string) => p.startsWith("/nbn/active-connections"),
  },
  {
    href: "/nbn/enquiries",
    label: "Enquiries",
    match: (p: string) => p.startsWith("/nbn/enquiries"),
  },
];

export function NbnTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 -mb-px" aria-label="NBN sections">
      {tabs.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
