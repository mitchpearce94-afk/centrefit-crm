import { createClient } from "@/lib/supabase/server";
import { ReceiptsClient, type ReceiptRow } from "./receipts-client";

export const dynamic = "force-dynamic";

interface RawReceipt {
  id: string;
  storage_path: string;
  vendor: string | null;
  amount: number | null;
  receipt_date: string | null;
  job_id: string | null;
  added_to_invoice: boolean;
  email_sent: boolean;
  email_error: string | null;
  created_at: string;
  job: { id: string; number: string | null } | null;
}

export default async function ReceiptsPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("receipts")
    .select("id, storage_path, vendor, amount, receipt_date, job_id, added_to_invoice, email_sent, email_error, created_at, job:jobs(id, number)")
    .order("created_at", { ascending: false })
    .limit(200);

  const raw = (data ?? []) as unknown as RawReceipt[];

  // Batch-sign the thumbnails (private bucket). 1-hour URLs are fine for a
  // page view; the list re-signs on each load.
  const paths = raw.map((r) => r.storage_path);
  const signedByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from("receipts").createSignedUrls(paths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) signedByPath.set(s.path, s.signedUrl);
    }
  }

  const receipts: ReceiptRow[] = raw.map((r) => ({
    id: r.id,
    vendor: r.vendor,
    amount: r.amount,
    receiptDate: r.receipt_date,
    jobId: r.job?.id ?? null,
    jobNumber: r.job?.number ?? null,
    addedToInvoice: r.added_to_invoice,
    emailSent: r.email_sent,
    emailError: r.email_error,
    createdAt: r.created_at,
    imageUrl: signedByPath.get(r.storage_path) ?? null,
    isPdf: r.storage_path.toLowerCase().endsWith(".pdf"),
  }));

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Receipts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Scan or upload a receipt — it&rsquo;s emailed to accounts and stored here. Link one to a job to read the amount and push it onto the job&rsquo;s invoice.
        </p>
      </div>
      <div className="mt-5">
        <ReceiptsClient receipts={receipts} />
      </div>
    </div>
  );
}
