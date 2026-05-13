import Link from "next/link";

const SECTIONS: { name: string; href: string; description: string }[] = [
  {
    name: "Billing & Rates",
    href: "/settings/billing",
    description: "Labour rates, fixed costs, markup, and quote settings.",
  },
  {
    name: "Checklists",
    href: "/settings/checklists",
    description: "Field checklists and task templates.",
  },
  {
    name: "Electricians",
    href: "/settings/electricians",
    description: "Electrician contacts and routing.",
  },
  {
    name: "Notifications",
    href: "/settings/notifications",
    description: "Bell and email preferences per staff member.",
  },
  {
    name: "Products",
    href: "/settings/products",
    description: "Product catalogue, suppliers, and RFQ pricing.",
  },
  {
    name: "Recurring Services",
    href: "/settings/recurring-services",
    description: "Templates for recurring billing plans.",
  },
  {
    name: "Rules",
    href: "/settings/rules",
    description: "Automation rules and triggers.",
  },
  {
    name: "Scope Roles",
    href: "/settings/scope-roles",
    description: "Default roles surfaced in scope-of-works builder.",
  },
  {
    name: "Integrations",
    href: "/settings/integrations",
    description: "Xero, GoCardless, Resend, and other third-party connections.",
  },
];

export default function SettingsHubPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure how the CRM behaves for your team.
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-foreground">{section.name}</span>
              <svg
                className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
