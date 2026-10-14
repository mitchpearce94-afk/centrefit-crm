import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { brisbaneDateISO } from "@/lib/dates";
import { forwardReceiptEmail, type ReceiptTag } from "@/lib/emails/receipt-forward";
import { readReceiptImage } from "./read";

/**
 * Receipts "Snap" — the only receipt path (Mitchell 2026-08-26, reworked
 * 2026-10-15).
 *
 * Icon → shutter → done. The upload returns as soon as the image is stored;
 * then, in the background, the image is emailed STRAIGHT AWAY to the
 * accountant (Jig) with a one-line template subject, and only after that do
 * we read vendor / amount / date off it for the CRM's own job-invoice lines.
 * The email never waits on the read — that wait (20–35 s through the LLM
 * bridge) was the "taking ages to send" of Oct 2026.
 *
 * Fuel receipts carry a vehicle rego instead of a job ("Fuel" toggle on the
 * phone; regos come from billing_settings.fuel_regos).
 */

export interface ReceiptDestination {
  to: string;
  /** False when nothing is configured and we fell back to accounts@. */
  configured: boolean;
}

/** The accounts email receipts go to (Settings → Billing), else accounts@. */
export async function resolveReceiptDestination(db: SupabaseClient): Promise<ReceiptDestination> {
  const { data } = await db.from("billing_settings").select("receipt_forward_email").limit(1).maybeSingle();
  const to = (data?.receipt_forward_email ?? "").trim();
  if (to) return { to, configured: true };
  return { to: "accounts@centrefit.com.au", configured: false };
}

/** Regos the Fuel toggle offers, upper-cased, de-duplicated, in the admin's order. */
export async function fuelRegos(db: SupabaseClient): Promise<string[]> {
  const { data } = await db.from("billing_settings").select("fuel_regos").limit(1).maybeSingle();
  const raw = Array.isArray(data?.fuel_regos) ? (data.fuel_regos as unknown[]) : [];
  const out: string[] = [];
  for (const v of raw) {
    const rego = String(v ?? "").trim().toUpperCase().replace(/\s+/g, "");
    if (rego && !out.includes(rego)) out.push(rego);
  }
  return out;
}

/**
 * What the phone calls the destination: the staff member's first name when
 * the address belongs to someone on the team ("Sent to Jeremiah"), else the
 * address itself.
 */
export async function destinationLabel(db: SupabaseClient, email: string): Promise<string> {
  const { data } = await db.from("staff").select("display_name").ilike("email", email).limit(1).maybeSingle();
  const first = (data?.display_name ?? "").trim().split(/\s+/)[0];
  return first || email;
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
  tag: ReceiptTag;
}

/**
 * Background half of a Snap upload. Order matters: email first (that is what
 * the phone is waiting on), read second (CRM-only metadata). Every step is
 * best-effort and recorded on the row — the image is already in storage.
 */
export async function processSnapReceipt(input: SnapProcessInput): Promise<void> {
  const { db, receiptId, bytes, mime, ext, staffName, tag } = input;
  const now = () => new Date().toISOString();

  // 1. Forward straight away.
  const dest = await resolveReceiptDestination(db);
  const tail = tag.isFuel ? `fuel-${(tag.vehicleRego ?? "rego").toLowerCase()}` : tag.jobNumber ? tag.jobNumber.toLowerCase() : "no-job";
  const filename = `receipt-${tail}-${brisbaneDateISO(new Date())}-${receiptId.slice(0, 6)}.${ext}`;
  const sent = await forwardReceiptEmail({ to: dest.to, filename, content: bytes, tag, uploadedByName: staffName });
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

  // 2. Read vendor / amount / date for the CRM (job invoice "Parts Used" lines).
  try {
    const result = await readReceiptImage(bytes, mime);
    if (result.available) {
      await db
        .from("receipts")
        .update({
          vendor: result.read.vendor,
          amount: result.read.amount,
          receipt_date: result.read.date,
          ocr_status: "done",
          updated_at: now(),
        })
        .eq("id", receiptId);
    } else if (result.reason === "ocr_error") {
      await db.from("receipts").update({ ocr_status: "failed", updated_at: now() }).eq("id", receiptId);
    }
  } catch (err) {
    console.error(`[receipts/snap] read failed for ${receiptId}:`, err);
  }
}

/** What the phone shows for one upload after the shutter. */
export type SnapStage = "processing" | "forwarded" | "failed";
export interface SnapStatus {
  id: string;
  stage: SnapStage;
  forwardedTo: string | null;
  error: string | null;
}

export function snapStatusOf(row: {
  id: string;
  email_sent: boolean | null;
  email_error: string | null;
  forwarded_to: string | null;
}): SnapStatus {
  const stage: SnapStage = row.email_sent ? "forwarded" : row.email_error ? "failed" : "processing";
  return { id: row.id, stage, forwardedTo: row.forwarded_to, error: row.email_error };
}

/**
 * Re-run the background half for a receipt whose email never landed (the
 * `after()` hook was cut short, Resend hiccup…). Pulls the image back out of
 * storage, so it works from any process — the phone's Retry or the daily
 * sweep. Idempotent: a receipt that already forwarded is left alone.
 */
export async function reprocessSnapReceipt(
  db: SupabaseClient,
  receiptId: string,
): Promise<{ ok: boolean; skipped?: "already_forwarded" | "not_found"; error?: string }> {
  const { data: row } = await db
    .from("receipts")
    .select("id, storage_path, email_sent, is_fuel, vehicle_rego, staff:staff!receipts_uploaded_by_fkey(display_name), job:jobs(number)")
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
  const tag: ReceiptTag = { isFuel: Boolean(row.is_fuel), vehicleRego: row.vehicle_rego ?? null, jobNumber };
  // clear a previous failure so the phone shows "processing" while we retry
  await db.from("receipts").update({ email_error: null, updated_at: new Date().toISOString() }).eq("id", receiptId);
  await processSnapReceipt({ db, receiptId, bytes, mime, ext, staffName, tag });
  const { data: after } = await db.from("receipts").select("email_sent, email_error").eq("id", receiptId).maybeSingle();
  return after?.email_sent ? { ok: true } : { ok: false, error: after?.email_error ?? "forward failed" };
}
