import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * POST /api/receipts/[id]/link — link a captured receipt to a job.
 * Body: { job_id, amount?, vendor?, receipt_date? }.
 *
 * Side effects:
 *  - stamps job_id + amount/vendor/date on the receipt
 *  - copies the receipt image into the public job-attachments bucket and
 *    appends it to a single "Receipt" note on the job (one note per job, extra
 *    receipts stack as additional attachments — Mitchell's spec).
 *
 * Note writes go through the service-role client: job_notes has no UPDATE RLS
 * policy (so appending to an existing note silently failed for the 2nd+ receipt),
 * and a receipt may be linked by a different staff member than the one who
 * created the note. The invoice "Parts Used" line is added separately when the
 * job invoice is built (receipt stays added_to_invoice=false until then).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = createServiceRoleClient();

  const body = await req.json().catch(() => ({}));
  const jobId = (body?.job_id ?? "").toString().trim();
  if (!jobId) return NextResponse.json({ error: "job_id is required" }, { status: 400 });
  const amountRaw = body?.amount;
  const amount = amountRaw === "" || amountRaw == null ? null : Number(amountRaw);
  const vendor = body?.vendor ? String(body.vendor).trim() || null : undefined;
  const receiptDate = body?.receipt_date ? String(body.receipt_date).trim() || null : undefined;

  const { data: receipt, error: rErr } = await db
    .from("receipts")
    .select("id, storage_path, note_id")
    .eq("id", id)
    .maybeSingle();
  if (rErr || !receipt) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });

  const { data: job } = await db.from("jobs").select("id, number").eq("id", jobId).maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // Copy the image out of the receipts bucket into job-attachments (both
  // private) so the job note can render it like any other photo — served
  // via the authenticated /api/attachments proxy.
  let publicUrl: string | null = null;
  let imgType = "image/jpeg";
  const ext = receipt.storage_path.split(".").pop() || "jpg";
  const noteImagePath = `${jobId}/notes/receipt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { data: dl, error: dlErr } = await db.storage.from("receipts").download(receipt.storage_path);
  if (!dlErr && dl) {
    imgType = dl.type || "image/jpeg";
    const buf = Buffer.from(await dl.arrayBuffer());
    const { error: upErr } = await db.storage
      .from("job-attachments")
      .upload(noteImagePath, buf, { contentType: imgType, upsert: false });
    if (!upErr) {
      publicUrl = `/api/attachments/${noteImagePath}`;
    }
  }

  const attachment = publicUrl
    ? { url: publicUrl, name: vendor ? `Receipt — ${vendor}` : "Receipt", type: imgType }
    : null;

  // Find the job's existing "Receipt" note, or create one. Append the image.
  const { data: existingNote } = await db
    .from("job_notes")
    .select("id, attachments")
    .eq("job_id", jobId)
    .eq("title", "Receipt")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let noteId = existingNote?.id ?? receipt.note_id ?? null;

  if (existingNote) {
    const current = Array.isArray(existingNote.attachments) ? existingNote.attachments : [];
    const next = attachment ? [...current, attachment] : current;
    await db
      .from("job_notes")
      .update({
        attachments: next,
        image_url: next.find((a: { type?: string }) => (a.type ?? "").startsWith("image"))?.url ?? null,
      })
      .eq("id", existingNote.id);
    noteId = existingNote.id;
  } else {
    const { data: created } = await db
      .from("job_notes")
      .insert({
        job_id: jobId,
        staff_id: user.id,
        title: "Receipt",
        content: "Receipts captured via the receipt scanner.",
        type: "note",
        attachments: attachment ? [attachment] : [],
        image_url: attachment?.url ?? null,
      })
      .select("id")
      .single();
    noteId = created?.id ?? null;
  }

  const { error: updErr } = await db
    .from("receipts")
    .update({
      job_id: jobId,
      note_id: noteId,
      ...(amount != null && !Number.isNaN(amount) ? { amount } : {}),
      ...(vendor !== undefined ? { vendor } : {}),
      ...(receiptDate !== undefined ? { receipt_date: receiptDate } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, jobNumber: job.number, noteId });
}
