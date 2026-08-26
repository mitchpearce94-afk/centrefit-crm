import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readReceiptImage } from "@/lib/receipts/read";

/**
 * POST /api/receipts/[id]/read — read the total + vendor + date off a receipt
 * image with Claude vision. Returns { available:false } when no ANTHROPIC_API_KEY
 * is set or the image format can't be read, so the UI quietly falls back to
 * manual entry. The actual reading lives in lib/receipts/read.ts (shared with
 * the phone Snap path).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: receipt } = await supabase
    .from("receipts")
    .select("id, storage_path")
    .eq("id", id)
    .maybeSingle();
  if (!receipt) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });

  const { data: blob, error: dlErr } = await supabase.storage.from("receipts").download(receipt.storage_path);
  if (dlErr || !blob) return NextResponse.json({ available: false, reason: "download_failed" });

  const result = await readReceiptImage(Buffer.from(await blob.arrayBuffer()), blob.type ?? "");
  const now = new Date().toISOString();
  if (result.available) {
    await supabase.from("receipts").update({ ocr_status: "done", updated_at: now }).eq("id", id);
    return NextResponse.json({ available: true, ...result.read });
  }
  if (result.reason === "ocr_error") {
    await supabase.from("receipts").update({ ocr_status: "failed", updated_at: now }).eq("id", id);
  }
  return NextResponse.json({ available: false, reason: result.reason, error: result.error });
}
