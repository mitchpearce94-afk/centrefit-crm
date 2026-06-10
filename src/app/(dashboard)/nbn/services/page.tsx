import Link from "next/link";
import { fetchProductsByStatus, type ActiveProduct, type ProductStatusBucket } from "@/lib/kinetix/client";

export const dynamic = "force-dynamic";

const BUCKETS: { key: ProductStatusBucket; label: string; badge: string }[] = [
  { key: "active", label: "Active", badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  { key: "in_progress", label: "In Progress", badge: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  { key: "recently_disconnected", label: "Recently Disconnected", badge: "bg-red-500/10 text-red-400 border-red-500/20" },
];

export default async function NbnServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const bucket = (BUCKETS.find((b) => b.key === status)?.key ?? "active") as ProductStatusBucket;
  const active = BUCKETS.find((b) => b.key === bucket)!;

  let products: ActiveProduct[] = [];
  let error: string | null = null;
  try {
    products = await fetchProductsByStatus(bucket);
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error";
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold">NBN services</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {error ? "Couldn't fetch live data from Kinetix." : `${products.length} ${active.label.toLowerCase()} service${products.length === 1 ? "" : "s"} — live from Kinetix.`}
          </p>
        </div>
        <div className="flex gap-1">
          {BUCKETS.map((b) => (
            <Link
              key={b.key}
              href={`/nbn/services?status=${b.key}`}
              className={`rounded-full px-3 py-1 text-[11px] font-medium border transition-colors ${
                b.key === bucket
                  ? "bg-primary/15 text-foreground border-primary/40"
                  : "text-muted-foreground border-border hover:text-foreground"
              }`}
            >
              {b.label}
            </Link>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 mb-4">
          {error}
        </div>
      )}

      {products.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
          No {active.label.toLowerCase()} services returned by Kinetix.
        </div>
      )}

      {products.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left bg-muted/30 text-muted-foreground">
                <th className="px-3 py-2 font-medium">Service Ref</th>
                <th className="px-3 py-2 font-medium">Location</th>
                <th className="px-3 py-2 font-medium">Technology</th>
                <th className="px-3 py-2 font-medium">RSP Reference</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => {
                const r = p as Record<string, unknown>;
                const serviceRef = String(p.serviceRef ?? r.avcId ?? p.id ?? "—");
                const address = String(p.formattedAddress ?? r.address ?? p.locationId ?? "—");
                const tech = String(p.technology ?? r.primaryAccessTechnology ?? "—");
                const rspRef = String(p.rspReferenceId ?? r.rspRef ?? "—");
                const status = String(p.status ?? r.productStatus ?? active.label);
                return (
                  <tr key={serviceRef + i} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono">
                      {serviceRef !== "—" ? (
                        <Link href={`/nbn/services/${encodeURIComponent(serviceRef)}`} className="text-primary hover:underline">
                          {serviceRef}
                        </Link>
                      ) : serviceRef}
                    </td>
                    <td className="px-3 py-2 max-w-[280px] truncate" title={address}>{address}</td>
                    <td className="px-3 py-2 text-muted-foreground">{tech}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{rspRef}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-medium border ${active.badge}`}>{status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[10px] text-subtle">Live data from Kinetix. Click a service ref for diagnostics, outages and order history.</p>
    </div>
  );
}
