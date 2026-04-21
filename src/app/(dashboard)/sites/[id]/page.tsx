import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { SiteDetail } from "./site-detail";
import type { CustomerSite, CustomerContact } from "@/lib/types";

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [siteResult, contactsResult, jobsResult] = await Promise.all([
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
        <SiteDetail site={site} contacts={contacts} jobs={jobs as any} />
      </div>
    </div>
  );
}
