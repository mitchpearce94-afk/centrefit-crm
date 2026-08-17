// READ-ONLY probe: which redirect_uri values does the Xero app accept?
// Hits the authorize endpoint with candidate URIs; a mismatch renders Xero's
// "Invalid redirect_uri" error, a match renders/redirects to the login flow.
// Nothing is authorized — we never log in.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\r|\n/g, "").trim()];
    }),
);

const candidates = [
  "https://crm.centrefit.com.au/api/xero/callback",
  "https://crm.centrefit.com.au/api/xero/callback/",
  "http://localhost:3000/api/xero/callback",
  "https://centrefit-crm.vercel.app/api/xero/callback",
  "https://centrefit-crm-mitchell-pearces-projects.vercel.app/api/xero/callback",
  "https://www.centrefit.com.au/api/xero/callback",
];

for (const uri of candidates) {
  const u = new URL("https://login.xero.com/identity/connect/authorize");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", env.XERO_CLIENT_ID);
  u.searchParams.set("redirect_uri", uri);
  u.searchParams.set("scope", "openid");
  u.searchParams.set("state", "probe");
  const res = await fetch(u, { redirect: "manual" });
  const loc = res.headers.get("location") ?? "";
  let verdict = `status=${res.status}`;
  if (loc) verdict += ` -> ${loc.slice(0, 120)}`;
  if (res.status === 200 || /login|signin|authorize/i.test(loc)) {
    const body = res.status === 200 ? await res.text() : "";
    if (/invalid redirect|invalid_request/i.test(body) || /error/i.test(loc)) verdict += "  [REJECTED]";
    else verdict += "  [ACCEPTED]";
  } else if (/error/i.test(loc) || res.status >= 400) {
    verdict += "  [REJECTED]";
  }
  console.log(uri.padEnd(75), verdict);
}
