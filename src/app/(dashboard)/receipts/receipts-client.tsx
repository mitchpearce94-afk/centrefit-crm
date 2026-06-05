"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ui/toast";

export interface ReceiptRow {
  id: string;
  vendor: string | null;
  amount: number | null;
  receiptDate: string | null;
  jobId: string | null;
  jobNumber: string | null;
  addedToInvoice: boolean;
  emailSent: boolean;
  emailError: string | null;
  createdAt: string;
  imageUrl: string | null;
  isPdf: boolean;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

export function ReceiptsClient({ receipts }: { receipts: ReceiptRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    setUploading(true);
    let ok = 0;
    let emailFails = 0;
    try {
      for (const file of list) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/receipts", { method: "POST", body: fd });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast(json.error ?? "Upload failed", "error");
          continue;
        }
        ok++;
        if (!json.emailSent) emailFails++;
      }
      if (ok > 0) {
        toast(
          emailFails > 0
            ? `${ok} receipt${ok === 1 ? "" : "s"} saved — but the email forward failed (check accounts mailbox setting)`
            : `${ok} receipt${ok === 1 ? "" : "s"} saved and emailed to accounts`,
          emailFails > 0 ? "error" : "success",
        );
        router.refresh();
      }
    } finally {
      setUploading(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
            <circle cx="12" cy="13" r="3" />
          </svg>
          {uploading ? "Uploading…" : "Scan receipt"}
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="rounded-md border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
        >
          Upload file
        </button>
        {/* Camera capture (mobile) */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {/* Plain file / multi-select (desktop or gallery) */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {receipts.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No receipts yet. Tap <span className="font-medium text-foreground">Scan receipt</span> to capture one — it&rsquo;ll be emailed to accounts and listed here.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {receipts.map((r) => (
            <div key={r.id} className="rounded-lg border border-border bg-card overflow-hidden">
              <a href={r.imageUrl ?? "#"} target="_blank" rel="noopener noreferrer" className="block">
                {r.isPdf ? (
                  <div className="flex h-36 w-full items-center justify-center bg-muted/40 text-xs text-muted-foreground">PDF receipt</div>
                ) : r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.imageUrl} alt={r.vendor ?? "Receipt"} className="h-36 w-full object-cover" />
                ) : (
                  <div className="flex h-36 w-full items-center justify-center bg-muted/40 text-xs text-muted-foreground">No preview</div>
                )}
              </a>
              <div className="p-2.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium">{r.vendor ?? "Receipt"}</span>
                  <span className="shrink-0 text-xs font-mono text-foreground">{r.amount != null ? `$${Number(r.amount).toFixed(2)}` : "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span>{fmtDate(r.createdAt)}</span>
                  {r.jobNumber ? (
                    <Link href={`/jobs/${r.jobId}`} className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-primary hover:bg-primary/20">
                      {r.jobNumber}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground/60">No job</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 pt-0.5">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${r.emailSent ? "bg-emerald-500" : "bg-amber-500"}`}
                    title={r.emailSent ? "Emailed to accounts" : r.emailError ?? "Email pending"}
                  />
                  <span className="text-[10px] text-muted-foreground">{r.emailSent ? "Emailed" : "Not emailed"}</span>
                  {r.addedToInvoice && <span className="ml-auto text-[10px] text-emerald-500">On invoice</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
