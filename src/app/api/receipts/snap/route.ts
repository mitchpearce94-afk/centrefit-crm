import { NextRequest, NextResponse, after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { resolveSnapStaff } from "@/lib/receipts/snap-device";
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
  // Session OR paired-device cookie — this route is middleware-public so the
  // installed app can upload after its session dies. Always resolves to a
  // real, active staff member (uploads stay attributed).
  const auth = await resolveSnapStaff();
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const staff = auth.staff;
  const svc = createServiceRoleClient();

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

  // Service client throughout: device-authed requests carry no Supabase
  // session, and the caller is already verified above.
  const { error: upErr } = await svc.storage.from("receipts").upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });

  let jobNumber: string | null = null;
  if (jobId) {
    const { data: job } = await svc.from("jobs").select("number").eq("id", jobId).maybeSingle();
    jobNumber = job?.number ?? null;
  }

  const { data: receipt, error: insErr } = await svc
    .from("receipts")
    .insert({
      storage_path: path,
      job_id: jobId,
      uploaded_by: staff.id,
      source,
    })
    .select("id")
    .single();
  if (insErr || !receipt) {
    return NextResponse.json({ error: `Saved image but failed to record: ${insErr?.message ?? "unknown"}` }, { status: 500 });
  }

  after(async () => {
    await processSnapReceipt({
      db: svc,
      receiptId: receipt.id,
      bytes,
      mime: file.type,
      ext,
      staffName: staff.display_name,
      jobNumber,
    });
  });

  return NextResponse.json({ ok: true, id: receipt.id, jobNumber });
}
