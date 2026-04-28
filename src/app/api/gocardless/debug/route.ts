import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Diagnostic endpoint for the GoCardless integration.
 *
 * Hits 3 endpoints and reports the raw response for each, so we can
 * differentiate "token doesn't work at all" vs "GET works, POST doesn't"
 * vs "POST /customers blocked, redirect_flows works" — these all look
 * identical from the orchestrator failure path but have different fixes.
 *
 * Auth-gated (logged-in CRM users only). Remove or gate to admin once
 * the integration is healthy.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const token = process.env.GOCARDLESS_API_TOKEN;
  const env = process.env.GOCARDLESS_ENVIRONMENT;
  if (!token) return NextResponse.json({ error: "GOCARDLESS_API_TOKEN not set" }, { status: 500 });

  const base = env === "sandbox" ? "https://api-sandbox.gocardless.com" : "https://api.gocardless.com";

  const headers = {
    Authorization: `Bearer ${token}`,
    "GoCardless-Version": "2015-07-06",
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  async function probe(name: string, init: RequestInit, path: string) {
    try {
      const res = await fetch(`${base}${path}`, init);
      const body = await res.text();
      return { name, status: res.status, ok: res.ok, body: body.slice(0, 1000) };
    } catch (err) {
      return { name, status: 0, ok: false, body: err instanceof Error ? err.message : String(err) };
    }
  }

  const probes = await Promise.all([
    // 1. GET /creditors — read endpoint, lowest privilege. If this 403s, token
    //    or account is broken.
    probe("GET /creditors", { method: "GET", headers }, "/creditors"),

    // 2. GET /customers?limit=1 — read endpoint scoped to customers.
    probe("GET /customers", { method: "GET", headers }, "/customers?limit=1"),

    // 3. POST /customers — the actual write the orchestrator uses. Minimal
    //    payload to isolate from any field-validation issues.
    probe(
      "POST /customers (minimal)",
      {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": `debug-${Date.now()}` },
        body: JSON.stringify({
          customers: {
            email: "debug+probe@centrefit.com.au",
            given_name: "Debug",
            family_name: "Probe",
            country_code: "AU",
          },
        }),
      },
      "/customers",
    ),

    // 4. POST /redirect_flows (without an existing customer) — the alternative
    //    customer-creation path. If 1+2 work but 3 fails and 4 works, the AU
    //    account quirk is confirmed and we just route around POST /customers.
    probe(
      "POST /redirect_flows (no prefill)",
      {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": `debug-rf-${Date.now()}` },
        body: JSON.stringify({
          redirect_flows: {
            description: "Centrefit GC API diagnostic",
            session_token: `debug-${Date.now()}`,
            success_redirect_url: "https://crm.centrefit.com.au/recurring-thanks",
          },
        }),
      },
      "/redirect_flows",
    ),
  ]);

  return NextResponse.json({
    environment: env,
    base,
    tokenLength: token.length,
    tokenPrefix: token.slice(0, 5),
    probes,
  });
}
