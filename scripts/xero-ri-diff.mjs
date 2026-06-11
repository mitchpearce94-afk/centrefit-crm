// Diff current Xero repeating invoices against last night's snapshot
// (scripts/xero-repeating-output.json) to find what was deleted today.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: conn } = await supabase.from("xero_connections").select("id, tenant_id, access_token, refresh_token, expires_at").order("updated_at", { ascending: false }).limit(1).single();
let tok = conn.access_token;
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60000) {
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64") },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const t = await res.json();
  tok = t.access_token;
  await supabase.from("xero_connections").update({ access_token: t.access_token, refresh_token: t.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (t.expires_in ?? 1800) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id);
}

const cur = await (await fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", {
  headers: { Authorization: `Bearer ${tok}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" },
})).json();
const now = new Map((cur.RepeatingInvoices ?? []).map((r) => [r.RepeatingInvoiceID, r]));
const before = JSON.parse(readFileSync(new URL("./xero-repeating-output.json", import.meta.url), "utf8"));

// Known deletions by us (Kellyville cleanup) — exclude
const OURS = new Set(["be57ea60-4150-4893-a97e-05185bb52407", "8ba954ab-5c95-471c-a678-f219b55dd417", "cdb50f57-41a4-4e05-871b-ffa5e9e4fdd1"]);

console.log("RIs AUTHORISED/DRAFT last night that are now DELETED or missing:");
let found = 0;
for (const b of before) {
  if (b.Status === "DELETED") continue;
  if (OURS.has(b.RepeatingInvoiceID)) continue;
  const c = now.get(b.RepeatingInvoiceID);
  const curStatus = c?.Status ?? "MISSING";
  if (curStatus === "DELETED" || curStatus === "MISSING") {
    found++;
    console.log(`\n  ${b.Contact?.Name}`);
    console.log(`    was ${b.Status}, now ${curStatus} — $${b.Total} ${b.Schedule?.Period}x${b.Schedule?.Unit}`);
    console.log(`    lines: ${(b.LineItems ?? []).map((l) => l.Description?.slice(0, 60)).join(" | ")}`);
    console.log(`    id: ${b.RepeatingInvoiceID}`);
  }
}
if (!found) console.log("  (none — nothing deleted since last night apart from our Kellyville cleanup)");
