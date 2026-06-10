import Link from "next/link";
import { fetchProductsByStatus, type ActiveProduct, type ProductStatusBucket } from "@/lib/kinetix/client";
import { ServicesTable, type ServiceRow } from "./services-table";

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

  let rows: ServiceRow[] = [];
  let error: string | null = null;
  try {
    const products = await fetchProductsByStatus(bucket);
    rows = products.map((p: ActiveProduct) => {
      const services = (p as { services?: Array<{ id?: string }> }).services ?? [];
      const avc = services.find((s) => typeof s?.id === "string" && s.id.startsWith("AVC"));
      return {
        productId: String(p.id ?? ""),
        serviceRef: avc?.id ?? null,
        productType: ((p as Record<string, unknown>).productType as string) ?? null,
      };
    }).filter((r) => r.productId);
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error";
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold">NBN services</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {error ? "Couldn't fetch live data from Kinetix." : `${rows.length} ${active.label.toLowerCase()} service${rows.length === 1 ? "" : "s"} — live from Kinetix.`}
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

      {rows.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
          No {active.label.toLowerCase()} services returned by Kinetix.
        </div>
      )}

      {rows.length > 0 && <ServicesTable rows={rows} badge={active.badge} />}

      <p className="mt-3 text-[10px] text-subtle">Live data from Kinetix. Click a service ref for diagnostics, outages and order history.</p>
    </div>
  );
}
