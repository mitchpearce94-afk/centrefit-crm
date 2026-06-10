// Part 2: invoices under the "Snap Fitness Kellyville" and "Snap Fitness
// North Kellyville" Xero contacts — are both RI sets generating paid invoices?
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await supabase.from("xero_connections").select("tenant_id, access_token").order("updated_at", { ascending: false }).limit(1).single();

for (const name of ["Snap Fitness Kellyville", "Snap Fitness North Kellyville"]) {
  const where = encodeURIComponent(`Contact.Name=="${name}"`);
  const res = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?where=${where}&order=Date%20DESC&page=1`, {
    headers: { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" },
  });
  const data = await res.json();
  console.log(`\n=== Invoices: contact "${name}" (latest 12) ===`);
  for (const i of (data.Invoices ?? []).slice(0, 12)) {
    console.log(`${i.InvoiceNumber} ${i.DateString?.slice(0, 10)} $${i.Total} [${i.Status}] paid=$${i.AmountPaid} due=$${i.AmountDue} — ${(i.LineItems?.[0]?.Description ?? "").slice(0, 50)}`);
  }
  if (!(data.Invoices ?? []).length) console.log("(none)");
}
