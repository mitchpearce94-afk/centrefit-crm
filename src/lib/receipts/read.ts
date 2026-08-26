import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const VISION_MIME: Record<string, "image/jpeg" | "image/png" | "image/webp" | "image/gif"> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};

export interface ReceiptRead {
  amount: number | null;
  vendor: string | null;
  date: string | null;
}

export type ReceiptReadResult =
  | { available: true; read: ReceiptRead }
  | { available: false; reason: "no_api_key" | "unsupported_format" | "ocr_error"; error?: string };

/**
 * Read the grand total, vendor and purchase date off a receipt image with
 * Claude vision. Shared by the desktop scanner's /read route and the phone
 * Snap path (which runs it in the background after responding).
 */
export async function readReceiptImage(bytes: Buffer, mime: string): Promise<ReceiptReadResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { available: false, reason: "no_api_key" };
  const media = VISION_MIME[mime.toLowerCase()];
  if (!media) return { available: false, reason: "unsupported_format" };

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: media, data: bytes.toString("base64") } },
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
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      /* fall through to nulls */
    }

    const amount =
      typeof parsed.amount === "number"
        ? parsed.amount
        : parsed.amount != null && !Number.isNaN(Number(parsed.amount))
        ? Number(parsed.amount)
        : null;
    const vendor = typeof parsed.vendor === "string" && parsed.vendor.trim() ? parsed.vendor.trim().slice(0, 120) : null;
    const date = typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null;
    return { available: true, read: { amount, vendor, date } };
  } catch (err) {
    return { available: false, reason: "ocr_error", error: err instanceof Error ? err.message : String(err) };
  }
}
