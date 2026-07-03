// Read-only probe: Glenmore Park (Vipul Patel) — full Xero invoice/payment
// history for the contact behind INV-6000, any Xero contacts matching
// "Glenmore", and GoCardless payments on mandate MD003E5BRYDVX0.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ── Xero auth (same flow as xero-ri-dd-audit.mjs) ────────────────────────────
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
const XH = { Authorization: `Bearer ${tok}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" };

const xeroDate = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : "?"; };

// 1. INV-6000's contact
const invRes = await fetch("https://api.xero.com/api.xro/2.0/Invoices/70fb2eb2-74c5-47db-84e4-d740d48afad2", { headers: XH });
const inv6000 = (await invRes.json()).Invoices?.[0];
console.log(`INV-6000 contact: ${inv6000?.Contact?.Name} (${inv6000?.Contact?.ContactID})`);
console.log(`  status ${inv6000?.Status} | total ${inv6000?.Total} | due ${inv6000?.AmountDue} | paid ${inv6000?.AmountPaid} | sent ${inv6000?.SentToContact}`);

// 2. Any contacts matching Glenmore / Vipul Patel
const cRes = await fetch(`https://api.xero.com/api.xro/2.0/Contacts?where=${encodeURIComponent('Name.Contains("Glenmore") OR Name.Contains("Vipul") OR Name.Contains("GLENMORE")')}`, { headers: XH });
const contacts = (await cRes.json()).Contacts ?? [];
const ids = new Set(contacts.map((c) => c.ContactID));
if (inv6000?.Contact?.ContactID) ids.add(inv6000.Contact.ContactID);
console.log(`\nMatched contacts: ${contacts.map((c) => c.Name).join(" | ") || "(none beyond INV-6000's)"}`);

// 3. All invoices for those contacts (last 18 months)
for (const cid of ids) {
  const iRes = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?ContactIDs=${cid}&where=${encodeURIComponent('Type=="ACCREC"')}&order=Date DESC&page=1`, { headers: XH });
  const invs = (await iRes.json()).Invoices ?? [];
  console.log(`\n── Invoices for contact ${cid} (${invs.length}):`);
  for (const i of invs) {
    console.log(`${(i.InvoiceNumber ?? "").padEnd(10)} | ${xeroDate(i.Date)} due ${xeroDate(i.DueDate)} | ${i.Status.padEnd(10)} | total ${String(i.Total).padStart(8)} | paid ${String(i.AmountPaid).padStart(8)} | due ${String(i.AmountDue).padStart(8)} | sent ${i.SentToContact ? "Y" : "n"} | ${(i.Reference ?? "").slice(0, 40)}`);
    for (const p of i.Payments ?? []) {
      console.log(`    payment ${xeroDate(p.Date)} $${p.Amount} (${p.PaymentID.slice(0, 8)})`);
    }
  }
}

// 4. GoCardless payments on the mandate
const GH = { Authorization: `Bearer ${env.GOCARDLESS_API_TOKEN}`, "GoCardless-Version": "2015-07-06", Accept: "application/json" };
const gcBase = (env.GOCARDLESS_ENVIRONMENT ?? "live") === "sandbox" ? "https://api-sandbox.gocardless.com" : "https://api.gocardless.com";
const pRes = await fetch(`${gcBase}/payments?mandate=MD003E5BRYDVX0&limit=60`, { headers: GH });
const pays = (await pRes.json()).payments ?? [];
console.log(`\n── GoCardless payments on MD003E5BRYDVX0 (${pays.length}):`);
for (const p of pays) {
  console.log(`${p.charge_date} | $${(p.amount / 100).toFixed(2).padStart(8)} | ${p.status.padEnd(22)} | ${(p.description ?? "").slice(0, 50)} | sub ${p.links?.subscription ?? "-"}`);
}
