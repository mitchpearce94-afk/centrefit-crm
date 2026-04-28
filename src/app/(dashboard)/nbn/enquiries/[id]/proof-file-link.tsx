"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Mints a short-lived signed URL for the proof file in `enquiry-proofs`
 * (private bucket) and opens it in a new tab. Click → URL → tab; the link
 * expires within minutes so the bucket stays sealed.
 */
export function ProofFileLink({ path, fileName }: { path: string; fileName: string }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function open() {
    setLoading(true);
    setErr(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage
        .from("enquiry-proofs")
        .createSignedUrl(path, 300);
      if (error || !data?.signedUrl) {
        setErr(error?.message ?? "Couldn't get a download link");
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Customer-uploaded proof</div>
          <div className="text-sm font-medium mt-0.5 break-all">{fileName}</div>
        </div>
        <button
          onClick={open}
          disabled={loading}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent transition-colors disabled:opacity-50"
        >
          {loading ? "Opening..." : "Open"}
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
    </div>
  );
}
