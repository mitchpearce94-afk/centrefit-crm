import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { forwardReceiptEmail } from "@/lib/emails/receipt-forward";
import { brisbaneDateISO } from "@/lib/dates";
import { getCurrentStaff } from "@/lib/auth/current-staff";
import { resolveReceiptDestination } from "@/lib/receipts/snap";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]);
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * POST /api/receipts — capture a scanned receipt.
 * Multipart form-data: file (required), plus optional vendor, amount,
 * receipt_date, job_id. Stores the image in the private `receipts` bucket,
 * inserts a receipts row, and forwards the image to the configured accounts
 * mailbox as an email attachment (best-effort).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const staff = await getCurrentStaff();

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: "Invalid form data" }, { status: 400 }); }

  const file = form.get("file") as File | null;
  if (!file || file.size === 0) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 15 MB)" }, { status: 400 });
  if (!ALLOWED_MIME.has(file.type)) return NextResponse.json({ error: "Receipt must be an image or PDF" }, { status: 400 });

  const vendor = (String(form.get("vendor") ?? "").trim() || null);
  const amountRaw = String(form.get("amount") ?? "").trim();
  const amount = amountRaw ? Number(amountRaw) : null;
  const receiptDate = (String(form.get("receipt_date") ?? "").trim() || null);
  const jobId = (String(form.get("job_id") ?? "").trim() || null);

  const ext = file.type === "application/pdf" ? "pdf" : (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${new Date().getFullYear()}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await supabase.storage.from("receipts").upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });

  const { data: receipt, error: insErr } = await supabase
    .from("receipts")
    .insert({
      storage_path: path,
      vendor,
      amount: amount != null && !Number.isNaN(amount) ? amount : null,
      receipt_date: receiptDate,
      job_id: jobId,
      uploaded_by: staff?.id ?? user.id,
      source: "scanner",
    })
    .select("id")
    .single();
  if (insErr || !receipt) {
    return NextResponse.json({ error: `Saved image but failed to record: ${insErr?.message ?? "unknown"}` }, { status: 500 });
  }

  // Resolve job number (for the email subject/body) if linked.
  let jobNumber: string | null = null;
  if (jobId) {
    const { data: job } = await supabase.from("jobs").select("number").eq("id", jobId).maybeSingle();
    jobNumber = job?.number ?? null;
  }

  // Forward to Xero's bills inbox when configured (accounts CC'd), else accounts — best effort.
  const dest = await resolveReceiptDestination(supabase);

  const sent = await forwardReceiptEmail({
    to: dest.to,
    cc: dest.cc,
    uploadedByName: staff?.display_name ?? null,
    filename: `receipt-${vendor ? vendor.replace(/[^a-z0-9]+/gi, "-").slice(0, 30) + "-" : ""}${brisbaneDateISO()}.${ext}`,
    content: bytes,
    vendor,
    amount: amount != null && !Number.isNaN(amount) ? amount : null,
    receiptDate,
    jobNumber,
  });

  await supabase
    .from("receipts")
    .update({ email_sent: sent.ok, email_error: sent.ok ? null : (sent.error ?? "send failed"), forwarded_to: dest.to, updated_at: new Date().toISOString() })
    .eq("id", receipt.id);

  return NextResponse.json({ ok: true, id: receipt.id, emailSent: sent.ok, emailError: sent.ok ? null : sent.error });
}
