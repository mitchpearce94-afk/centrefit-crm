// READ-ONLY probe: bisect which scope makes the authorize request fail.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\r|\n/g, "").trim()];
    }),
);

const REDIRECT = "https://crm.centrefit.com.au/api/xero/callback";
const BASE = ["openid", "profile", "email", "offline_access", "accounting.settings", "accounting.invoices", "accounting.payments", "accounting.contacts"];

const combos = [
  ["+ reports.banksummary.read", [...BASE, "accounting.reports.banksummary.read"]],
  ["+ banktransactions + banksummary (target set)", [...BASE, "accounting.banktransactions", "accounting.reports.banksummary.read"]],
  ["+ trialbalance.read (curiosity)", [...BASE, "accounting.reports.trialbalance.read"]],
];

for (const [label, scopes] of combos) {
  const u = new URL("https://login.xero.com/identity/connect/authorize");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", env.XERO_CLIENT_ID);
  u.searchParams.set("redirect_uri", REDIRECT);
  u.searchParams.set("scope", scopes.join(" "));
  u.searchParams.set("state", "probe");
  const res = await fetch(u, { redirect: "manual" });
  const loc = res.headers.get("location") ?? "";
  const verdict = /identity\/error/.test(loc) ? "REJECTED" : "accepted";
  console.log(verdict.padEnd(10), label);
}
