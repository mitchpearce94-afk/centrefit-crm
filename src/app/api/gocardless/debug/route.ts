import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Diagnostic endpoint for the GoCardless integration.
 *
 * Default: probe API versions for `lock_customer_details` support.
 * `?customer=CU0xxx` mode: pull the actual GC customer record to see
 *   what fields were stored at sign-up (separates "we didn't send the
 *   field" from "customer cleared it on the form").
 *
 * Auth-gated (logged-in CRM users only).
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const customerId = req.nextUrl.searchParams.get("customer");
  if (customerId) {
    return inspectCustomer(customerId);
  }

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

  // Probe multiple GoCardless API versions to find which ones the account
  // accepts AND which ones support `lock_customer_details` on
  // billing_request_flows. We do this dynamically because GC's version
  // calendar isn't well-documented and 2018-11-29 returned version_not_found.
  const versionsToTry = [
    "2015-07-06",
    "2016-04-13",
    "2017-02-27",
    "2017-09-12",
    "2018-04-11",
    "2018-09-11",
    "2018-09-13",
    "2019-08-13",
    "2020-06-18",
    "2021-09-23",
    "2022-04-29",
    "2023-04-04",
    "2024-08-14",
  ];

  async function probeVersion(version: string) {
    const v = { ...headers, "GoCardless-Version": version };

    // Step 1: create a BR (we need one before testing flows). If creating
    // the BR fails with version_not_found, this version is invalid.
    const brRes = await fetch(`${base}/billing_requests`, {
      method: "POST",
      headers: { ...v, "Idempotency-Key": `debug-v-${version}-${Date.now()}` },
      body: JSON.stringify({
        billing_requests: {
          mandate_request: { scheme: "becs", currency: "AUD" },
        },
      }),
    });
    const brBody = await brRes.text();
    if (brRes.status === 400 && brBody.includes("version_not_found")) {
      return { version, valid: false, reason: "version_not_found", lockSupported: false };
    }
    if (!brRes.ok) {
      return { version, valid: false, reason: `BR create ${brRes.status}: ${brBody.slice(0, 200)}`, lockSupported: false };
    }
    let brId: string;
    try { brId = JSON.parse(brBody).billing_requests.id; }
    catch { return { version, valid: false, reason: "BR parse fail", lockSupported: false }; }

    // Step 2: try to create a BRF with lock_customer_details: true.
    const brfRes = await fetch(`${base}/billing_request_flows`, {
      method: "POST",
      headers: { ...v, "Idempotency-Key": `debug-vf-${version}-${Date.now()}` },
      body: JSON.stringify({
        billing_request_flows: {
          redirect_uri: "https://crm.centrefit.com.au/recurring-thanks",
          links: { billing_request: brId },
          lock_customer_details: true,
          prefilled_customer: {
            email: "debug+probe@centrefit.com.au",
            company_name: "Debug",
            given_name: "Debug",
            family_name: "Probe",
            country_code: "AU",
          },
        },
      }),
    });
    const brfBody = await brfRes.text();
    return {
      version,
      valid: true,
      lockStatus: brfRes.status,
      lockSupported: brfRes.ok,
      lockBody: brfBody.slice(0, 400),
    };
  }

  const probes = await Promise.all(versionsToTry.map(probeVersion));

  return NextResponse.json({
    environment: env,
    base,
    tokenLength: token.length,
    tokenPrefix: token.slice(0, 5),
    probes,
  });
}

async function inspectCustomer(customerId: string) {
  const token = process.env.GOCARDLESS_API_TOKEN;
  const env = process.env.GOCARDLESS_ENVIRONMENT;
  if (!token) return NextResponse.json({ error: "GOCARDLESS_API_TOKEN not set" }, { status: 500 });
  const base = env === "sandbox" ? "https://api-sandbox.gocardless.com" : "https://api.gocardless.com";

  const res = await fetch(`${base}/customers/${customerId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "GoCardless-Version": "2015-07-06",
      Accept: "application/json",
    },
  });
  const body = await res.text();
  return NextResponse.json({
    status: res.status,
    body: (() => { try { return JSON.parse(body); } catch { return body; } })(),
  });
}
