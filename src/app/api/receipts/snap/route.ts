import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getCurrentStaff } from "@/lib/auth/current-staff";
import { processSnapReceipt } from "@/lib/receipts/snap";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]);
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * POST /api/receipts/snap — one receipt from the phone camera or photo
 * picker. Multipart: file (required), job_id?, source? ("snap" | "bulk").
 *
 * Responds the moment the image is stored and the row exists, so the
 * shutter feels instant; reading the receipt and forwarding it to Xero
 * happen in `after()`. Who sent it is always stamped (uploaded_by).
 */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const staff = await getCurrentStaff();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = form.get("file") as File | null;
  if (!file || file.size === 0) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 15 MB)" }, { status: 400 });
  if (!ALLOWED_MIME.has(file.type)) return NextResponse.json({ error: "Receipt must be an image or PDF" }, { status: 400 });

  const jobId = String(form.get("job_id") ?? "").trim() || null;
  const source = String(form.get("source") ?? "snap") === "bulk" ? "bulk" : "snap";
  const ext = file.type === "application/pdf" ? "pdf" : (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${new Date().getFullYear()}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await supabase.storage.from("receipts").upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });

  let jobNumber: string | null = null;
  if (jobId) {
    const { data: job } = await supabase.from("jobs").select("number").eq("id", jobId).maybeSingle();
    jobNumber = job?.number ?? null;
  }

  const { data: receipt, error: insErr } = await supabase
    .from("receipts")
    .insert({
      storage_path: path,
      job_id: jobId,
      uploaded_by: staff?.id ?? user.id,
      source,
    })
    .select("id")
    .single();
  if (insErr || !receipt) {
    return NextResponse.json({ error: `Saved image but failed to record: ${insErr?.message ?? "unknown"}` }, { status: 500 });
  }

  const svc = createServiceRoleClient();
  after(async () => {
    await processSnapReceipt({
      db: svc,
      receiptId: receipt.id,
      bytes,
      mime: file.type,
      ext,
      staffName: staff?.display_name ?? null,
      jobNumber,
    });
  });

  return NextResponse.json({ ok: true, id: receipt.id, jobNumber });
}
