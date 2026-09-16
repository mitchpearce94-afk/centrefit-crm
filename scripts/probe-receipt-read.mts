// 2026-09-16 — why does every Snap receipt end up ocr_status=failed? Run the
// real reader against a stored receipt image and print the error, then try
// the dated Haiku model id.  npx tsx scripts/probe-receipt-read.mts [receiptId]
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { readReceiptImage } from "@/lib/receipts/read";

for (const f of [".env.local", ".env.gc-probe"]) {
  try {
    for (const raw of readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split("\n")) {
      const line = raw.trim(); const i = line.indexOf("="); if (i < 1 || line.startsWith("#")) continue;
      const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim();
      if (!process.env[k]) process.env[k] = v;
    }
  } catch { /* optional */ }
}
const id = process.argv[2] ?? "34041600-685b-4422-ac64-88a482636731";
const svc = createServiceRoleClient();
const { data: row } = await svc.from("receipts").select("storage_path").eq("id", id).single();
if (!row) throw new Error("receipt not found");
const { data: file, error } = await svc.storage.from("receipts").download(row.storage_path);
if (error || !file) throw new Error("download failed: " + error?.message);
const bytes = Buffer.from(await file.arrayBuffer());
const ext = row.storage_path.split(".").pop()!.toLowerCase();
const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
console.log("image", row.storage_path, bytes.length, "bytes", mime, "key set:", !!process.env.ANTHROPIC_API_KEY);

const r = await readReceiptImage(bytes, mime);
console.log("current reader →", JSON.stringify(r).slice(0, 300));

if (!r.available) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  for (const model of ["claude-haiku-4-5-20251001", "claude-sonnet-5"]) {
    try {
      const msg = await client.messages.create({
        model, max_tokens: 200,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data: bytes.toString("base64") } },
          { type: "text", text: 'Extract {"amount": <number|null>, "vendor": <string|null>, "date": <"YYYY-MM-DD"|null>} from this receipt. JSON only.' },
        ] }],
      });
      const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      console.log(model, "→", text.slice(0, 200));
    } catch (e) {
      console.log(model, "FAILED:", (e as Error).message.slice(0, 200));
    }
  }
}
