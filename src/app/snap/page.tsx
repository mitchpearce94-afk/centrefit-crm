import { createServiceRoleClient } from "@/lib/supabase/service";
import { resolveSnapStaff } from "@/lib/receipts/snap-device";
import { resolveReceiptDestination, todaysJobsForStaff } from "@/lib/receipts/snap";
import { SnapClient } from "./snap-client";
import { SnapPair } from "./snap-pair";

export const dynamic = "force-dynamic";

/**
 * /snap — the Receipts app. Opens into a live viewfinder: shutter → the
 * photo is stored and (in the background) read + forwarded to Xero's bills
 * inbox. Defaults the job to whatever this tech is on today. Also takes a
 * multi-select dump from the photo library for the "I've got a week of
 * receipts on my phone" case.
 *
 * Auth is session OR paired-device cookie (see lib/receipts/snap-device.ts)
 * so the installed app never bounces to the CRM login; a phone with neither
 * gets the one-tap passkey pairing screen instead of a redirect.
 */
export default async function SnapPage() {
  const auth = await resolveSnapStaff();
  if (!auth) return <SnapPair />;

  const svc = createServiceRoleClient();
  const [todayJobs, dest] = await Promise.all([
    todaysJobsForStaff(svc, auth.staff.id),
    resolveReceiptDestination(svc),
  ]);

  return (
    <SnapClient
      staffName={auth.staff.display_name}
      todayJobs={todayJobs}
      viaXero={dest.viaXero}
      isAdmin={auth.staff.role === "admin"}
      needsPairing={!auth.viaDevice}
    />
  );
}
