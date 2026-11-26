import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { currentUserHasPermission } from "@/lib/auth/permissions";
import { fetchFleet, isJasperConfigured, type SimSnapshot } from "@/lib/jasper/client";
import { loadSimAssets, loadSiteOptions, resolveLinks } from "@/lib/jasper/links";
import { SimsTable, type SimRow } from "./sims-table";
import { JasperSetupCard } from "./setup-card";

export const dynamic = "force-dynamic";

export default async function SimsPage() {
  if (!isJasperConfigured()) return <JasperSetupCard />;

  const supabase = await createClient();
  const [canLink, assets, sites] = await Promise.all([
    currentUserHasPermission("sites.manage_assets"),
    loadSimAssets(supabase),
    loadSiteOptions(supabase),
  ]);

  let fleet: SimSnapshot[] = [];
  let error: string | null = null;
  try {
    fleet = await fetchFleet();
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error";
  }

  const links = resolveLinks(fleet.map((f) => f.device), assets);
  const rows: SimRow[] = fleet
    .map(({ device, usage }) => {
      const link = links.get(device.iccid);
      return {
        iccid: device.iccid,
        msisdn: device.msisdn ?? null,
        status: device.status ? String(device.status) : null,
        ratePlan: device.ratePlan ?? null,
        customer: device.customer ?? null,
        dateActivated: device.dateActivated ?? null,
        dataBytes: usage?.ctdDataUsage ?? null,
        overage: usage?.overageLimitReached ?? false,
        linked: link?.linked
          ? { assetId: link.linked.id, siteId: link.linked.siteId, siteName: link.linked.siteName, deviceName: link.linked.deviceName }
          : null,
        suggested: link?.suggested
          ? { assetId: link.suggested.id, siteId: link.suggested.siteId, siteName: link.suggested.siteName, serial: link.suggested.serial }
          : null,
      };
    })
    .sort((a, b) => (a.linked?.siteName ?? "zzz").localeCompare(b.linked?.siteName ?? "zzz") || a.iccid.localeCompare(b.iccid));

  const activated = rows.filter((r) => r.status === "ACTIVATED").length;
  const linkedCount = rows.filter((r) => r.linked).length;
  const unlinkedActive = rows.filter((r) => r.status === "ACTIVATED" && !r.linked).length;
  const totalBytes = rows.reduce((s, r) => s + (r.dataBytes ?? 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold">SIM cards</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {error
              ? "Couldn't fetch live data from M2M One."
              : `${rows.length} SIM${rows.length === 1 ? "" : "s"} on the M2M One account — live from Jasper Control Centre, usage is cycle-to-date.`}
          </p>
        </div>
        <Link
          href="https://m2mone.jasperwireless.com"
          target="_blank"
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          Open Control Centre ↗
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
          {error}
          <p className="mt-1 text-xs text-muted-foreground">
            Check the JASPER_USERNAME / JASPER_REST_API_KEY env vars — a 401 means the key or login is wrong.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4 mb-5">
            <Stat label="Activated" value={activated} sub={`${rows.length - activated} other`} />
            <Stat label="Linked to a site" value={linkedCount} sub={`${rows.length - linkedCount} unlinked`} />
            <Stat label="Active, no site" value={unlinkedActive} warn={unlinkedActive > 0} sub="needs a link" />
            <Stat label="Data this cycle" value={formatGb(totalBytes)} sub="all SIMs" />
          </div>
          <SimsTable rows={rows} sites={sites} canLink={canLink} />
        </>
      )}
    </div>
  );
}

function formatGb(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function Stat({ label, value, sub, warn }: { label: string; value: number | string; sub?: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg border bg-card p-3 ${warn ? "border-amber-500/40" : "border-border"}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${warn ? "text-amber-400" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
