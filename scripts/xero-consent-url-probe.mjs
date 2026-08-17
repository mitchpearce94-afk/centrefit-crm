// READ-ONLY probe: build the exact consent URL prod would build (same
// xero-node lib, same scopes, same env) and check whether Xero accepts it.
// We never log in — just inspect the first redirect.
import { readFileSync } from "node:fs";
import { XeroClient } from "xero-node";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\r|\n/g, "").trim()];
    }),
);

const XERO_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.settings",
  "accounting.invoices",
  "accounting.payments",
  "accounting.contacts",
  "accounting.banktransactions",
  "accounting.reports.read",
  "accounting.reports.bankstatement.read",
];

const client = new XeroClient({
  clientId: env.XERO_CLIENT_ID,
  clientSecret: env.XERO_CLIENT_SECRET,
  redirectUris: ["https://crm.centrefit.com.au/api/xero/callback"],
  scopes: XERO_SCOPES,
});

const url = await client.buildConsentUrl();
console.log("Consent URL prod builds:");
console.log(url);
console.log("");
const parsed = new URL(url);
console.log("redirect_uri param:", parsed.searchParams.get("redirect_uri"));
console.log("scope param:      ", parsed.searchParams.get("scope"));
console.log("");

const res = await fetch(url, { redirect: "manual" });
const loc = res.headers.get("location") ?? "";
console.log(`authorize response: status=${res.status}`);
console.log(`location: ${loc.slice(0, 160)}`);
console.log(/identity\/error/.test(loc) ? "VERDICT: REJECTED" : "VERDICT: ACCEPTED");
