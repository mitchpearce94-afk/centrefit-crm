"use client";

import { Tabs } from "@/components/tabs";
import { ContactsList } from "./contacts-list";
import { SitesList } from "./sites-list";
import Link from "next/link";
import type { CustomerContact, CustomerSite } from "@/lib/types";

interface JobRow {
  id: string;
  number: string;
  reference: string | null;
  description: string | null;
  site: { id: string; name: string } | { id: string; name: string }[] | null;
  status: { name: string; colour: string; phase: string } | null;
  created_at: string;
  updated_at: string;
}

interface NoteRow {
  id: string;
  content: string;
  type: string;
  created_at: string;
  staff: { display_name: string; initials: string } | null;
}

interface PlanRow {
  id: string;
  status: string;
  source: string;
  next_invoice_date: string | null;
  customer_sites: { name: string } | { name: string }[] | null;
  recurring_plan_items: { service_name: string; price_inc_gst: number | string; frequency: string; quantity: number }[];
}

const PLAN_STATUS_COLOURS: Record<string, string> = {
  pending_mandate: "#fb923c",
  active: "#22c55e",
  paused: "#94a3b8",
  cancelled: "#64748b",
  failed: "#ef4444",
};

function planMonthly(items: PlanRow["recurring_plan_items"]): number {
  return items.reduce((s, i) => {
    const f = i.frequency === "yearly" ? 1 / 12 : i.frequency === "quarterly" ? 1 / 3 : 1;
    return s + Number(i.price_inc_gst) * (i.quantity ?? 1) * f;
  }, 0);
}

export function CustomerDetailTabs({
  customerId,
  customer,
  contacts,
  sites,
  jobs,
  notes,
  plans = [],
}: {
  customerId: string;
  customer: { notes: string | null };
  contacts: CustomerContact[];
  sites: CustomerSite[];
  jobs: JobRow[];
  notes: NoteRow[];
  plans?: PlanRow[];
}) {
  const livePlans = plans.filter((p) => p.status !== "cancelled");
  const tabs = [
    { id: "info", label: "Information" },
    { id: "contacts", label: "Contacts", count: contacts.length },
    { id: "sites", label: "Sites", count: sites.length },
    { id: "dd", label: "Direct Debits", count: livePlans.length },
    { id: "jobs", label: "Jobs", count: jobs.length },
    { id: "notes", label: "Notes", count: notes.length },
  ];

  return (
    <Tabs tabs={tabs} defaultTab="info">
      {(activeTab) => {
        switch (activeTab) {
          case "info":
            return (
              <div className="max-w-lg space-y-4">
                {customer.notes ? (
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-1">
                      Notes
                    </h3>
                    <p className="text-sm whitespace-pre-wrap">
                      {customer.notes}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No additional information.
                  </p>
                )}
              </div>
            );

          case "contacts":
            return (
              <div className="max-w-lg">
                <ContactsList
                  customerId={customerId}
                  contacts={contacts}
                />
              </div>
            );

          case "sites":
            return (
              <div className="max-w-lg">
                <SitesList customerId={customerId} sites={sites} />
              </div>
            );

          case "dd":
            return <DirectDebitsTab plans={plans} />;

          case "jobs":
            return <JobsTab jobs={jobs} />;

          case "notes":
            return <NotesTab notes={notes} />;

          default:
            return null;
        }
      }}
    </Tabs>
  );
}

function DirectDebitsTab({ plans }: { plans: PlanRow[] }) {
  if (plans.length === 0) {
    return (
      <div className="py-4">
        <p className="text-sm text-muted-foreground">No direct debits for this customer.</p>
        <Link href="/invoices/recurring/new" className="mt-2 inline-block text-sm text-primary hover:underline">
          Set up a recurring plan →
        </Link>
      </div>
    );
  }

  const live = plans.filter((p) => p.status !== "cancelled");
  const totalMonthly = live.reduce((s, p) => s + planMonthly(p.recurring_plan_items ?? []), 0);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">
          {live.length} plan{live.length === 1 ? "" : "s"} ·{" "}
          <span className="font-mono font-medium text-foreground">
            ${totalMonthly.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo
          </span>{" "}
          total recurring (incl. GST, yearly ÷ 12)
        </p>
        <Link href="/invoices/recurring/new" className="text-sm text-primary hover:underline">
          New plan →
        </Link>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Site</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">Services</th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">$/mo</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">Next charge</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => {
              const site = Array.isArray(p.customer_sites) ? p.customer_sites[0] : p.customer_sites;
              const items = p.recurring_plan_items ?? [];
              const colour = PLAN_STATUS_COLOURS[p.status] ?? "#6b7280";
              return (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5">
                    <Link href={`/invoices/recurring/${p.id}`} className="font-medium hover:text-primary transition-colors">
                      {site?.name ?? "—"}
                    </Link>
                    {p.source === "imported" && (
                      <span className="ml-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-medium text-sky-400">GC</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground hidden sm:table-cell max-w-[280px] truncate">
                    {items.slice(0, 3).map((i) => i.service_name).join(", ")}
                    {items.length > 3 ? ` +${items.length - 3} more` : ""}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    ${planMonthly(items).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize"
                      style={{ backgroundColor: `${colour}20`, color: colour }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colour }} />
                      {p.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">
                    {p.status === "active" && p.next_invoice_date
                      ? new Date(p.next_invoice_date).toLocaleDateString("en-AU")
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function JobsTab({ jobs }: { jobs: JobRow[] }) {
  if (jobs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No jobs for this customer yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              Job #
            </th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              Site
            </th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">
              Reference
            </th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              Status
            </th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground hidden md:table-cell">
              Created
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const site = Array.isArray(job.site) ? job.site[0] : job.site;
            return (
            <tr
              key={job.id}
              className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
            >
              <td className="px-4 py-2.5">
                <Link
                  href={`/jobs/${job.id}`}
                  className="font-medium text-foreground hover:text-primary transition-colors"
                >
                  {job.number}
                </Link>
              </td>
              <td className="px-4 py-2.5">
                {site ? (
                  <Link
                    href={`/sites/${site.id}`}
                    className="text-foreground hover:text-primary transition-colors"
                  >
                    {site.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                {job.reference || job.description?.slice(0, 50) || "—"}
              </td>
              <td className="px-4 py-2.5">
                {job.status && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{
                      backgroundColor: `${job.status.colour}20`,
                      color: job.status.colour,
                    }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: job.status.colour }}
                    />
                    {job.status.name}
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5 text-right text-muted-foreground hidden md:table-cell">
                {new Date(job.created_at).toLocaleDateString("en-AU")}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NotesTab({ notes }: { notes: NoteRow[] }) {
  if (notes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No notes for this customer yet.
      </p>
    );
  }

  return (
    <div className="space-y-3 max-w-2xl">
      {notes.map((note) => (
        <div
          key={note.id}
          className="rounded-lg border border-border bg-card p-3"
        >
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              {note.staff && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-medium text-primary">
                  {note.staff.initials}
                </span>
              )}
              <span>{note.staff?.display_name ?? "System"}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">
                {note.type}
              </span>
            </div>
            <span>
              {new Date(note.created_at).toLocaleDateString("en-AU")}{" "}
              {new Date(note.created_at).toLocaleTimeString("en-AU", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <p className="mt-2 text-sm whitespace-pre-wrap">{note.content}</p>
        </div>
      ))}
    </div>
  );
}
