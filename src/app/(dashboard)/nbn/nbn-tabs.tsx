"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/nbn", label: "Overview", match: (p: string) => p === "/nbn" },
  {
    href: "/nbn/services",
    label: "Services",
    match: (p: string) => p.startsWith("/nbn/services") || p.startsWith("/nbn/active-connections"),
  },
  {
    href: "/nbn/orders",
    label: "Orders",
    match: (p: string) => p.startsWith("/nbn/orders"),
  },
  {
    href: "/nbn/enquiries",
    label: "Enquiries",
    match: (p: string) => p.startsWith("/nbn/enquiries"),
  },
  {
    href: "/nbn/qualify",
    label: "Qualify",
    match: (p: string) => p.startsWith("/nbn/qualify"),
  },
  {
    href: "/nbn/fibre-uplift",
    label: "Fibre Uplift",
    match: (p: string) => p.startsWith("/nbn/fibre-uplift"),
  },
];

export function NbnTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 -mb-px overflow-x-auto" aria-label="NBN sections">
      {tabs.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
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
