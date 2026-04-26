import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

interface Enquiry {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  plan_name: string | null;
  plan_speed: string | null;
  address: string;
  nbn_technology: string | null;
  status: string;
  created_at: string;
}

const STATUS_COLOUR: Record<string, string> = {
  new: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  contacted: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  quoted: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  converted: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  dismissed: "bg-muted text-muted-foreground border-border",
};

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusFilter } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("nbn_enquiries")
    .select("id, name, email, phone, company, plan_name, plan_speed, address, nbn_technology, status, created_at")
    .order("created_at", { ascending: false });

  if (statusFilter) query = query.eq("status", statusFilter);

  const { data, error } = await query;
  const enquiries = (data ?? []) as Enquiry[];

  const STATUSES = ["new", "contacted", "quoted", "converted", "dismissed"] as const;

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-sm font-semibold">Website NBN enquiries</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Orders submitted from the internet plans page. Action them here.
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/nbn/enquiries"
          className={`rounded-md px-3 py-1.5 text-xs font-medium border transition-colors ${
            !statusFilter
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card text-muted-foreground hover:bg-accent"
          }`}
        >
          All
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/nbn/enquiries?status=${s}`}
            className={`rounded-md px-3 py-1.5 text-xs font-medium border transition-colors capitalize ${
              statusFilter === s
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-accent"
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 mb-4">
          {error.message}
        </div>
      )}

      {enquiries.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
          No enquiries{statusFilter ? ` with status "${statusFilter}"` : ""} yet. When
          someone submits an internet order on the website, it&rsquo;ll land here.
        </div>
      )}

      {enquiries.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left bg-muted/30 text-muted-foreground">
                <th className="px-3 py-2 font-medium">Received</th>
                <th className="px-3 py-2 font-medium">Contact</th>
                <th className="px-3 py-2 font-medium">Plan</th>
                <th className="px-3 py-2 font-medium">Address / Tech</th>
                <th className="px-3 py-2 font-medium w-28">Status</th>
              </tr>
            </thead>
            <tbody>
              {enquiries.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-accent/30">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    <Link href={`/nbn/enquiries/${e.id}`} className="hover:text-foreground">
                      {new Date(e.created_at).toLocaleDateString("en-AU", {
                        day: "numeric",
                        month: "short",
                      })}
                      <div className="text-[10px] text-subtle">
                        {new Date(e.created_at).toLocaleTimeString("en-AU", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </div>
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/nbn/enquiries/${e.id}`} className="block hover:text-foreground">
                      <div className="font-medium">{e.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {e.email}
                        {e.phone && ` · ${e.phone}`}
                      </div>
                      {e.company && (
                        <div className="text-[10px] text-muted-foreground">{e.company}</div>
                      )}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {e.plan_name ? (
                      <>
                        <div>{e.plan_name}</div>
                        {e.plan_speed && (
                          <div className="text-[10px] text-muted-foreground font-mono">{e.plan_speed}</div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 max-w-[320px]">
                    <div className="truncate" title={e.address}>{e.address}</div>
                    {e.nbn_technology && (
                      <div className="text-[10px] text-muted-foreground">{e.nbn_technology}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded border px-2 py-0.5 text-[10px] font-medium capitalize ${
                        STATUS_COLOUR[e.status] ?? STATUS_COLOUR.dismissed
                      }`}
                    >
                      {e.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
