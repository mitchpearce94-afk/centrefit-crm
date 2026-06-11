// RECOVERY: recreate the 10 legitimate Watagan invoices wrongly voided by
// gf-and-watagan.mjs C2 (its filter used the contact, which carried history).
// Recreates each with the SAME invoice number, dates, lines, AUTHORISED.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await sb.from("xero_connections").select("tenant_id, access_token").order("updated_at", { ascending: false }).limit(1).single();
const XH = { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function xero(path, method = "GET", body) {
  for (let a = 0; a < 4; a++) {
    const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { method, headers: XH, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 429) { await sleep((Number(res.headers.get("retry-after") ?? 6) + 1) * 1000); continue; }
    const text = await res.text();
    let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* */ }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${(j?.Elements?.[0]?.ValidationErrors?.map((v) => v.Message).join("; ")) ?? text.slice(0, 200)}`);
    return j;
  }
  throw new Error("rate-limited");
}
const xd = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : undefined; };

// The 10 wrongly-voided numbers (NOT 5873/5874 — those were today's correct voids)
const RESTORE = ["INV-5641", "INV-5651", "INV-5640", "INV-5304", "INV-5303", "INV-5300", "INV-5207", "INV-5012", "INV-5011", "INV-5010"];

const CONTACT = "870d75e9-917c-4d31-af05-67206b96d7d9";
const all = (await xero(`Invoices?where=${encodeURIComponent(`Contact.ContactID=Guid("${CONTACT}")`)}&order=Date%20DESC&page=1`)).Invoices ?? [];

let restored = 0, totalRestored = 0;
for (const num of RESTORE) {
  const old = all.find((i) => i.InvoiceNumber === num && i.Status === "VOIDED");
  if (!old) { console.log(`! ${num}: voided copy not found — CHECK MANUALLY`); continue; }
  // full detail (line items) needs the by-ID fetch
  const full = (await xero(`Invoices/${old.InvoiceID}`)).Invoices[0];
  const body = {
    Type: "ACCREC",
    Contact: { ContactID: CONTACT },
    InvoiceNumber: `${num}R`, // Xero blocks reuse of a voided number — R = reissued
    Date: xd(full.Date),
    DueDate: xd(full.DueDate),
    ...(full.Reference ? { Reference: full.Reference } : {}),
    LineAmountTypes: full.LineAmountTypes,
    ...(full.BrandingThemeID ? { BrandingThemeID: full.BrandingThemeID } : {}),
    CurrencyCode: full.CurrencyCode,
    Status: "AUTHORISED",
    LineItems: (full.LineItems ?? []).map((l) => ({
      Description: l.Description, Quantity: l.Quantity, UnitAmount: l.UnitAmount,
      AccountCode: l.AccountCode, TaxType: l.TaxType,
      ...(l.DiscountRate ? { DiscountRate: l.DiscountRate } : {}),
    })),
  };
  const created = (await xero("Invoices", "POST", { Invoices: [body] })).Invoices[0];
  // preserve sent status so reminder logic doesn't treat it as never-sent
  if (full.SentToContact) {
    await sleep(800);
    await xero(`Invoices/${created.InvoiceID}`, "POST", { InvoiceID: created.InvoiceID, SentToContact: true });
  }
  restored++;
  totalRestored += created.Total;
  console.log(`✓ ${num} recreated — $${created.Total} dated ${xd(full.Date)} due ${xd(full.DueDate)} [new id ${created.InvoiceID.slice(0, 8)}…]`);
  await sleep(1100);
}
console.log(`\n${restored}/${RESTORE.length} restored, $${totalRestored.toFixed(2)} of receivables back on the books.`);
