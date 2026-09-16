import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { brisbaneDateISO } from "@/lib/dates";
import { forwardReceiptEmail } from "@/lib/emails/receipt-forward";
import { readReceiptImage } from "./read";

/**
 * Receipts "Snap" — the phone path (Mitchell 2026-08-26).
 *
 * The desktop scanner asked for a job, an amount and a vendor AFTER the
 * shutter, and then emailed accounts@. Nobody used it. This path is
 * icon → shutter → done: the upload returns as soon as the image is stored,
 * then in the background we read the receipt with Claude, stamp vendor /
 * amount / date on the row, and forward the image to Xero's bills inbox so
 * Xero's own capture turns it into a draft bill for the finance officer.
 */

export interface ReceiptDestination {
  to: string;
  cc: string[];
  viaXero: boolean;
}

/** Xero bills inbox when configured (accounts CC'd), else the accounts mailbox. */
export async function resolveReceiptDestination(db: SupabaseClient): Promise<ReceiptDestination> {
  const { data } = await db
    .from("billing_settings")
    .select("receipt_forward_email, xero_bills_email")
    .limit(1)
    .maybeSingle();
  const accounts = (data?.receipt_forward_email ?? "").trim() || "accounts@centrefit.com.au";
  const xero = (data?.xero_bills_email ?? "").trim();
  if (xero) {
    return { to: xero, cc: accounts.toLowerCase() === xero.toLowerCase() ? [] : [accounts], viaXero: true };
  }
  return { to: accounts, cc: [], viaXero: false };
}

export interface JobLite {
  id: string;
  number: string | null;
  label: string;
}

/**
 * The jobs this tech is on today — most recently clocked-on first, then
 * anything scheduled. Used to default the receipt's job with zero typing.
 */
export async function todaysJobsForStaff(db: SupabaseClient, staffId: string): Promise<JobLite[]> {
  const today = brisbaneDateISO(new Date());
  const dayStartIso = `${today}T00:00:00+10:00`;
  const [{ data: timeRows }, { data: schedRows }] = await Promise.all([
    db
      .from("job_time")
      .select("job_id, start_time")
      .eq("staff_id", staffId)
      .gte("start_time", dayStartIso)
      .order("start_time", { ascending: false }),
    db
      .from("schedule_entries")
      .select("job_id, start_time")
      .eq("staff_id", staffId)
      .eq("schedule_date", today)
      .not("job_id", "is", null)
      .order("start_time", { ascending: true }),
  ]);
  const ordered: string[] = [];
  for (const r of [...(timeRows ?? []), ...(schedRows ?? [])]) {
    if (r.job_id && !ordered.includes(r.job_id)) ordered.push(r.job_id);
  }
  if (ordered.length === 0) return [];

  const { data: jobs } = await db
    .from("jobs")
    .select("id, number, customer:customers(name), site:customer_sites(name)")
    .in("id", ordered);
  const byId = new Map<string, JobLite>();
  for (const j of (jobs ?? []) as unknown as Array<{
    id: string;
    number: string | null;
    customer: { name: string } | { name: string }[] | null;
    site: { name: string | null } | { name: string | null }[] | null;
  }>) {
    const site = Array.isArray(j.site) ? j.site[0] : j.site;
    const customer = Array.isArray(j.customer) ? j.customer[0] : j.customer;
    byId.set(j.id, {
      id: j.id,
      number: j.number,
      label: [j.number, site?.name ?? customer?.name].filter(Boolean).join(" · "),
    });
  }
  return ordered.map((id) => byId.get(id)).filter((j): j is JobLite => !!j);
}

export interface SnapProcessInput {
  db: SupabaseClient;
  receiptId: string;
  bytes: Buffer;
  mime: string;
  ext: string;
  staffName: string | null;
  jobNumber: string | null;
}

/**
 * Background half of a Snap upload: read the receipt, stamp the row, forward
 * the image. Every step is best-effort and recorded on the row — the image
 * is already safe in storage before this runs.
 */
export async function processSnapReceipt(input: SnapProcessInput): Promise<void> {
  const { db, receiptId, bytes, mime, ext, staffName, jobNumber } = input;
  const now = () => new Date().toISOString();

  let vendor: string | null = null;
  let amount: number | null = null;
  let receiptDate: string | null = null;
  try {
    const result = await readReceiptImage(bytes, mime);
    if (result.available) {
      vendor = result.read.vendor;
      amount = result.read.amount;
      receiptDate = result.read.date;
      await db
        .from("receipts")
        .update({ vendor, amount, receipt_date: receiptDate, ocr_status: "done", updated_at: now() })
        .eq("id", receiptId);
    } else if (result.reason === "ocr_error") {
      await db.from("receipts").update({ ocr_status: "failed", updated_at: now() }).eq("id", receiptId);
    }
  } catch (err) {
    console.error(`[receipts/snap] read failed for ${receiptId}:`, err);
  }

  const dest = await resolveReceiptDestination(db);
  const slug = vendor ? vendor.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 30).toLowerCase() : "";
  const filename = `receipt-${slug ? slug + "-" : ""}${receiptDate ?? brisbaneDateISO(new Date())}-${receiptId.slice(0, 6)}.${ext}`;
  const sent = await forwardReceiptEmail({
    to: dest.to,
    cc: dest.cc,
    filename,
    content: bytes,
    vendor,
    amount,
    receiptDate,
    jobNumber,
    uploadedByName: staffName,
  });
  await db
    .from("receipts")
    .update({
      email_sent: sent.ok,
      email_error: sent.ok ? null : (sent.error ?? "send failed"),
      forwarded_to: dest.to,
      updated_at: now(),
    })
    .eq("id", receiptId);
  if (!sent.ok) console.error(`[receipts/snap] forward failed for ${receiptId}: ${sent.error}`);
}

/** What the phone shows for one upload after the shutter (2026-09-16). */
export type SnapStage = "processing" | "forwarded" | "failed";
export interface SnapStatus {
  id: string;
  stage: SnapStage;
  vendor: string | null;
  amount: number | null;
  forwardedTo: string | null;
  error: string | null;
}

export function snapStatusOf(row: {
  id: string;
  email_sent: boolean | null;
  email_error: string | null;
  forwarded_to: string | null;
  vendor: string | null;
  amount: number | string | null;
}): SnapStatus {
  const stage: SnapStage = row.email_sent ? "forwarded" : row.email_error ? "failed" : "processing";
  return {
    id: row.id,
    stage,
    vendor: row.vendor,
    amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
    forwardedTo: row.forwarded_to,
    error: row.email_error,
  };
}

/**
 * Re-run the background half for a receipt whose forward never landed
 * (the `after()` hook was cut short, Resend hiccup, Xero inbox unset…).
 * Pulls the image back out of storage, so it works from any process — the
 * phone's Retry, the CRM, or the daily sweep. Idempotent: a receipt that
 * already forwarded is left alone.
 */
export async function reprocessSnapReceipt(
  db: SupabaseClient,
  receiptId: string,
): Promise<{ ok: boolean; skipped?: "already_forwarded" | "not_found"; error?: string }> {
  const { data: row } = await db
    .from("receipts")
    .select("id, storage_path, email_sent, job_id, uploaded_by, staff:staff!receipts_uploaded_by_fkey(display_name), job:jobs(number)")
    .eq("id", receiptId)
    .maybeSingle();
  if (!row) return { ok: false, skipped: "not_found" };
  if (row.email_sent) return { ok: true, skipped: "already_forwarded" };
  const { data: file, error: dlErr } = await db.storage.from("receipts").download(row.storage_path);
  if (dlErr || !file) return { ok: false, error: `image missing in storage: ${dlErr?.message ?? "unknown"}` };
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = (row.storage_path.split(".").pop() || "jpg").toLowerCase();
  const mime = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "heic" || ext === "heif" ? "image/heic" : "image/jpeg";
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
  const staffName = one(row.staff as { display_name: string | null } | { display_name: string | null }[] | null)?.display_name ?? null;
  const jobNumber = one(row.job as { number: string | null } | { number: string | null }[] | null)?.number ?? null;
  // clear a previous failure so the phone shows "processing" while we retry
  await db.from("receipts").update({ email_error: null, updated_at: new Date().toISOString() }).eq("id", receiptId);
  await processSnapReceipt({ db, receiptId, bytes, mime, ext, staffName, jobNumber });
  const { data: after } = await db.from("receipts").select("email_sent, email_error").eq("id", receiptId).maybeSingle();
  return after?.email_sent ? { ok: true } : { ok: false, error: after?.email_error ?? "forward failed" };
}
