import { fetchFibreUpliftLocations } from "@/lib/kinetix/client";
import { UpliftChecker } from "./uplift-checker";

export const dynamic = "force-dynamic";

/**
 * NBN fibre-uplift eligibility. The account-wide locations list is
 * permission-gated on our Kinetix API key (403) — until Kinetix enables it,
 * the per-address checker below covers the same question one site at a time.
 */
export default async function FibreUpliftPage() {
  let locations: unknown[] = [];
  let error: string | null = null;
  let permissionGated = false;
  try {
    locations = await fetchFibreUpliftLocations();
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error";
    permissionGated = /permission to access the requested resource/i.test(error);
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-sm font-semibold">Fibre uplift</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {error ? "Check any address for fibre-upgrade eligibility." : `${locations.length} location${locations.length === 1 ? "" : "s"} eligible for an NBN fibre upgrade.`}
        </p>
      </div>

      {permissionGated ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 mb-4">
          The account-wide eligibility list isn&apos;t enabled on our Kinetix API key yet (403 from Kinetix — ask their support to switch on Fibre Uplift API access). Per-address checks below work fine.
        </div>
      ) : error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 mb-4">{error}</div>
      ) : null}

      <div className="mb-4">
        <UpliftChecker />
      </div>

      {locations.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
          Kinetix reports no fibre-uplift-eligible locations for this account.
        </div>
      )}

      {locations.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left bg-muted/30 text-muted-foreground">
                <th className="px-3 py-2 font-medium">Location</th>
                <th className="px-3 py-2 font-medium">LOC ID</th>
                <th className="px-3 py-2 font-medium">Current Tech</th>
                <th className="px-3 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc, i) => {
                const r = loc as Record<string, unknown>;
                const address = String(r.formattedAddress ?? r.address ?? "—");
                const locId = String(r.locationId ?? r.loc_id ?? r.id ?? "—");
                const tech = String(r.currentTechnology ?? r.technology ?? r.primaryAccessTechnology ?? "—");
                return (
                  <tr key={locId + i} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 max-w-[300px] truncate" title={address}>{address}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{locId}</td>
                    <td className="px-3 py-2 text-muted-foreground">{tech}</td>
                    <td className="px-3 py-2">
                      <details>
                        <summary className="cursor-pointer text-[10px] text-subtle hover:text-muted-foreground">raw</summary>
                        <pre className="mt-1 max-w-md overflow-auto rounded bg-muted/30 p-2 text-[10px]">{JSON.stringify(loc, null, 2)}</pre>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
