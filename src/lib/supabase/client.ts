import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // Passkey sign-in (WebAuthn) — experimental supabase-js API, opted
        // in deliberately (security session 2026-07-06). RP is
        // crm.centrefit.com.au / "Centrefit CRM" in the auth config.
        experimental: { passkey: true },
      },
    }
  );
}
