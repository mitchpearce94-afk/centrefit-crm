import { createServiceRoleClient } from "@/lib/supabase/service";
import { resolveSnapStaff } from "@/lib/receipts/snap-device";
import { destinationLabel, fuelRegos, resolveReceiptDestination, todaysJobsForStaff } from "@/lib/receipts/snap";
import { SnapClient } from "./snap-client";
import { SnapPair } from "./snap-pair";

export const dynamic = "force-dynamic";

/**
 * /snap — the Receipts app, and since 2026-10-15 the ONLY receipt path (the
 * desktop scanner is gone). Opens into a live viewfinder: shutter → the
 * photo is stored and (in the background) emailed to the accountant with a
 * one-line template subject, then read for the CRM's own vendor/amount.
 * Defaults the job to whatever this tech is on today; a "Fuel" toggle swaps
 * the job for a vehicle rego. Also takes a multi-select dump from the photo
 * library for the "I've got a week of receipts on my phone" case.
 *
 * Auth is session OR paired-device cookie (see lib/receipts/snap-device.ts)
 * so the installed app never bounces to the CRM login; a phone with neither
 * gets the one-tap passkey pairing screen instead of a redirect.
 */
export default async function SnapPage() {
  const auth = await resolveSnapStaff();
  if (!auth) return <SnapPair />;

  const svc = createServiceRoleClient();
  const [todayJobs, dest, regos] = await Promise.all([
    todaysJobsForStaff(svc, auth.staff.id),
    resolveReceiptDestination(svc),
    fuelRegos(svc),
  ]);
  const destLabel = await destinationLabel(svc, dest.to);

  return (
    <SnapClient
      staffName={auth.staff.display_name}
      todayJobs={todayJobs}
      fuelRegos={regos}
      destLabel={destLabel}
      destConfigured={dest.configured}
      isAdmin={auth.staff.role === "admin"}
      needsPairing={!auth.viaDevice}
    />
  );
}
