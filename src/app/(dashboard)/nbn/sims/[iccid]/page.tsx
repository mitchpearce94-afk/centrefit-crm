import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentUserHasPermission } from "@/lib/auth/permissions";
import {
  fetchAuditTrails,
  fetchDevice,
  fetchDeviceUsage,
  fetchFleet,
  fetchSessionInfo,
  isJasperConfigured,
  listRatePlanNames,
  JasperError,
  type JasperDevice,
} from "@/lib/jasper/client";
import { loadSimAssets, loadSiteOptions, resolveLinks } from "@/lib/jasper/links";
import { SimStatusBadge, formatBytesClient, formatDate } from "../sim-ui";
import { SimActions } from "./sim-actions";
import { JasperSetupCard } from "../setup-card";

export const dynamic = "force-dynamic";

export default async function SimDetailPage({ params }: { params: Promise<{ iccid: string }> }) {
  const { iccid } = await params;
  if (!isJasperConfigured()) return <JasperSetupCard />;

  let device: JasperDevice;
  try {
    device = await fetchDevice(iccid);
  } catch (err) {
    if (err instanceof JasperError && err.status === 404) notFound();
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
        {err instanceof Error ? err.message : "Couldn't load this SIM from Jasper."}
      </div>
    );
  }

  const supabase = await createClient();
  const [usage, session, audit, planNames, fleet, assets, sites, canManage, canLink] = await Promise.all([
    fetchDeviceUsage(iccid).catch(() => null),
    fetchSessionInfo(iccid).catch(() => null),
    fetchAuditTrails(iccid),
    listRatePlanNames(),
    fetchFleet().catch(() => []),
    loadSimAssets(supabase),
    loadSiteOptions(supabase),
    currentUserHasPermission("nbn.manage"),
    currentUserHasPermission("sites.manage_assets"),
  ]);

  const link = resolveLinks([device], assets).get(iccid) ?? { linked: null, suggested: null };
  // Plan names seen across the fleet fill the datalist when /ratePlans is locked down.
  const knownPlans = Array.from(
    new Set([...planNames, ...fleet.map((f) => f.device.ratePlan).filter((p): p is string => Boolean(p))]),
  ).sort();

  const facts: [string, string | null | undefined][] = [
    ["Phone (MSISDN)", device.msisdn],
    ["IMSI", device.imsi],
    ["IMEI (last modem)", device.imei],
    ["Communication plan", device.communicationPlan],
    ["Jasper customer", device.customer],
    ["End consumer", device.endConsumerId],
    ["Activated", formatDate(device.dateActivated)],
    ["Added", formatDate(device.dateAdded)],
    ["Last updated", formatDate(device.dateUpdated)],
    ["Fixed IP", device.fixedIPAddress],
    ["SIM type", device.globalSimType],
    ["Notes", device.simNotes],
  ];
  const customs = Object.entries(device).filter(([k, v]) => /Custom\d$/.test(k) && typeof v === "string" && v);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/nbn/sims" className="text-xs text-muted-foreground hover:text-foreground">
            ← All SIMs
          </Link>
          <h2 className="mt-1 font-mono text-base font-semibold">{iccid}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <SimStatusBadge status={device.status ? String(device.status) : null} />
            <span>{device.ratePlan ?? "No rate plan"}</span>
            {device.msisdn && <span className="font-mono">{device.msisdn}</span>}
          </div>
        </div>
        <div className="text-right text-xs">
          {link.linked ? (
            <>
              <div className="text-muted-foreground">Installed at</div>
              <Link href={`/sites/${link.linked.siteId}`} className="font-medium hover:underline">
                {link.linked.siteName}
              </Link>
              {link.linked.deviceName && <div className="text-muted-foreground">{link.linked.deviceName}</div>}
            </>
          ) : (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
              Not linked to a site
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">This cycle</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <Metric label="Data" value={formatBytesClient(usage?.ctdDataUsage)} warn={usage?.overageLimitReached} />
              <Metric label="SMS" value={usage?.ctdSMSUsage != null ? String(usage.ctdSMSUsage) : "—"} />
              <Metric label="Voice (s)" value={usage?.ctdVoiceUsage != null ? String(usage.ctdVoiceUsage) : "—"} />
              <Metric label="Sessions" value={usage?.ctdSessionCount != null ? String(usage.ctdSessionCount) : "—"} />
            </div>
            {usage?.overageLimitReached && (
              <p className="mt-2 text-xs text-amber-400">Overage limit reached on this plan.</p>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Last data session</h3>
            {session?.dateSessionStarted ? (
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                <Fact label="Started" value={formatDate(session.dateSessionStarted)} />
                <Fact label="Ended" value={session.dateSessionEnded ? formatDate(session.dateSessionEnded) : "Still online"} />
                <Fact label="IP" value={session.ipAddress} mono />
              </dl>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No session recorded.</p>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</h3>
            <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
              {facts.filter(([, v]) => v && v !== "—").map(([k, v]) => (
                <Fact key={k} label={k} value={v} mono={/IMSI|IMEI|MSISDN|IP/.test(k)} />
              ))}
              {customs.map(([k, v]) => (
                <Fact key={k} label={k.replace(/([A-Z])/g, " $1").replace(/^\w/, (c) => c.toUpperCase())} value={String(v)} />
              ))}
            </dl>
          </section>

          {audit.length > 0 && (
            <section className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Change history</h3>
              <ul className="mt-2 divide-y divide-border text-xs">
                {audit.slice(0, 25).map((a, i) => (
                  <li key={i} className="flex flex-wrap gap-x-3 py-1.5">
                    <span className="w-36 shrink-0 text-muted-foreground">{formatDate(a.date)}</span>
                    <span className="font-medium">{a.field ?? "—"}</span>
                    {(a.oldValue || a.newValue) && (
                      <span className="text-muted-foreground">
                        {a.oldValue ?? "∅"} → {a.newValue ?? "∅"}
                      </span>
                    )}
                    {a.user && <span className="ml-auto text-muted-foreground">{a.user}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div>
          <SimActions
            iccid={iccid}
            msisdn={device.msisdn ?? null}
            status={device.status ? String(device.status) : null}
            ratePlan={device.ratePlan ?? null}
            knownPlans={knownPlans}
            linked={link.linked ? { assetId: link.linked.id, siteId: link.linked.siteId, siteName: link.linked.siteName } : null}
            suggested={link.suggested ? { assetId: link.suggested.id, siteName: link.suggested.siteName, serial: link.suggested.serial } : null}
            sites={sites}
            canManage={canManage}
            canLink={canLink}
          />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold font-mono ${warn ? "text-amber-400" : ""}`}>{value}</div>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 break-words ${mono ? "font-mono" : ""}`}>{value || "—"}</dd>
    </div>
  );
}
