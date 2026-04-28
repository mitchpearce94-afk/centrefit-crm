import "server-only";
import { createServerClient } from "@supabase/ssr";

/**
 * Service-role Supabase client for webhook handlers and other anonymous
 * background contexts where there are no auth cookies and we need to bypass
 * RLS to read/write integration tables (xero_connections, invoices, jobs).
 *
 * NEVER expose this to the browser or use it for user-initiated actions.
 * Caller is responsible for verifying the request is legitimate (HMAC sig,
 * cron secret, etc.) before invoking.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL not set");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");

  // Use the SSR client with no-op cookie handlers — same shape as the regular
  // server client so callers don't have to special-case the type.
  return createServerClient(url, key, {
    cookies: {
      getAll: () => [],
      setAll: () => {},
    },
  });
}
