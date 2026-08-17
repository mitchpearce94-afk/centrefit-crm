import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requirePermissionOrNotFound } from "@/lib/auth/route-guards";
import { VaultShell } from "./vault-shell";

/**
 * Vault entry point. Server decides whether the user has run setup yet,
 * then renders <VaultShell /> which handles unlock + locked/unlocked UI on
 * the client. Per D4 the unlocked state lives in browser memory only, so
 * the server never knows the user's master password or the unlock state.
 */
export default async function VaultPage() {
  await requirePermissionOrNotFound("vault.access");
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return null;

  const { data: vaultUser } = await supabase
    .from("vault_users")
    .select("vault_setup_at, last_unlock_at")
    .eq("staff_id", user.user.id)
    .maybeSingle();

  const isSetup = !!vaultUser;

  return (
    <div>
      {/* Mobile-only escape hatch — the bottom nav hides while the keyboard
          is up, so the vault always needs a visible way back to the CRM. */}
      <Link
        href="/"
        className="lg:hidden mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5" />
          <path d="M12 19l-7-7 7-7" />
        </svg>
        Back to CRM
      </Link>
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Vault</h1>
        <p className="text-xs text-muted-foreground">
          Zero-knowledge · server never sees your passwords
        </p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Centrefit team password manager.
      </p>

      <div className="mt-6">
        <VaultShell isSetup={isSetup} />
      </div>
    </div>
  );
}
