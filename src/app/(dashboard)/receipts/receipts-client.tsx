"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

export interface JobOption {
  id: string;
  number: string | null;
  label: string;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", { day: "2-digit", month: "short" });
}

export function ReceiptsClient({ receipts, jobs }: { receipts: ReceiptRow[]; jobs: JobOption[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    setUploading(true);
    let lastId: string | null = null;
    let ok = 0;
    let emailFails = 0;
    try {
      for (const file of list) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/receipts", { method: "POST", body: fd });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { toast(json.error ?? "Upload failed", "error"); continue; }
        ok++;
        lastId = json.id ?? null;
        if (!json.emailSent) emailFails++;
      }
      if (ok > 0) {
        toast(
          emailFails > 0 ? `Saved, but the email forward failed — check the accounts mailbox setting` : `Receipt saved and emailed`,
          emailFails > 0 ? "error" : "success",
        );
        router.refresh();
        // Single capture → jump straight into linking it to a job.
        if (ok === 1 && lastId) setLinkingId(lastId);
      }
    } finally {
      setUploading(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const linkingReceipt = receipts.find((r) => r.id === linkingId) ?? null;
  const unlinked = receipts.filter((r) => !r.jobId);

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
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      </div>

      {linkingReceipt && (
        <LinkPanel
          receipt={linkingReceipt}
          jobs={jobs}
          onClose={() => setLinkingId(null)}
          onLinked={() => { setLinkingId(null); router.refresh(); }}
        />
      )}

      {/* Unlinked receipts you can still attach to a job. Compact rows, no
          image gallery (Mitchell). Linked receipts live on their job. */}
      {unlinked.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Not linked to a job ({unlinked.length})
          </h2>
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {unlinked.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.emailSent ? "bg-emerald-500" : "bg-amber-500"}`} title={r.emailSent ? "Emailed to accounts" : r.emailError ?? "Email pending"} />
                <span className="flex-1 truncate">{r.vendor ?? "Receipt"}</span>
                <span className="font-mono text-xs text-muted-foreground">{r.amount != null ? `$${Number(r.amount).toFixed(2)}` : "—"}</span>
                <span className="text-[11px] text-muted-foreground w-12 text-right">{fmtDate(r.createdAt)}</span>
                <button
                  type="button"
                  onClick={() => setLinkingId(r.id)}
                  className="rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
                >
                  Link to job
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LinkPanel({
  receipt,
  jobs,
  onClose,
  onLinked,
}: {
  receipt: ReceiptRow;
  jobs: JobOption[];
  onClose: () => void;
  onLinked: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [jobId, setJobId] = useState<string>("");
  const [amount, setAmount] = useState(receipt.amount != null ? String(receipt.amount) : "");
  const [vendor, setVendor] = useState(receipt.vendor ?? "");
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);

  // Auto-read the amount/vendor with Claude vision when the panel opens.
  // Silently no-ops if the API key isn't configured — you just type it in.
  useEffect(() => {
    let cancelled = false;
    setReading(true);
    fetch(`/api/receipts/${receipt.id}/read`, { method: "POST" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.available) return;
        if (j.amount != null) setAmount((cur) => (cur ? cur : String(j.amount)));
        if (j.vendor) setVendor((cur) => (cur ? cur : j.vendor));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setReading(false); });
    return () => { cancelled = true; };
  }, [receipt.id]);

  const selectedJob = jobs.find((j) => j.id === jobId) ?? null;
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return jobs.slice(0, 8);
    return jobs.filter((j) => j.label.toLowerCase().includes(q)).slice(0, 8);
  }, [jobs, search]);

  async function link() {
    if (!jobId) { toast("Pick a job", "error"); return; }
    setSaving(true);
    const res = await fetch(`/api/receipts/${receipt.id}/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId, amount: amount || null, vendor: vendor.trim() || null }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { toast(json.error ?? "Couldn't link receipt", "error"); return; }
    toast(`Receipt added to ${json.jobNumber ?? "the job"}`, "success");
    onLinked();
  }

  return (
    <div className="mt-4 rounded-lg border border-primary/30 bg-primary/[0.03] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Link receipt to a job</h3>
        <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Skip</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-muted-foreground mb-1">Job</label>
          {selectedJob ? (
            <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
              <span>{selectedJob.label}</span>
              <button type="button" onClick={() => { setJobId(""); setSearch(""); }} className="text-xs text-muted-foreground hover:text-foreground">Change</button>
            </div>
          ) : (
            <>
              <input
                autoFocus
                placeholder="Search job number, site or customer…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {matches.length > 0 && (
                <div className="mt-1 max-h-44 overflow-y-auto rounded-md border border-border divide-y divide-border">
                  {matches.map((j) => (
                    <button key={j.id} type="button" onClick={() => { setJobId(j.id); setSearch(""); }} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent">
                      {j.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Amount (inc GST){reading && <span className="ml-1.5 text-primary">· reading receipt…</span>}
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Vendor (optional)</label>
          <input
            type="text"
            placeholder="e.g. Bunnings"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">Not now</button>
        <button type="button" onClick={link} disabled={saving} className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {saving ? "Linking…" : "Link to job"}
        </button>
      </div>
    </div>
  );
}
