import { createClient } from "@/lib/supabase/server";
import { ElectriciansManager } from "./electricians-manager";

export const dynamic = "force-dynamic";

export default async function ElectriciansSettingsPage() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("state_electricians")
    .select("state, company_name, contact_name, email, phone, notes, updated_at")
    .order("state");

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Electricians</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        One state-responsible electrician per Australian state. When a plan is sent for quoting from the
        Plans page, the email goes to the contact mapped to the plan&apos;s state. Update an entry below to
        change who receives plan-quote requests.
      </p>
      <div className="mt-6">
        <ElectriciansManager initial={rows ?? []} />
      </div>
    </div>
  );
}
