/**
 * One-off Phase B smoke helper: mirrors /api/sites/[id]/monitoring-form/send
 * (same queries, same prefill shape) to mint a live sign request without a
 * staff session, so the public form + submit flow can be exercised
 * end-to-end in production. Reads service creds from .env.gc-probe like the
 * other one-off scripts. Usage:
 *   node scripts/smoke-monitoring-send.mjs <siteId> <recipientEmail>
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import crypto from "crypto";

// Values in .env.gc-probe carry literal \n suffixes (echo-baked) — same
// scrub as ingest-datasheets-2026-07-05.mjs.
const env = Object.fromEntries(
  readFileSync(".env.gc-probe", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()];
    }),
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const FEE_CODES = { monitoring: "security-monitoring", app: "myalarm-app", vav: "VAV", sim: "sim-card", nbn: "nbn-100-40" };
const siteId = process.argv[2];
const recipientEmail = process.argv[3];
if (!siteId || !recipientEmail) {
  console.error("usage: node scripts/smoke-monitoring-send.mjs <siteId> <recipientEmail>");
  process.exit(1);
}

const [siteResult, feesResult, profileResult, assetsResult, priorResult] = await Promise.all([
  sb.from("customer_sites").select("*, customer:customers!customer_id(id, name, abn, billing_email)").eq("id", siteId).single(),
  sb.from("recurring_services").select("code, name, price_inc_gst, frequency").in("code", Object.values(FEE_CODES)).eq("active", true),
  sb.from("site_monitoring_profiles").select("*").eq("site_id", siteId).maybeSingle(),
  sb.from("site_assets").select("device_name, location_note, is_active, asset_type:asset_types!asset_type_id(name, category)").eq("site_id", siteId).eq("is_active", true),
  sb.from("document_sign_requests").select("id, status, site_document_id, version").eq("site_id", siteId).eq("document_type", "monitoring_form").order("version", { ascending: false }),
]);

for (const [label, r] of [["site", siteResult], ["fees", feesResult], ["profile", profileResult], ["assets", assetsResult], ["prior", priorResult]]) {
  if (r.error) {
    console.error(`QUERY FAILED (${label}):`, r.error.message);
    process.exit(1);
  }
}
console.log("send-route queries all OK");

const site = siteResult.data;
const customer = Array.isArray(site.customer) ? site.customer[0] ?? null : site.customer;
const { data: ownerContact } = await sb
  .from("customer_contacts").select("name").eq("customer_id", customer.id)
  .order("is_primary", { ascending: false }).limit(1).maybeSingle();

const fees = {};
for (const [key, code] of Object.entries(FEE_CODES)) {
  const row = (feesResult.data ?? []).find((r) => r.code === code);
  if (row) {
    const inc = Number(row.price_inc_gst);
    fees[key] = { code: row.code, name: row.name, priceIncGst: inc, priceExGst: Math.round((inc / 1.1) * 100) / 100, frequency: row.frequency };
  }
}

const zoneSchedule = (assetsResult.data ?? [])
  .map((a) => ({ ...a, asset_type: Array.isArray(a.asset_type) ? a.asset_type[0] ?? null : a.asset_type }))
  .filter((a) => a.asset_type && ["security", "duress"].includes(a.asset_type.category))
  .map((a, i) => ({ zone: String(i + 1), name: a.device_name || a.asset_type?.name || "Device", description: a.location_note || a.asset_type?.name || "" }));

const profile = profileResult.data;
const profileDetails = profile?.details ?? {};
const facilityAddress = [site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(", ");
const version = (priorResult.data?.[0]?.version ?? 0) + 1;
const now = new Date().toISOString();

const prefill = {
  siteName: site.name ?? "",
  details: {
    clientName: site.invoice_name ?? customer?.name ?? "",
    billingContactName: ownerContact?.name ?? "",
    abn: customer?.abn ?? "",
    facilityName: site.name ?? "",
    facilityAddress,
    facilityPhone: site.phone ?? "",
    billingAddress: profileDetails.billing_address ?? "",
    nearestCrossStreet: profileDetails.nearest_cross_street ?? "",
    email: recipientEmail,
    newClient: !profile,
    commencementDate: profileDetails.commencement_date ?? "",
    simPhone: profileDetails.sim_phone ?? "",
    facility247: Boolean(profileDetails.facility247),
  },
  selections: profile?.selections ?? {},
  callList: profile?.call_list ?? [],
  ifobUsers: profile?.ifob_users ?? [],
  openingHours: profile?.opening_hours ?? {},
  zoneSchedule,
  fees,
  isReissue: Boolean(profile),
  docVersion: version,
  generatedAt: now,
};

const { data: docRow, error: docError } = await sb
  .from("site_documents")
  .insert({ site_id: siteId, category: "security", name: `Security Monitoring Response Instructions v${version}`, status: "sent", version })
  .select("id").single();
if (docError) { console.error("doc insert failed:", docError.message); process.exit(1); }

const token = crypto.randomBytes(32).toString("hex");
const { data: reqRow, error: reqError } = await sb
  .from("document_sign_requests")
  .insert({
    site_id: siteId, site_document_id: docRow.id, document_type: "monitoring_form",
    token, recipient_name: "Mitchell Pearce", recipient_email: recipientEmail,
    status: "sent", version, prefill, sent_at: now,
  })
  .select("id").single();
if (reqError) { console.error("request insert failed:", reqError.message); process.exit(1); }

console.log(JSON.stringify({ requestId: reqRow.id, documentId: docRow.id, version, zoneRows: zoneSchedule.length, feeKeys: Object.keys(fees), url: `https://crm.centrefit.com.au/monitoring-form/${token}` }, null, 2));
