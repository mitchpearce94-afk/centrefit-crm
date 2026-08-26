import { createClient } from "@/lib/supabase/server";
import { ReceiptsClient } from "./receipts-client";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  const supabase = await createClient();

  const { data: jobsData } = await supabase
    .from("jobs")
    .select("id, number, customer:customers(name), site:customer_sites(name)")
    .order("created_at", { ascending: false })
    .limit(300);

  const jobs = ((jobsData ?? []) as unknown as {
    id: string;
    number: string | null;
    customer: { name: string } | null;
    site: { name: string | null } | null;
  }[]).map((j) => ({
    id: j.id,
    number: j.number,
    label: [j.number, j.site?.name ?? j.customer?.name].filter(Boolean).join(" · "),
  }));

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Receipts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Scan a receipt → choose a job (or not) → done. It&rsquo;s emailed to accounts either way.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          On your phone use the <a href="/snap" className="font-medium text-primary hover:underline">Receipts app</a> — open crm.centrefit.com.au/snap in Safari, Share → Add to Home Screen. Icon → shutter → done.
        </p>
      </div>
      <div className="mt-5">
        <ReceiptsClient jobs={jobs} />
      </div>
    </div>
  );
}
