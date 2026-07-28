import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AccountForm } from "./account-form";
import { PasskeysSection } from "./passkeys-section";

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: staff } = await supabase
    .from("staff")
    .select("id, display_name, initials, email, role, phone, colour")
    .eq("id", user.id)
    .single();

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight">My account</h1>
      <p className="mt-1 text-sm text-muted-foreground">Update your details and password.</p>
      <div className="mt-6 space-y-6">
        <AccountForm staff={staff} />
        <PasskeysSection />

        {/* PWA install guide — pairs with passkeys: installed app + passkey =
            open, Face ID, you're in. */}
        <div className="surface-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Install the app on your phone</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The CRM installs as an app — it opens full-screen from its own icon, and with a
            passkey added above, unlocking is just Face ID / fingerprint. No authenticator
            codes, no typing.
          </p>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="font-semibold text-foreground mb-1">iPhone (Safari)</p>
              <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
                <li>Open crm.centrefit.com.au in Safari</li>
                <li>Tap the Share button</li>
                <li>Tap &quot;Add to Home Screen&quot;</li>
              </ol>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="font-semibold text-foreground mb-1">Android (Chrome)</p>
              <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
                <li>Open crm.centrefit.com.au in Chrome</li>
                <li>Tap the ⋮ menu</li>
                <li>Tap &quot;Add to Home screen&quot; / &quot;Install app&quot;</li>
              </ol>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            First open: sign in once with your password, add a passkey above, done. From then
            on the app unlocks with Face ID and only asks for a full sign-in every two weeks.
          </p>
        </div>
      </div>
    </div>
  );
}
