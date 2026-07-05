/**
 * Phase D smoke helper: mirrors /api/sites/[id]/handover/generate in "send"
 * mode WITHOUT sending an email — assembles + stores the pack, creates the
 * doc row + acceptance sign request, prints the token so the public flow
 * can be exercised. Prints the created IDs for cleanup.
 * Run: npx --yes tsx scripts/smoke-handover-send.tsx <siteId> <recipientEmail>
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { assembleHandoverPack, buildHandoverInput } from "../src/lib/handover/assemble";

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, "../.env.gc-probe"), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);

const siteId = process.argv[2];
const recipientEmail = process.argv[3];
if (!siteId || !recipientEmail) {
  console.error("usage: tsx scripts/smoke-handover-send.tsx <siteId> <recipientEmail>");
  process.exit(1);
}

async function main() {
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const input = await buildHandoverInput(sb, siteId);
  const pack = await assembleHandoverPack(sb, input);

  const storagePath = `sites/${siteId}/handover/${Date.now()}-handover-pack.pdf`;
  const { error: upError } = await sb.storage.from("site-documents").upload(storagePath, pack, { contentType: "application/pdf" });
  if (upError) throw new Error(upError.message);

  const { data: docRow, error: docError } = await sb
    .from("site_documents")
    .insert({
      site_id: siteId,
      category: "handover",
      name: `Handover Documentation - ${input.siteName} - SMOKE TEST`,
      storage_path: storagePath,
      mime_type: "application/pdf",
      size_bytes: pack.length,
      status: "sent",
    })
    .select("id").single();
  if (docError) throw new Error(docError.message);

  const token = crypto.randomBytes(32).toString("hex");
  const { data: reqRow, error: reqError } = await sb
    .from("document_sign_requests")
    .insert({
      site_id: siteId,
      site_document_id: docRow!.id,
      document_type: "handover",
      token,
      recipient_name: "Mitchell Pearce",
      recipient_email: recipientEmail,
      status: "sent",
      version: 1,
      prefill: { siteName: input.siteName, clientName: input.clientName, dateDisplay: input.dateDisplay, storagePath },
      sent_at: new Date().toISOString(),
    })
    .select("id").single();
  if (reqError) throw new Error(reqError.message);

  console.log(JSON.stringify({
    requestId: reqRow!.id,
    documentId: docRow!.id,
    storagePath,
    packBytes: pack.length,
    url: `https://crm.centrefit.com.au/handover/${token}`,
    pdfUrl: `https://crm.centrefit.com.au/api/public/handover/${token}/pdf`,
  }, null, 2));
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
