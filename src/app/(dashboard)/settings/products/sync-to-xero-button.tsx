"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

export function SyncToXeroButton({
  connected,
  tenantName,
}: {
  connected: boolean;
  tenantName: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  if (!connected) {
    return (
      <Link
        href="/settings/integrations"
        className="shrink-0 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-accent"
      >
        Connect Xero
      </Link>
    );
  }

  async function handleSync() {
    setBusy(true);
    try {
      const res = await fetch("/api/xero/sync-products", { method: "POST" });
      const json = await res.json();
      if (!res.ok || json.error) {
        toast(json.error ?? "Sync failed", "error");
      } else {
        const s = json.summary;
        toast(
          `Synced ${s.synced} to Xero (${s.created} new, ${s.updated} updated${
            s.errors?.length ? `, ${s.errors.length} errors` : ""
          })`
        );
        router.refresh();
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Sync failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleSync}
      disabled={busy}
      title={tenantName ? `Sync all products to ${tenantName}` : "Sync to Xero"}
      className="shrink-0 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
    >
      {busy ? "Syncing…" : "Sync to Xero"}
    </button>
  );
}
