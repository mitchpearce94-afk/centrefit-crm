"use client";

import Link from "next/link";
import type { CustomerSite, CustomerContact, SiteAsset, AssetType } from "@/lib/types";
import { Tabs } from "@/components/tabs";
import { SiteEditForm } from "./site-edit-form";
import { SiteContactsList } from "./site-contacts-list";
import { SiteAssetsList } from "./site-assets-list";
import { KeyInfoPanel, type KeyInfoPhoto } from "./key-info-panel";
import { SiteVaultPanel, type VaultFolderForRefRow } from "./site-vault-panel";

type Job = {
  id: string;
  number: string;
  reference: string | null;
  description: string | null;
  created_at: string;
  status: { name: string; colour: string | null; phase: string | null } | null;
};

export function SiteDetail({
  site,
  contacts,
  jobs,
  assets,
  assetTypes,
  keyInfoPhotos,
  canVault,
  vaultFolders,
  isAdmin,
}: {
  site: CustomerSite & { customer: { id: string; name: string } | null };
  contacts: CustomerContact[];
  jobs: Job[];
  assets: SiteAsset[];
  assetTypes: AssetType[];
  keyInfoPhotos: KeyInfoPhoto[];
  canVault: boolean;
  vaultFolders: VaultFolderForRefRow[];
  isAdmin: boolean;
}) {
  const activeAssetCount = assets.filter((a) => a.is_active).length;
  const tabs = [
    { id: "details", label: "Details" },
    { id: "contacts", label: "Contacts", count: contacts.length },
    { id: "jobs", label: "Jobs", count: jobs.length },
    { id: "assets", label: "Assets", count: activeAssetCount },
    { id: "key-info", label: "Key Information", count: keyInfoPhotos.length },
    ...(canVault ? [{ id: "vault", label: "Vault", count: vaultFolders.length }] : []),
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

          {activeTab === "assets" && (
            <SiteAssetsList siteId={site.id} assets={assets} assetTypes={assetTypes} isAdmin={isAdmin} />
          )}

          {activeTab === "key-info" && (
            <KeyInfoPanel
              siteId={site.id}
              assets={assets}
              assetTypes={assetTypes}
              photos={keyInfoPhotos}
            />
          )}

          {activeTab === "vault" && canVault && (
            <SiteVaultPanel siteId={site.id} initialFolders={vaultFolders} />
          )}
        </>
      )}
    </Tabs>
  );
}
