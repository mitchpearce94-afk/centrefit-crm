// 2026-09-16 — live smoke for the billing-contact build (docs/billing-contact-CONTEXT.md).
// Creates a throwaway $1 DRAFT invoice in Xero, re-points it between two
// contacts, checks the D4 reference rule (site survives, no stacking), then
// deletes the draft. Nothing is emailed; nothing touches CRM rows.
//   npx tsx scripts/smoke-billing-contact.mts
import { readFileSync } from "node:fs";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";
import { getXeroContact, searchXeroContacts } from "@/lib/xero/contacts";
import { billToReference, createXeroInvoice, fetchXeroInvoice, updateXeroInvoiceContact } from "@/lib/xero/invoices";

for (const f of [".env.local", ".env.gc-probe"]) {
  try {
    for (const raw of readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split("\n")) {
      const line = raw.trim(); const i = line.indexOf("="); if (i < 1 || line.startsWith("#")) continue;
      const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim();
      if (!process.env[k]) process.env[k] = v;
    }
  } catch { /* optional */ }
}
const assert = (cond: unknown, msg: string) => { if (!cond) throw new Error("ASSERT: " + msg); console.log("  ok  " + msg); };

// 1. pure rule
assert(billToReference("Snap Fitness Austral", "Snap Fitness Austral", "CF-2026-0062") === "CF-2026-0062", "same entity → reference unchanged");
assert(billToReference("Snap Fitness Austral", "Workspace 360", "CF-2026-0062") === "Snap Fitness Austral - CF-2026-0062", "other entity → site prefixed");
assert(billToReference("Snap Fitness Austral", "Workspace 360", null) === "Snap Fitness Austral", "other entity, no ref → site only");
assert(billToReference("Snap Fitness Austral", "Workspace 360", "Snap Fitness Austral - CF-2026-0062") === "Snap Fitness Austral - CF-2026-0062", "already prefixed → not stacked");
assert(billToReference(null, "Workspace 360", "CF-1") === "CF-1", "no site → unchanged");
assert(billToReference("Planet Fitness Oxley", "Bravofit Oxley Pty Ltd", "CF-9") === "Planet Fitness Oxley - CF-9", "Bravofit-style entity → site prefixed");
assert(billToReference("Snap Fitness — Tuggerah", "Snap Fitness Tuggerah", "CF-2") === "CF-2", "punctuation-different same entity → unchanged");

// 2. live Xero
const supabase = createServiceRoleClient();
const { client, conn } = await getAuthedClient(supabase as never);
const T = conn.tenant_id;
const found = await searchXeroContacts(client, T, "workspace");
console.log("  search 'workspace' →", found.map((c) => `${c.name} [${c.addressLine ?? "-"}]`).join(" | "));
assert(found.some((c) => c.id === "aa1bc05c-d31b-4712-b6a8-8d3e560aa561"), "search finds Workspace 360 (case-insensitive variant)");
const ws = await getXeroContact(client, T, "aa1bc05c-d31b-4712-b6a8-8d3e560aa561");
assert(ws?.name === "Workspace 360", "getXeroContact returns Workspace 360");

// account code from a real invoice line so Xero accepts the draft
const { data: sample } = await supabase.from("invoices").select("line_items").eq("xero_invoice_number", "INV-6909").single();
const li = (sample?.line_items as Array<{ accountCode?: string; taxType?: string }>)?.find((l) => l.accountCode);
assert(li?.accountCode, `sample account code ${li?.accountCode}`);

const AUSTRAL = "e3533a0b-3aca-4645-8c13-e3691ad9ebd4"; // "Snap Fitness Austral" contact
const created = await createXeroInvoice({
  xero: client, tenantId: T, xeroContactId: AUSTRAL,
  lineItems: [{ description: "SMOKE TEST — delete me", quantity: 1, unitAmount: 1, accountCode: li!.accountCode!, taxType: li!.taxType ?? "OUTPUT" } as never],
  reference: "SMOKE-REF", siteName: "Snap Fitness Austral",
});
console.log("  draft", created.invoiceID, created.invoiceNumber, "status", created.status, "contact", created.contactName, "ref", created.reference);
try {
  assert(created.status === "DRAFT", "throwaway is a DRAFT");
  assert(created.contactName === "Snap Fitness Austral", "createXeroInvoice returns the contact name");
  assert(created.reference === "SMOKE-REF", "same-entity reference unchanged on create");

  const r1 = await updateXeroInvoiceContact({ xero: client, tenantId: T, xeroInvoiceId: created.invoiceID, xeroContactId: ws!.id, siteName: "Snap Fitness Austral" });
  console.log("  re-point →", r1);
  assert(r1.contactName === "Workspace 360", "re-pointed to Workspace 360");
  assert(r1.reference === "Snap Fitness Austral - SMOKE-REF", "site prefixed after re-point");

  const r2 = await updateXeroInvoiceContact({ xero: client, tenantId: T, xeroInvoiceId: created.invoiceID, xeroContactId: ws!.id, siteName: "Snap Fitness Austral" });
  assert(r2.reference === "Snap Fitness Austral - SMOKE-REF", "second re-point does not stack the prefix");

  const r3 = await updateXeroInvoiceContact({ xero: client, tenantId: T, xeroInvoiceId: created.invoiceID, xeroContactId: AUSTRAL, siteName: "Snap Fitness Austral" });
  assert(r3.contactName === "Snap Fitness Austral" && r3.reference === "SMOKE-REF", "back to the site contact → prefix removed");

  const live = await fetchXeroInvoice(client, T, created.invoiceID);
  assert(live.contactName === "Snap Fitness Austral" && live.reference === "SMOKE-REF", "fetchXeroInvoice exposes contactName + reference");
} finally {
  const del = await client.accountingApi.updateInvoice(T, created.invoiceID, { invoices: [{ invoiceID: created.invoiceID, status: "DELETED" } as never] });
  console.log("  throwaway deleted →", del.body.invoices?.[0]?.status);
}
console.log("SMOKE PASSED");
