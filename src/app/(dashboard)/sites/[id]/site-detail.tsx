"use client";

import { useState } from "react";
import Link from "next/link";
import type { CustomerSite, CustomerContact, SiteAsset, AssetType } from "@/lib/types";
import { SiteEditForm } from "./site-edit-form";
import { SiteContactsList } from "./site-contacts-list";
import { SiteAssetsList } from "./site-assets-list";
import { KeyInfoPanel, type KeyInfoPhoto } from "./key-info-panel";

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
}: {
  site: CustomerSite & { customer: { id: string; name: string } | null };
  contacts: CustomerContact[];
  jobs: Job[];
  assets: SiteAsset[];
  assetTypes: AssetType[];
  keyInfoPhotos: KeyInfoPhoto[];
}) {
  const [tab, setTab] = useState<"details" | "contacts" | "jobs" | "assets" | "key-info">(
    "details"
  );

  const activeAssetCount = assets.filter((a) => a.is_active).length;
  const tabs: { key: typeof tab; label: string; count?: number }[] = [
    { key: "details", label: "Details" },
    { key: "contacts", label: "Contacts", count: contacts.length },
    { key: "jobs", label: "Jobs", count: jobs.length },
    { key: "assets", label: "Assets", count: activeAssetCount },
    { key: "key-info", label: "Key Information" },
  ];

  return (
    <div>
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {typeof t.count === "number" && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "details" && <SiteEditForm site={site} />}

        {tab === "contacts" && (
          <SiteContactsList
            siteId={site.id}
            customerId={site.customer_id}
            contacts={contacts}
          />
        )}

        {tab === "jobs" && (
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

        {tab === "assets" && (
          <SiteAssetsList siteId={site.id} assets={assets} assetTypes={assetTypes} />
        )}

        {tab === "key-info" && (
          <KeyInfoPanel
            siteId={site.id}
            assets={assets}
            assetTypes={assetTypes}
            photos={keyInfoPhotos}
          />
        )}
      </div>
    </div>
  );
}
