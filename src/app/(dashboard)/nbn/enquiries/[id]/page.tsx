import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EnquiryActions } from "./enquiry-actions";

export default async function EnquiryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: enquiry, error } = await supabase
    .from("nbn_enquiries")
    .select(`
      *,
      customer:customers(id, name),
      job:jobs(id, number),
      staff:assigned_to(id, display_name)
    `)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!enquiry) notFound();

  const speedTiers = (enquiry.nbn_speed_tiers ?? []) as string[];

  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link href="/nbn/enquiries" className="hover:text-foreground">Enquiries</Link>
        <span>/</span>
        <span>{enquiry.name}</span>
      </div>

      <div className="mt-2 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{enquiry.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Received {new Date(enquiry.created_at).toLocaleString("en-AU")}
          </p>
        </div>
        <EnquiryActions
          enquiryId={enquiry.id}
          currentStatus={enquiry.status}
          customerId={enquiry.customer_id}
          jobId={enquiry.job_id}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <section className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Contact</h3>
              {enquiry.customer_type && (
                <span className="rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-primary/10 text-primary border border-primary/20">
                  {enquiry.customer_type}
                </span>
              )}
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <Field label="Name" value={enquiry.name} />
              <Field label="Email" value={<a href={`mailto:${enquiry.email}`} className="text-primary hover:underline">{enquiry.email}</a>} />
              {enquiry.phone && (
                <Field label="Phone" value={<a href={`tel:${enquiry.phone}`} className="text-primary hover:underline">{enquiry.phone}</a>} />
              )}
              {enquiry.company && <Field label="Company" value={enquiry.company} />}

              {/* Residential-only */}
              {enquiry.customer_type === "residential" && (
                <>
                  {enquiry.dob && <Field label="Date of Birth" value={new Date(enquiry.dob).toLocaleDateString("en-AU")} />}
                  {enquiry.id_type && <Field label="ID Type" value={enquiry.id_type === "drivers" ? "Driver's Licence" : enquiry.id_type === "passport" ? "Passport" : enquiry.id_type} />}
                  {enquiry.id_number && <Field label="ID Number" value={<span className="font-mono text-xs">{enquiry.id_number}</span>} />}
                </>
              )}

              {/* Business-only */}
              {enquiry.customer_type === "business" && (
                <>
                  {enquiry.abn && <Field label="ABN" value={<span className="font-mono text-xs">{enquiry.abn}</span>} />}
                  {enquiry.trading_name && <Field label="Trading Name" value={enquiry.trading_name} />}
                </>
              )}
            </dl>
          </section>

          <section className="rounded-lg border border-border bg-card p-5">
            <h3 className="text-sm font-semibold mb-3">Plan &amp; address</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {enquiry.plan_name && (
                <Field
                  label="Plan"
                  value={
                    <div>
                      {enquiry.plan_name}
                      {enquiry.plan_speed && <span className="text-muted-foreground"> · {enquiry.plan_speed}</span>}
                      {enquiry.plan_price && <span className="text-muted-foreground"> · {enquiry.plan_price}</span>}
                    </div>
                  }
                />
              )}
              <Field label="Address" value={enquiry.address} />
              {enquiry.nbn_loc_id && <Field label="NBN LOC ID" value={<span className="font-mono text-xs">{enquiry.nbn_loc_id}</span>} />}
              {enquiry.nbn_technology && <Field label="Technology" value={enquiry.nbn_technology} />}
              {speedTiers.length > 0 && <Field label="Speed tiers" value={speedTiers.join(", ")} />}
              {enquiry.nbn_region && <Field label="Region" value={enquiry.nbn_region} />}
            </dl>
          </section>

          {enquiry.notes && (
            <section className="rounded-lg border border-border bg-card p-5">
              <h3 className="text-sm font-semibold mb-3">Notes</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{enquiry.notes}</p>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
            <div className="mt-1 text-sm font-medium capitalize">{enquiry.status}</div>
          </div>
          {enquiry.customer && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Customer</div>
              <Link href={`/customers/${enquiry.customer.id}`} className="mt-1 block text-sm text-primary hover:underline">
                {enquiry.customer.name} →
              </Link>
            </div>
          )}
          {enquiry.job && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Job</div>
              <Link href={`/jobs/${enquiry.job.id}`} className="mt-1 block text-sm text-primary hover:underline">
                CFA-{enquiry.job.number} →
              </Link>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
