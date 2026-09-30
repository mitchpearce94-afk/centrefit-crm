import "server-only";
import { callBridge, bridgeConfigured } from "@/lib/llm/bridge";

const VISION_MIME: Record<string, string> = {
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
  | { available: false; reason: "not_configured" | "unsupported_format" | "ocr_error"; error?: string };

const PROMPT =
  "This is a purchase receipt. Extract the GRAND TOTAL actually paid (GST/tax inclusive) as a plain number, the vendor/merchant name, and the purchase date. " +
  'Respond with ONLY a JSON object, no prose, no code fences: {"amount": <number|null>, "vendor": <string|null>, "date": <"YYYY-MM-DD"|null>}.';

/**
 * Read the grand total, vendor and purchase date off a receipt image through
 * the Cortex LLM bridge (Mitchell's Claude subscription on the office mini —
 * never a paid API key). Shared by the desktop scanner's /read route and the
 * phone Snap path (which runs it in the background after responding).
 */
export async function readReceiptImage(bytes: Buffer, mime: string): Promise<ReceiptReadResult> {
  if (!bridgeConfigured()) return { available: false, reason: "not_configured" };
  const media = VISION_MIME[mime.toLowerCase()];
  if (!media) return { available: false, reason: "unsupported_format" };

  try {
    const out = await callBridge({
      prompt: PROMPT,
      model: "haiku",
      json: true,
      image: { data: bytes.toString("base64"), mime: media },
      timeoutMs: 90_000,
    });
    const parsed = (out.json && typeof out.json === "object" ? out.json : {}) as { amount?: unknown; vendor?: unknown; date?: unknown };

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
