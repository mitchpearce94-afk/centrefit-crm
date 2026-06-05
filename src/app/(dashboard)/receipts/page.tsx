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

  const [{ data }, { data: jobsData }] = await Promise.all([
    supabase
      .from("receipts")
      .select("id, storage_path, vendor, amount, receipt_date, job_id, added_to_invoice, email_sent, email_error, created_at, job:jobs(id, number)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("jobs")
      .select("id, number, customer:customers(name), site:customer_sites(name)")
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  const raw = (data ?? []) as unknown as RawReceipt[];

  const jobs = ((jobsData ?? []) as unknown as {
    id: string;
    number: string | null;
    customer: { name: string } | null;
    site: { name: string | null } | null;
  }[]).map((j) => ({
    id: j.id,
    number: j.number,
    label: [j.number, j.site?.name ?? j.customer?.name].filter(Boolean).join(" · "),
  }));

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
    imageUrl: null,
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
        <ReceiptsClient receipts={receipts} jobs={jobs} />
      </div>
    </div>
  );
}
