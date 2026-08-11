"use client";

import Link from "next/link";
import type { CustomerSite, CustomerContact, SiteAsset, AssetType } from "@/lib/types";
import { Tabs } from "@/components/tabs";
import { SiteEditForm } from "./site-edit-form";
import { OwnerCard, type OwnerInfo } from "./owner-card";
import { SiteContactsList } from "./site-contacts-list";
import { SiteAssetsList } from "./site-assets-list";
import { KeyInfoPanel, type KeyInfoPhoto } from "./key-info-panel";
import { SiteDocumentsPanel, type SiteDocumentRow, type SitePlanFileRow, type SignRequestRow, type MonitoringProfileSummary } from "./site-documents-panel";

type Job = {
  id: string;
  number: string;
  reference: string | null;
  description: string | null;
  created_at: string;
  status: { name: string; colour: string | null; phase: string | null } | null;
};

type Quote = {
  id: string;
  ref: string;
  status: string;
  expires_at: string | null;
  created_at: string;
  sent_at: string | null;
};

type Invoice = {
  id: string;
  xero_invoice_number: string | null;
  invoice_type: string;
  status: string;
  total: number | string;
  amount_due: number | string;
  due_date: string | null;
  created_at: string;
};

type Plan = {
  id: string;
  status: string;
  next_invoice_date: string | null;
  created_at: string;
  recurring_plan_items: { service_name: string; price_inc_gst: number | string; frequency: string; quantity: number | null }[];
};

const QUOTE_COLOURS: Record<string, string> = {
  draft: "#6b7280", sent: "#3b82f6", accepted: "#22c55e", invoiced: "#06b6d4", declined: "#ef4444", expired: "#f59e0b",
};
const INVOICE_COLOURS: Record<string, string> = {
  draft: "#6b7280", authorised: "#3b82f6", paid: "#22c55e", void: "#ef4444",
};
const PLAN_COLOURS: Record<string, string> = {
  active: "#22c55e", pending_mandate: "#f59e0b", paused: "#6b7280", cancelled: "#ef4444",
};

// Monthly-equivalent factor, mirroring the recurring list page.
function monthlyFactor(freq: string): number {
  if (freq === "quarterly") return 1 / 3;
  if (freq === "yearly") return 0;
  return 1;
}

function StatusPill({ label, colour }: { label: string; colour: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium capitalize"
      style={{ backgroundColor: `${colour}20`, color: colour }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colour }} />
      {label.replace(/_/g, " ")}
    </span>
  );
}

export function SiteDetail({
  site,
  owner,
  activePlanCount,
  contacts,
  jobs,
  quotes,
  invoices,
  plans,
  assets,
  assetTypes,
  keyInfoPhotos,
  documents,
  planFiles,
  signRequests,
  monitoringProfile,
  staffList,
  viewerId,
  isAdmin,
  importJobId,
}: {
  site: CustomerSite & { customer: { id: string; name: string } | null };
  owner: OwnerInfo | null;
  activePlanCount: number;
  contacts: CustomerContact[];
  jobs: Job[];
  quotes: Quote[];
  invoices: Invoice[];
  plans: Plan[];
  assets: SiteAsset[];
  assetTypes: AssetType[];
  keyInfoPhotos: KeyInfoPhoto[];
  documents: SiteDocumentRow[];
  planFiles: SitePlanFileRow[];
  signRequests: SignRequestRow[];
  monitoringProfile: MonitoringProfileSummary | null;
  staffList: import("./swms-generate-modal").SwmsStaffOption[];
  viewerId: string;
  isAdmin: boolean;
  importJobId: string | null;
}) {
  const activeAssetCount = assets.filter((a) => a.is_active).length;
  const activePlans = plans.filter((p) => p.status !== "cancelled");
  const tabs = [
    { id: "details", label: "Details" },
    ...(owner ? [{ id: "owner", label: "Owner" }] : []),
    { id: "contacts", label: "Contacts", count: contacts.length },
    { id: "jobs", label: "Jobs", count: jobs.length },
    { id: "quotes", label: "Quotes", count: quotes.length },
    { id: "invoices", label: "Invoices", count: invoices.length },
    { id: "billing", label: "Billing", count: activePlans.length },
    { id: "assets", label: "Assets", count: activeAssetCount },
    { id: "key-info", label: "Key Information", count: keyInfoPhotos.length },
    { id: "documentation", label: "Documentation", count: documents.length + planFiles.length },
  ];

  // Uses shared <Tabs> so we get the native-select tab picker on mobile
  // (the rolled-our-own horizontal flex strip overflowed at 375px because
  // six labels couldn't fit at full padding). Desktop renders the
  // horizontal strip with a scroll fallback.
  return (
    <Tabs tabs={tabs} defaultTab="details">
      {(activeTab) => (
        <>
          {activeTab === "details" && <SiteEditForm site={site} />}

          {activeTab === "owner" && owner && (
            <div className="max-w-xl">
              <OwnerCard
                siteId={site.id}
                owner={owner}
                activePlanCount={activePlanCount}
                isAdmin={isAdmin}
              />
            </div>
          )}

          {activeTab === "contacts" && (
            <SiteContactsList
              siteId={site.id}
              customerId={site.customer_id}
              contacts={contacts}
            />
          )}

          {activeTab === "jobs" && (
            <div>
              {jobs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6">
                  No jobs at this site yet.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                          Job
                        </th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">
                          Description
                        </th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((j) => (
                        <tr
                          key={j.id}
                          className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-4 py-2.5">
                            <Link
                              href={`/jobs/${j.id}`}
                              className="font-medium text-foreground hover:text-primary"
                            >
                              {j.number}
                            </Link>
                            {j.reference && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {j.reference}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell truncate max-w-[320px]">
                            {j.description ?? "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            {j.status ? (
                              <span
                                className="rounded px-2 py-0.5 text-xs font-medium"
                                style={{
                                  backgroundColor: `${j.status.colour ?? "#888"}22`,
                                  color: j.status.colour ?? undefined,
                                }}
                              >
                                {j.status.name}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === "quotes" && (
            <div>
              {quotes.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6">No quotes for this site yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Ref</th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground hidden sm:table-cell">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quotes.map((q) => (
                        <tr key={q.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2.5">
                            <Link href={`/quoting/${q.id}`} className="font-mono font-medium text-foreground hover:text-primary">
                              {q.ref}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusPill label={q.status} colour={QUOTE_COLOURS[q.status] ?? "#6b7280"} />
                          </td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground hidden sm:table-cell">
                            {new Date(q.created_at).toLocaleDateString("en-AU")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === "invoices" && (
            <div>
              {invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6">No invoices for this site yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Invoice</th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Total</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground hidden sm:table-cell">Due</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground hidden md:table-cell">Due date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2.5">
                            <Link href={`/invoices/${inv.id}`} className="font-mono font-medium text-foreground hover:text-primary">
                              {inv.xero_invoice_number ?? inv.id.slice(0, 8)}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusPill label={inv.status} colour={INVOICE_COLOURS[inv.status] ?? "#6b7280"} />
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono">${Number(inv.total).toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-right font-mono hidden sm:table-cell">
                            {Number(inv.amount_due) > 0 ? `$${Number(inv.amount_due).toFixed(2)}` : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground hidden md:table-cell">
                            {inv.due_date ? new Date(inv.due_date + "T00:00:00").toLocaleDateString("en-AU") : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === "billing" && (
            <div>
              {plans.length === 0 ? (
                <div className="py-6">
                  <p className="text-sm text-muted-foreground">No recurring billing on this site.</p>
                  <Link
                    href={`/invoices/recurring/new?site=${site.id}`}
                    className="mt-2 inline-block text-sm text-primary hover:underline"
                  >
                    + Set up a recurring plan
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50">
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Services</th>
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                          <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Monthly</th>
                          <th className="px-4 py-2.5 text-right font-medium text-muted-foreground hidden sm:table-cell">Yearly</th>
                          <th className="px-4 py-2.5 text-right font-medium text-muted-foreground hidden md:table-cell">Next invoice</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plans.map((p) => {
                          const items = p.recurring_plan_items ?? [];
                          const monthly = items
                            .filter((i) => i.frequency !== "yearly")
                            .reduce((s, i) => s + Number(i.price_inc_gst) * (i.quantity ?? 1) * monthlyFactor(i.frequency), 0);
                          const yearly = items
                            .filter((i) => i.frequency === "yearly")
                            .reduce((s, i) => s + Number(i.price_inc_gst) * (i.quantity ?? 1), 0);
                          return (
                            <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                              <td className="px-4 py-2.5">
                                <Link href={`/invoices/recurring/${p.id}`} className="font-medium text-foreground hover:text-primary">
                                  {items.length === 0
                                    ? "Plan"
                                    : items.slice(0, 3).map((i) => i.service_name).join(", ") +
                                      (items.length > 3 ? ` +${items.length - 3} more` : "")}
                                </Link>
                              </td>
                              <td className="px-4 py-2.5">
                                <StatusPill label={p.status} colour={PLAN_COLOURS[p.status] ?? "#6b7280"} />
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono">
                                {monthly > 0 ? `$${monthly.toFixed(2)}` : "—"}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono hidden sm:table-cell">
                                {yearly > 0 ? `$${yearly.toFixed(2)}` : "—"}
                              </td>
                              <td className="px-4 py-2.5 text-right text-muted-foreground hidden md:table-cell">
                                {p.next_invoice_date ? new Date(p.next_invoice_date + "T00:00:00").toLocaleDateString("en-AU") : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Link
                    href={`/invoices/recurring/new?site=${site.id}`}
                    className="inline-block text-sm text-primary hover:underline"
                  >
                    + New recurring plan for this site
                  </Link>
                </div>
              )}
            </div>
          )}

          {activeTab === "assets" && (
            <SiteAssetsList siteId={site.id} assets={assets} assetTypes={assetTypes} isAdmin={isAdmin} importJobId={importJobId} />
          )}

          {activeTab === "key-info" && (
            <KeyInfoPanel
              siteId={site.id}
              assets={assets}
              assetTypes={assetTypes}
              photos={keyInfoPhotos}
              notes={site.key_info_notes ?? null}
              ifobUsers={site.ifob_users ?? []}
            />
          )}

          {activeTab === "documentation" && (
            <SiteDocumentsPanel
              siteId={site.id}
              documents={documents}
              planFiles={planFiles}
              signRequests={signRequests}
              monitoringProfile={monitoringProfile}
              defaultRecipientName={owner?.contactName ?? null}
              defaultRecipientEmail={owner?.billing_email ?? owner?.contactEmail ?? null}
              swmsJobs={jobs.map((j) => ({ id: j.id, number: j.number, reference: j.reference }))}
              staffList={staffList}
              viewerId={viewerId}
              swmsPcbuDefaults={{
                name: owner?.invoiceName ?? owner?.name ?? site.name,
                abn: owner?.abn ?? "",
                address: [site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(", "),
                keyReps: contacts.filter((c) => c.name).slice(0, 3).map((c) => c.name).join(", "),
              }}
              wifiNetworks={Array.from(
                new Set(
                  assets.flatMap((a) =>
                    ((a as { wifi_ssids?: Array<{ ssid?: string; password?: string | null }> }).wifi_ssids ?? [])
                      .filter((w) => w?.ssid && w?.password)
                      .map((w) => w.ssid as string),
                  ),
                ),
              )}
              isAdmin={isAdmin}
            />
          )}
        </>
      )}
    </Tabs>
  );
}
