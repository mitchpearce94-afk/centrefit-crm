"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { XeroSyncPreviewModal, type PreviewReport } from "./xero-sync-preview-modal";

export function RowXeroSyncButton({
  productId,
  hasSku,
}: {
  productId: string;
  hasSku: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewReport | null>(null);

  if (!hasSku) return null;

  async function loadPreview() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/xero/sync-products/preview?productIds=${encodeURIComponent(productId)}`
      );
      const json = await res.json();
      if (!res.ok || json.error) {
        toast(json.error ?? "Preview failed", "error");
        return;
      }
      setPreview(json as PreviewReport);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Preview failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSync() {
    setBusy(true);
    try {
      const res = await fetch("/api/xero/sync-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: [productId] }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        toast(json.error ?? "Sync failed", "error");
      } else {
        const s = json.summary;
        if (s.errors?.length) {
          toast(`Synced with ${s.errors.length} error(s)`, "error");
        } else if (s.synced > 0) {
          toast(`Synced to Xero (${s.created ? "created" : "updated"})`);
        } else {
          toast("Nothing synced");
        }
        setPreview(null);
        router.refresh();
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Sync failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={loadPreview}
        disabled={busy}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      >
        {busy && !preview ? "…" : "Sync"}
      </button>
      {preview && (
        <XeroSyncPreviewModal
          report={preview}
          busy={busy}
          onCancel={() => setPreview(null)}
          onConfirm={confirmSync}
          confirmLabel="Confirm sync"
        />
      )}
    </>
  );
}
