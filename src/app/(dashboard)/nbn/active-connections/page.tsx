import { fetchActiveProducts, type ActiveProduct } from "@/lib/kinetix/client";

export const dynamic = "force-dynamic";
export const revalidate = 300; // 5 min cache

export default async function ActiveConnectionsPage() {
  let products: ActiveProduct[] = [];
  let error: string | null = null;
  try {
    const res = await fetchActiveProducts();
    products = res.products;
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error";
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-sm font-semibold">Active NBN connections</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {error
              ? "Couldn't fetch live data from Kinetix."
              : `${products.length} service${products.length === 1 ? "" : "s"} live under Centrefit's account.`}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 mb-4">
          {error}
        </div>
      )}

      {products.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
          No active connections returned by Kinetix. If this looks wrong, check the
          Kinetix partner portal directly.
        </div>
      )}

      {products.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left bg-muted/30 text-muted-foreground">
                <th className="px-3 py-2 font-medium">Service Ref</th>
                <th className="px-3 py-2 font-medium">Location</th>
                <th className="px-3 py-2 font-medium">Technology</th>
                <th className="px-3 py-2 font-medium">RSP Reference</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium text-right w-28">Activated</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => {
                const serviceRef = p.serviceRef ?? (p as Record<string, unknown>).avcId ?? p.id ?? `—`;
                const address = p.formattedAddress ?? (p as Record<string, unknown>).address ?? p.locationId ?? "—";
                const tech = p.technology ?? (p as Record<string, unknown>).primaryAccessTechnology ?? "—";
                const rspRef = p.rspReferenceId ?? (p as Record<string, unknown>).rspRef ?? "—";
                const status = p.status ?? (p as Record<string, unknown>).productStatus ?? "Active";
                const activated = p.activationDate ?? (p as Record<string, unknown>).activatedAt ?? null;
                return (
                  <tr key={String(serviceRef) + i} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono">{String(serviceRef)}</td>
                    <td className="px-3 py-2 max-w-[280px] truncate" title={String(address)}>{String(address)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{String(tech)}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{String(rspRef)}</td>
                    <td className="px-3 py-2">
                      <span className="rounded px-2 py-0.5 text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {String(status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {activated ? new Date(String(activated)).toLocaleDateString("en-AU") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[10px] text-subtle">Live data from Kinetix; cached for 5 minutes.</p>
    </div>
  );
}
