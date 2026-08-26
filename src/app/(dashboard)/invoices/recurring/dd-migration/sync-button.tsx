"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

export function SyncButton({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/dd-migration/sync", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `Sync failed (${res.status})`);
      toast(
        `Synced ${j.seen} legacy repeating invoices — ${j.created} new, ${j.gone} gone` +
          (j.ddLive ? `, ${j.ddLive} ready to retire` : "") +
          (j.unmatched ? `, ${j.unmatched} not matched to a site` : ""),
      );
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Sync failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-60"
      >
        {busy ? "Syncing from Xero…" : "Sync from Xero"}
      </button>
      {lastSyncedAt && (
        <span className="text-[10px] text-muted-foreground">
          last {new Date(lastSyncedAt).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" })}
        </span>
      )}
    </div>
  );
}
