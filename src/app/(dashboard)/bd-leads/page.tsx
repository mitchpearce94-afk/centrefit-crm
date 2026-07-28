import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { LeadStatusSelect } from "./lead-status-select";

/**
 * BD lead pipeline — output of the nightly SEQ DA scanner plus any manual
 * channel leads (QLD growth phase 1, docs/qld-growth-CONTEXT.md).
 */

const SOURCE_LABEL: Record<string, string> = {
  brisbane: "Brisbane",
  goldcoast: "Gold Coast",
  ipswich: "Ipswich",
  redland: "Redland",
  logan: "Logan",
  moretonbay: "Moreton Bay",
  dwp: "DWP Electrical",
  manual: "Manual",
};

const STATUS_TABS = [
  { key: "new", label: "New" },
  { key: "reviewing", label: "Reviewing" },
  { key: "contacted", label: "Contacted" },
  { key: "quoted", label: "Quoted" },
  { key: "won", label: "Won" },
  { key: "dead", label: "Dead" },
] as const;

export default async function BdLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const tab = params.tab ?? "new";
  const supabase = await createClient();

  const { data: allLeads } = await supabase
    .from("bd_leads")
    .select("*")
    .neq("status", "ignored")
    .order("created_at", { ascending: false })
    .limit(500);

  const leads = (allLeads ?? []).filter((l) => l.status === tab);
  const countBy = (s: string) => (allLeads ?? []).filter((l) => l.status === s).length;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">BD Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Construction leads from the nightly SEQ development-application scanner.
            Childcare + commercial fitout focus (phase 1).
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-nowrap items-center gap-1 border-b border-border overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
        {STATUS_TABS.map((t) => {
          const active = tab === t.key;
          const count = countBy(t.key);
          return (
            <Link
              key={t.key}
              href={`/bd-leads?tab=${t.key}`}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {count > 0 && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="mt-4 space-y-2">
        {leads.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing in “{STATUS_TABS.find((t) => t.key === tab)?.label ?? tab}”.
            {tab === "new" && " The scanner runs nightly at 4am — new DAs land here."}
          </div>
        )}
        {leads.map((lead) => (
          <div key={lead.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{lead.address ?? lead.application_number}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {SOURCE_LABEL[lead.source] ?? lead.source}
                  </span>
                  {(lead.matched_keywords ?? []).map((k: string) => (
                    <span
                      key={k}
                      className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                    >
                      {k}
                    </span>
                  ))}
                </div>
                {lead.description && lead.description !== lead.address && (
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{lead.description}</p>
                )}
                <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
                  <span className="font-mono">{lead.application_number}</span>
                  {lead.use_type && <span>{lead.use_type}</span>}
                  {lead.applicant && <span>Applicant: {lead.applicant}</span>}
                  {lead.lodged_date && (
                    <span>Lodged {new Date(lead.lodged_date + "T00:00:00").toLocaleDateString("en-AU")}</span>
                  )}
                  {lead.decision_status && <span>{lead.decision_status}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {lead.url && (
                  <a
                    href={lead.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    Council ↗
                  </a>
                )}
                <LeadStatusSelect leadId={lead.id} status={lead.status} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
