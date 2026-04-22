import { XeroClient } from "xero-node";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// Scopes we request from Xero. `offline_access` is required to get a refresh token.
// Apps created after 2 Mar 2026 use granular scopes — accounting.transactions is
// deprecated and split into accounting.invoices + accounting.payments +
// accounting.banktransactions + accounting.manualjournals.
// accounting.invoices covers Invoices, Quotes, PurchaseOrders, Items (Phase B/C).
// accounting.payments covers Payments (used for payment status refresh).
// accounting.settings covers Accounts, TaxRates, BrandingThemes, Organisation.
// accounting.contacts covers Contacts (customer sync).
export const XERO_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.settings",
  "accounting.invoices",
  "accounting.payments",
  "accounting.contacts",
];

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export function buildXeroClient() {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
  return new XeroClient({
    clientId: requireEnv("XERO_CLIENT_ID"),
    clientSecret: requireEnv("XERO_CLIENT_SECRET"),
    redirectUris: [`${appUrl}/api/xero/callback`],
    scopes: XERO_SCOPES,
  });
}

export interface XeroConnection {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  access_token: string;
  refresh_token: string;
  id_token: string | null;
  expires_at: string;
  scopes: string | null;
  last_sync_at: string | null;
  last_sync_result: unknown;
}

/**
 * Load the single active Xero connection (first row — single-tenant for
 * Centrefit). Returns null if not connected.
 */
export async function getConnection(
  supabase: SupabaseClient
): Promise<XeroConnection | null> {
  const { data } = await supabase
    .from("xero_connections")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as XeroConnection | null) ?? null;
}

/**
 * Return an authenticated XeroClient ready to call API methods. Handles token
 * refresh if the access token has expired or is about to expire.
 */
export async function getAuthedClient(): Promise<{
  client: XeroClient;
  conn: XeroConnection;
}> {
  const supabase = await createClient();
  const conn = await getConnection(supabase);
  if (!conn) throw new Error("Xero is not connected");

  const client = buildXeroClient();

  const expiresAt = new Date(conn.expires_at).getTime();
  const now = Date.now();
  const stillValid = expiresAt - now > 60_000; // 1 min buffer

  if (stillValid) {
    await client.setTokenSet({
      access_token: conn.access_token,
      refresh_token: conn.refresh_token,
      id_token: conn.id_token ?? undefined,
      expires_at: Math.floor(expiresAt / 1000),
      token_type: "Bearer",
      scope: conn.scopes ?? XERO_SCOPES.join(" "),
    });
    return { client, conn };
  }

  // Expired — refresh and persist the new tokens
  await client.setTokenSet({
    refresh_token: conn.refresh_token,
    access_token: conn.access_token,
    expires_at: Math.floor(expiresAt / 1000),
    token_type: "Bearer",
    scope: conn.scopes ?? XERO_SCOPES.join(" "),
  });
  const fresh = await client.refreshToken();

  const newExpiresAt = fresh.expires_at
    ? new Date(fresh.expires_at * 1000).toISOString()
    : new Date(Date.now() + 1800 * 1000).toISOString(); // 30 min default

  await supabase
    .from("xero_connections")
    .update({
      access_token: fresh.access_token ?? conn.access_token,
      refresh_token: fresh.refresh_token ?? conn.refresh_token,
      id_token: fresh.id_token ?? conn.id_token,
      expires_at: newExpiresAt,
      scopes: fresh.scope ?? conn.scopes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conn.id);

  return {
    client,
    conn: {
      ...conn,
      access_token: fresh.access_token ?? conn.access_token,
      refresh_token: fresh.refresh_token ?? conn.refresh_token,
      id_token: fresh.id_token ?? conn.id_token ?? null,
      expires_at: newExpiresAt,
    },
  };
}
