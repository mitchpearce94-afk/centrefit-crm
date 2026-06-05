import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

const VISION_MIME: Record<string, "image/jpeg" | "image/png" | "image/webp" | "image/gif"> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};

/**
 * POST /api/receipts/[id]/read — read the total + vendor + date off a receipt
 * image with Claude vision. Returns { available:false } when no ANTHROPIC_API_KEY
 * is set or the image format can't be read, so the UI quietly falls back to
 * manual entry.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ available: false, reason: "no_api_key" });
  }

  const { data: receipt } = await supabase
    .from("receipts")
    .select("id, storage_path")
    .eq("id", id)
    .maybeSingle();
  if (!receipt) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });

  const { data: blob, error: dlErr } = await supabase.storage.from("receipts").download(receipt.storage_path);
  if (dlErr || !blob) return NextResponse.json({ available: false, reason: "download_failed" });

  const mime = VISION_MIME[blob.type?.toLowerCase() ?? ""];
  if (!mime) return NextResponse.json({ available: false, reason: "unsupported_format" });

  const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mime, data: base64 } },
            {
              type: "text",
              text:
                "This is a purchase receipt. Extract the GRAND TOTAL actually paid (GST/tax inclusive) as a plain number, the vendor/merchant name, and the purchase date. " +
                'Respond with ONLY a JSON object, no prose: {"amount": <number|null>, "vendor": <string|null>, "date": <"YYYY-MM-DD"|null>}.',
            },
          ],
        },
      ],
    });

    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const jsonStr = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    let parsed: { amount?: unknown; vendor?: unknown; date?: unknown } = {};
    try { parsed = JSON.parse(jsonStr); } catch { /* fall through to nulls */ }

    const amount = typeof parsed.amount === "number" ? parsed.amount : (parsed.amount != null && !Number.isNaN(Number(parsed.amount)) ? Number(parsed.amount) : null);
    const vendor = typeof parsed.vendor === "string" && parsed.vendor.trim() ? parsed.vendor.trim().slice(0, 120) : null;
    const date = typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null;

    await supabase.from("receipts").update({ ocr_status: "done", updated_at: new Date().toISOString() }).eq("id", id);

    return NextResponse.json({ available: true, amount, vendor, date });
  } catch (err) {
    await supabase.from("receipts").update({ ocr_status: "failed", updated_at: new Date().toISOString() }).eq("id", id);
    return NextResponse.json({ available: false, reason: "ocr_error", error: err instanceof Error ? err.message : String(err) });
  }
}
