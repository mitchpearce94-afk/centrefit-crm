import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { SiteDetail } from "./site-detail";
import type { CustomerSite, CustomerContact, SiteAsset, AssetType } from "@/lib/types";
import { currentUserHasPermission } from "@/lib/auth/permissions";

interface VaultFolderForRefRow {
  folder_id: string;
  folder_name: string;
  is_personal: boolean;
  has_access: boolean;
  entry_count: number;
}

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const canVault = await currentUserHasPermission("vault.access");

  const [siteResult, contactsResult, jobsResult, assetsResult, assetTypesResult, keyInfoPhotosResult, vaultFoldersResult] = await Promise.all([
    supabase
      .from("customer_sites")
      .select(
        "*, customer:customers!customer_id(id, name)"
      )
      .eq("id", id)
      .single(),
    supabase
      .from("customer_contacts")
      .select("*")
      .eq("site_id", id)
      .order("is_primary", { ascending: false })
      .order("name"),
    supabase
      .from("jobs")
      .select(
        "id, number, reference, description, created_at, status:statuses(name, colour, phase)"
      )
      .eq("site_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("site_assets")
      .select("*")
      .eq("site_id", id)
      .order("is_active", { ascending: false })
      .order("device_type", { ascending: true, nullsFirst: false })
      .order("device_name", { ascending: true, nullsFirst: false }),
    supabase
      .from("asset_types")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("site_key_info_photos")
      .select("*")
      .eq("site_id", id)
      .order("created_at", { ascending: false }),
    canVault
      ? supabase.rpc("vault_folders_for_ref", { p_ref_type: "site", p_ref_id: id })
      : Promise.resolve({ data: [] as VaultFolderForRefRow[] }),
  ]);

  if (siteResult.error || !siteResult.data) {
    notFound();
  }

  const rawSite = siteResult.data as CustomerSite & {
    customer: { id: string; name: string } | { id: string; name: string }[] | null;
  };
  const site = {
    ...rawSite,
    customer: Array.isArray(rawSite.customer)
      ? rawSite.customer[0] ?? null
      : rawSite.customer,
  };
  const contacts = (contactsResult.data ?? []) as CustomerContact[];
  const jobs = jobsResult.data ?? [];
  const assets = (assetsResult.data ?? []) as SiteAsset[];
  const assetTypes = (assetTypesResult.data ?? []) as AssetType[];
  const keyInfoPhotos = (keyInfoPhotosResult.data ?? []) as Array<{
    id: string;
    site_id: string;
    url: string;
    caption: string | null;
    storage_path: string | null;
    uploaded_by: string | null;
    created_at: string;
  }>;
  const vaultFolders = (vaultFoldersResult.data ?? []) as VaultFolderForRefRow[];

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/sites" className="hover:text-foreground transition-colors">
              Sites
            </Link>
            <span>/</span>
            {site.customer && (
              <>
                <Link
                  href={`/customers/${site.customer.id}`}
                  className="hover:text-foreground transition-colors"
                >
                  {site.customer.name}
                </Link>
                <span>/</span>
              </>
            )}
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{site.name}</h1>
          <div className="mt-1 text-sm text-muted-foreground">
            {[site.address, site.suburb, site.state, site.postcode]
              .filter(Boolean)
              .join(", ") || "No address on file"}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <SiteDetail
          site={site}
          contacts={contacts}
          jobs={jobs as any}
          assets={assets}
          assetTypes={assetTypes}
          keyInfoPhotos={keyInfoPhotos}
          canVault={canVault}
          vaultFolders={vaultFolders}
        />
      </div>
    </div>
  );
}
