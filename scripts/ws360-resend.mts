// 2026-09-16 — resend INV-6909 / INV-6900 to Workspace 360 after the Xero
// contact change, doing exactly what POST /api/invoices/[id]/send does but
// from a script (the CRM has no staff session on this PC).
//   npx tsx scripts/ws360-resend.mts --dry      # fetch the PDFs, save them, send nothing
//   npx tsx scripts/ws360-resend.mts --send     # email both to the recipient below
import { readFileSync, writeFileSync } from "node:fs";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { sendInvoiceEmail } from "@/lib/emails/invoice-send";
import { getAuthedClient } from "@/lib/xero/client";
import { markXeroInvoiceSent, fetchXeroInvoicePdf } from "@/lib/xero/invoices";
import { logDocumentActivity } from "@/lib/activity/log";
import { enqueueNotification } from "@/lib/notifications/enqueue";

for (const f of [".env.local", ".env.gc-probe"]) {
  try {
    for (const line of readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split("\n")) {
      const i = line.indexOf("="); if (i < 1 || line.trim().startsWith("#")) continue;
      const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim().replace(/^"|"$/g, "");
      if (!process.env[k]) process.env[k] = v;
    }
  } catch { /* optional */ }
}
const MODE = process.argv.includes("--send") ? "send" : "dry";
const TO = "finance@workspace360.com.au";
const OUT = "C:/Users/mitch/AppData/Local/Temp/claude/C--Users-mitch-Projects/70233de6-2478-42f2-b6e1-85ba7c0421fc/scratchpad";
const IDS = ["fb07dfe0-99fb-421a-a85e-8459ec5b6e81", "327a347a-f084-4ce4-ab17-3b07aace7dda"];

const supabase = createServiceRoleClient();
const { client, conn } = await getAuthedClient(supabase as never);
const tenantId = conn.tenant_id;

for (const id of IDS) {
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select(`id, invoice_type, status, total, amount_due, due_date, xero_invoice_id, xero_invoice_number, xero_online_url,
             customer:customers(id, name, customer_contacts(name, email, is_primary))`)
    .eq("id", id).single();
  if (error || !invoice) throw new Error(`invoice ${id}: ${error?.message ?? "not found"}`);
  type C = { id: string; name: string; customer_contacts: { name: string | null; email: string | null; is_primary: boolean | null }[] };
  const customer: C | null = Array.isArray(invoice.customer) ? ((invoice.customer[0] as C | undefined) ?? null) : (invoice.customer as C | null);
  const contacts = customer?.customer_contacts ?? [];
  const matched = contacts.find((c) => c.email && c.email.toLowerCase() === TO) ?? contacts.find((c) => c.is_primary) ?? contacts[0] ?? null;
  const firstName = matched?.name?.trim().split(/\s+/)[0] ?? null;
  const ref = invoice.xero_invoice_number ?? invoice.id.slice(0, 8);
  if (!invoice.xero_invoice_id) throw new Error(`${ref}: no xero invoice id`);
  const pdfBuffer = await fetchXeroInvoicePdf(client, tenantId, invoice.xero_invoice_id);
  const payUrl = invoice.xero_online_url ?? null;
  console.log(`${ref}: customer "${customer?.name}", greeting ${firstName ?? "(none)"}, total ${invoice.total}, due ${invoice.due_date}, pdf ${pdfBuffer?.length ?? 0} B, payUrl ${payUrl ? "yes" : "NO"}`);
  if (!pdfBuffer || !payUrl) throw new Error(`${ref}: missing pdf or pay link — refusing`);
  if (MODE === "dry") { writeFileSync(`${OUT}/${ref}.pdf`, pdfBuffer); console.log(`  saved ${OUT}/${ref}.pdf`); continue; }

  const sent = await sendInvoiceEmail({
    to: TO, invoiceRef: ref, customerName: customer?.name ?? "—", contactFirstName: firstName,
    total: Number(invoice.total) || 0, dueDate: invoice.due_date ?? null, invoiceType: invoice.invoice_type ?? "full",
    payUrl, invoiceId: invoice.id, pdfBuffer,
  });
  if (!sent.ok) throw new Error(`${ref}: send failed: ${sent.error}`);
  await supabase.from("invoices").update({ sent_at: new Date().toISOString(), sent_to_email: TO }).eq("id", id);
  try { await markXeroInvoiceSent(client, tenantId, invoice.xero_invoice_id); } catch (e) { console.error(`  xero SentToContact: ${(e as Error).message}`); }
  await logDocumentActivity({ supabase: supabase as never, documentType: "invoice", documentId: id, eventType: "invoice.sent", metadata: { to: TO, ref, note: "resent after billing name changed to Workspace 360" } });
  await enqueueNotification({ supabase: supabase as never, typeCode: "invoice.sent", refType: "invoice", refId: id, audience: { allActive: true }, title: `Invoice ${ref} emailed`, body: `${customer?.name ?? "—"} — resent to ${TO} (billed to Workspace 360)`, href: `/invoices/${id}` });
  console.log(`  SENT ${ref} → ${TO}`);
}
console.log(MODE === "dry" ? "dry run complete — nothing sent" : "done");
