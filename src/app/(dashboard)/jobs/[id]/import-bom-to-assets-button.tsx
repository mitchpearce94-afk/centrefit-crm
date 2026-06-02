"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Pre-fill the site asset register from this job's accepted-quote BOM — one
 * asset shell per unit, serial blank for the tech to scan. Confirms first
 * (it can create a lot of rows) and won't silently duplicate a prior import.
 */
export function ImportBomToAssetsButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function run(force: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/import-bom-to-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? "Import failed", "error");
        return;
      }
      if (data.alreadyImported) {
        if (confirm(`${data.existing} asset(s) already imported for this job. Import again anyway (creates duplicates)?`)) {
          await run(true);
        }
        return;
      }
      toast(`Created ${data.created} asset shell(s) from ${data.quoteRef ?? "the quote"} — scan serials on the site's Assets tab.`);
      setConfirming(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-muted-foreground hover:text-foreground"
        title="Create site asset shells (one per unit) from this job's quote BOM"
      >
        Pre-fill site assets from BOM
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => run(false)}
        disabled={busy}
        className="rounded bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {busy ? "Importing…" : "Confirm import"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={busy}
        className="text-[11px] text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
    </span>
  );
}
