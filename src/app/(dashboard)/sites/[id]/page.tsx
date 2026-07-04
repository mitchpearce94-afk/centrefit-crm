import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { SiteDetail } from "./site-detail";
import type { CustomerSite, CustomerContact, SiteAsset, AssetType } from "@/lib/types";

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Hard-deleting an asset is admin-only at the RLS layer (site_assets_delete
  // USING is_admin()), so gate the Delete button on the same check — match the
  // is_admin() definition: staff row id = auth.uid() with role 'admin'.
  const { data: { user } } = await supabase.auth.getUser();
  let isAdmin = false;
  if (user) {
    const { data: viewerStaff } = await supabase
      .from("staff")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    isAdmin = viewerStaff?.role === "admin";
  }

  // Site first — the owner joins ride along; everything else keys off the
  // site id + backing customer id (site-first D2: the site IS the account).
  const siteResult = await supabase
    .from("customer_sites")
    .select("*, customer:customers!customer_id(id, name, abn, billing_email)")
    .eq("id", id)
    .single();

  if (siteResult.error || !siteResult.data) {
    notFound();
  }

  const rawSite = siteResult.data as CustomerSite & {
    customer:
      | { id: string; name: string; abn: string | null; billing_email: string | null }
      | { id: string; name: string; abn: string | null; billing_email: string | null }[]
      | null;
  };
  const site = {
    ...rawSite,
    customer: Array.isArray(rawSite.customer)
      ? rawSite.customer[0] ?? null
      : rawSite.customer,
  };
  const customerId = site.customer?.id ?? site.customer_id;

  const [
    contactsResult,
    ownerContactResult,
    jobsResult,
    quotesResult,
    invoicesResult,
    plansResult,
    assetsResult,
    assetTypesResult,
    keyInfoPhotosResult,
    documentsResult,
    planFilesResult,
    importJobResult,
  ] = await Promise.all([
    supabase
      .from("customer_contacts")
      .select("*")
      .eq("site_id", id)
      .order("is_primary", { ascending: false })
      .order("name"),
    supabase
      .from("customer_contacts")
      .select("id, name, email, phone, is_primary")
      .eq("customer_id", customerId)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("jobs")
      .select(
        "id, number, reference, description, created_at, status:statuses(name, colour, phase)"
      )
      .eq("site_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("quotes")
      .select("id, ref, status, expires_at, created_at, sent_at")
      .or(`site_id.eq.${id},customer_id.eq.${customerId}`)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("invoices")
      .select("id, xero_invoice_number, invoice_type, status, total, amount_due, due_date, created_at")
      .or(`site_id.eq.${id},customer_id.eq.${customerId}`)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("recurring_plans")
      .select("id, status, next_invoice_date, created_at, recurring_plan_items(service_name, price_inc_gst, frequency, quantity)")
      .or(`site_id.eq.${id},customer_id.eq.${customerId}`)
      .order("created_at", { ascending: false })
      .limit(20),
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
    supabase
      .from("site_documents")
      .select("id, category, name, storage_path, mime_type, size_bytes, status, version, created_at, uploader:staff!uploaded_by(display_name)")
      .eq("site_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("plan_files")
      .select("id, name, state, revision, pdf_url, updated_at")
      .eq("site_id", id)
      .order("updated_at", { ascending: false }),
    // Job for THIS site to power the "Import from BOM" button on the Assets
    // tab. Prefer the most recent accepted quote; fall back to the latest
    // quote of any status (so it still shows on jobs whose quote is draft).
    supabase
      .from("quotes")
      .select("job_id, accepted_at, created_at, jobs!inner(site_id, number)")
      .eq("jobs.site_id", id)
      .not("job_id", "is", null)
      .order("accepted_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const contacts = (contactsResult.data ?? []) as CustomerContact[];
  const ownerContact = ownerContactResult.data as
    | { id: string; name: string | null; email: string | null; phone: string | null }
    | null;
  const jobs = jobsResult.data ?? [];
  const quotes = quotesResult.data ?? [];
  const invoices = invoicesResult.data ?? [];
  const plans = plansResult.data ?? [];
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
  const documents = (documentsResult.data ?? []).map((d: Record<string, unknown>) => ({
    ...d,
    uploader: Array.isArray(d.uploader) ? d.uploader[0] ?? null : d.uploader,
  })) as import("./site-documents-panel").SiteDocumentRow[];
  const planFiles = (planFilesResult.data ?? []) as import("./site-documents-panel").SitePlanFileRow[];
  const importJobId = (importJobResult.data as { job_id: string | null } | null)?.job_id ?? null;

  const activePlanCount = (plans as { status: string }[]).filter((p) =>
    ["active", "pending_mandate", "paused"].includes(p.status),
  ).length;

  return (
    <div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/sites" className="hover:text-foreground transition-colors">
            Sites
          </Link>
          <span>/</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{site.name}</h1>
        <div className="mt-1 text-sm text-muted-foreground">
          {[site.address, site.suburb, site.state, site.postcode]
            .filter(Boolean)
            .join(", ") || "No address on file"}
        </div>
      </div>

      <div className="mt-6">
        <SiteDetail
          site={site}
          owner={
            site.customer
              ? {
                  id: site.customer.id,
                  name: site.customer.name,
                  abn: site.customer.abn ?? null,
                  billing_email: site.customer.billing_email ?? null,
                  invoiceName: (site as { invoice_name?: string | null }).invoice_name ?? null,
                  contactName: ownerContact?.name ?? null,
                  contactEmail: ownerContact?.email ?? null,
                  contactPhone: ownerContact?.phone ?? null,
                }
              : null
          }
          activePlanCount={activePlanCount}
          contacts={contacts}
          jobs={jobs as any}
          quotes={quotes as any}
          invoices={invoices as any}
          plans={plans as any}
          assets={assets}
          assetTypes={assetTypes}
          keyInfoPhotos={keyInfoPhotos}
          documents={documents}
          planFiles={planFiles}
          isAdmin={isAdmin}
          importJobId={importJobId}
        />
      </div>
    </div>
  );
}
