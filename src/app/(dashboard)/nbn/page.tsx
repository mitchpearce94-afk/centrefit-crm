import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function NbnOverviewPage() {
  const supabase = await createClient();

  const [enquiryCountsRes] = await Promise.all([
    supabase
      .from("nbn_enquiries")
      .select("status", { count: "exact" }),
  ]);

  const all = (enquiryCountsRes.data ?? []) as { status: string }[];
  const newCount = all.filter((e) => e.status === "new").length;
  const contactedCount = all.filter((e) => e.status === "contacted").length;
  const quotedCount = all.filter((e) => e.status === "quoted").length;
  const convertedCount = all.filter((e) => e.status === "converted").length;

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="New enquiries" value={newCount} tone={newCount > 0 ? "warn" : "muted"} href="/nbn/enquiries?status=new" />
        <Stat label="Contacted" value={contactedCount} tone="neutral" />
        <Stat label="Quoted" value={quotedCount} tone="neutral" />
        <Stat label="Converted" value={convertedCount} tone="good" />
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Link
          href="/nbn/active-connections"
          className="rounded-lg border border-border bg-card p-5 hover:bg-accent/30 transition-colors"
        >
          <h2 className="text-sm font-semibold">Active Connections</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Every live NBN service under Centrefit&rsquo;s Kinetix account — status, tech,
            customer, install date. Pulled live from the Kinetix API.
          </p>
          <div className="mt-3 text-xs text-primary">View all →</div>
        </Link>

        <Link
          href="/nbn/enquiries"
          className="rounded-lg border border-border bg-card p-5 hover:bg-accent/30 transition-colors"
        >
          <h2 className="text-sm font-semibold">Enquiries</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Internet plan orders submitted from the website. Review, contact, and
            convert into customers and jobs.
          </p>
          <div className="mt-3 text-xs text-primary">
            {newCount > 0 ? `${newCount} new →` : "View all →"}
          </div>
        </Link>
      </div>

      <div className="mt-8 rounded-lg border border-dashed border-border p-5 text-xs text-muted-foreground">
        <h3 className="text-sm font-medium text-foreground">Coming soon</h3>
        <ul className="mt-2 space-y-1 list-disc pl-5">
          <li>Submit new NBN orders directly from the CRM (NCAS/NFAS/NHAS/NWAS)</li>
          <li>Appointment scheduling integrated with the CRM scheduler</li>
          <li>Service diagnostics (AVC/OVC test) on job tickets</li>
          <li>Outage detection per POI/service</li>
          <li>Webhook callbacks from NBN for real-time status updates</li>
        </ul>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "neutral" | "muted";
  href?: string;
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-400"
      : tone === "warn"
        ? "text-amber-400"
        : tone === "neutral"
          ? "text-foreground"
          : "text-muted-foreground";
  const body = (
    <>
      <div className={`text-2xl font-semibold ${toneClass}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">{label}</div>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-md border border-border bg-card px-4 py-3 hover:bg-accent/30 transition-colors block">
      {body}
    </Link>
  ) : (
    <div className="rounded-md border border-border bg-card px-4 py-3">{body}</div>
  );
}
