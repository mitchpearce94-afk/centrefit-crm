import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getCurrentStaff } from "@/lib/auth/current-staff";
import { resolveReceiptDestination, todaysJobsForStaff } from "@/lib/receipts/snap";
import { SnapClient } from "./snap-client";

export const dynamic = "force-dynamic";

/**
 * /snap — the Receipts app. Opens into a live viewfinder: shutter → the
 * photo is stored and (in the background) read + forwarded to Xero's bills
 * inbox. Defaults the job to whatever this tech is on today. Also takes a
 * multi-select dump from the photo library for the "I've got a week of
 * receipts on my phone" case.
 */
export default async function SnapPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  const svc = createServiceRoleClient();
  const [todayJobs, dest] = await Promise.all([
    todaysJobsForStaff(svc, staff.id),
    resolveReceiptDestination(svc),
  ]);

  return (
    <SnapClient
      staffName={staff.display_name}
      todayJobs={todayJobs}
      viaXero={dest.viaXero}
      isAdmin={staff.role === "admin"}
    />
  );
}
