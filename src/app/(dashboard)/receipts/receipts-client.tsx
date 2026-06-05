"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";

export interface JobOption {
  id: string;
  number: string | null;
  label: string;
}

export function ReceiptsClient({ jobs }: { jobs: JobOption[] }) {
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
      if (emailFails > 0) {
        toast("Saved, but the email forward failed — check the accounts mailbox setting", "error");
      }
      // Single capture → straight into the choose-job step. Bulk uploads just
      // email and are done (no per-receipt prompt).
      if (ok === 1 && lastId) {
        setLinkingId(lastId);
      } else if (ok > 0) {
        toast(`${ok} receipt${ok === 1 ? "" : "s"} emailed to accounts`, "success");
      }
    } finally {
      setUploading(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (linkingId) {
    return (
      <LinkPanel
        receiptId={linkingId}
        jobs={jobs}
        onDone={(msg) => { setLinkingId(null); if (msg) toast(msg, "success"); }}
      />
    );
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
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Snap a receipt — it&rsquo;s emailed to accounts straight away. You&rsquo;ll be asked to link it to a job (or not) and then it&rsquo;s done.
      </p>
    </div>
  );
}

function LinkPanel({
  receiptId,
  jobs,
  onDone,
}: {
  receiptId: string;
  jobs: JobOption[];
  onDone: (toastMsg?: string) => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [jobId, setJobId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);

  // Auto-read amount/vendor with Claude vision when the step opens. Silently
  // no-ops if the API key isn't configured — you just type it in.
  useEffect(() => {
    let cancelled = false;
    setReading(true);
    fetch(`/api/receipts/${receiptId}/read`, { method: "POST" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.available) return;
        if (j.amount != null) setAmount((cur) => (cur ? cur : String(j.amount)));
        if (j.vendor) setVendor((cur) => (cur ? cur : j.vendor));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setReading(false); });
    return () => { cancelled = true; };
  }, [receiptId]);

  const selectedJob = jobs.find((j) => j.id === jobId) ?? null;
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return jobs.slice(0, 8);
    return jobs.filter((j) => j.label.toLowerCase().includes(q)).slice(0, 8);
  }, [jobs, search]);

  async function link() {
    if (!jobId) { toast("Pick a job, or tap “No job”", "error"); return; }
    setSaving(true);
    const res = await fetch(`/api/receipts/${receiptId}/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId, amount: amount || null, vendor: vendor.trim() || null }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { toast(json.error ?? "Couldn't link receipt", "error"); return; }
    onDone(`Receipt added to ${json.jobNumber ?? "the job"}`);
  }

  return (
    <div className="max-w-lg rounded-lg border border-primary/30 bg-primary/[0.03] p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold">Receipt captured ✓</h3>
        <span className="text-[11px] text-muted-foreground">Emailed to accounts</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">Link it to a job, or tap “No job” if it&rsquo;s not job-related (fuel, supplies).</p>

      <div className="space-y-3">
        <div>
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Amount (inc GST){reading && <span className="ml-1.5 text-primary">· reading…</span>}
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
            <label className="block text-xs font-medium text-muted-foreground mb-1">Vendor</label>
            <input
              type="text"
              placeholder="e.g. Bunnings"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onDone("Receipt saved")}
          disabled={saving}
          className="rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
        >
          No job — done
        </button>
        <button
          type="button"
          onClick={link}
          disabled={saving}
          className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Linking…" : "Link to job"}
        </button>
      </div>
    </div>
  );
}
