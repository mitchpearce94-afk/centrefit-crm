// 2026-09-23 READ-ONLY: for sites whose GC payments found no invoice, does ANY Xero contact
// carrying that site's name have ACCREC invoices since 20 Jun? None = money collected, never invoiced.
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const envFile = ["../.env.gc-probe", "../.env.local"].map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
const env = Object.fromEntries(readFileSync(envFile, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn, error: connErr } = await supabase.from("xero_connections").select("tenant_id, access_token").order("updated_at", { ascending: false }).limit(1).single();
if (!conn) { console.error("xero_connections:", connErr?.message, "| url", env.NEXT_PUBLIC_SUPABASE_URL, "| key len", (env.SUPABASE_SERVICE_ROLE_KEY ?? "").length); process.exit(1); }
const xeroGet = async (path) => { const r = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { headers: { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" } }); if (r.status === 429) { await new Promise((z) => setTimeout(z, 16000)); return xeroGet(path); } return r.ok ? r.json() : null; };
const money = (n) => (n ?? 0).toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const SITES = ["Plainland", "Wagga", "Sunshine", "Strathpine", "Meadowbank", "Box Hill", "Wantirna", "Mt Druitt", "Arana Hills", "Bellmere", "Lutwyche", "Condello"];
for (const s of SITES) {
  const found = ((await xeroGet(`Contacts?where=${encodeURIComponent(`Name.Contains("${s}")`)}`))?.Contacts ?? []).filter((c) => !/^PAYMENT FROM/i.test(c.Name));
  const out = [];
  for (const c of found) {
    const inv = (await xeroGet(`Invoices?where=${encodeURIComponent(`Contact.ContactID==Guid("${c.ContactID}") AND Type=="ACCREC" AND Date>=DateTime(2026,06,20)`)}&order=Date`))?.Invoices ?? [];
    const live = inv.filter((i) => !["VOIDED", "DELETED", "DRAFT"].includes(i.Status));
    if (live.length) out.push(`${c.Name}${c.ContactStatus === "ARCHIVED" ? " (archived)" : ""}: ${live.length} inv, ${money(live.reduce((t, i) => t + Number(i.Total), 0))}, last ${String(live.at(-1).DateString ?? "").slice(0, 10)}, amounts ${[...new Set(live.map((i) => Number(i.Total).toFixed(2)))].slice(0, 5).join("/")}`);
  }
  console.log(`${s.padEnd(12)} contacts ${String(found.length).padStart(2)} → ${out.length ? out.join(" | ") : "NO INVOICES SINCE 20 JUN UNDER ANY MATCHING CONTACT"}`);
}
