"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

const STATUS_OPTIONS = ["new", "contacted", "quoted", "converted", "dismissed"] as const;

export function EnquiryActions({
  enquiryId,
  currentStatus,
  customerId,
  jobId,
}: {
  enquiryId: string;
  currentStatus: string;
  customerId: string | null;
  jobId: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function patchStatus(next: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/nbn-enquiries/${enquiryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        toast(json.error ?? "Update failed", "error");
        return;
      }
      toast(`Marked as ${next}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function convertToCustomer() {
    setBusy(true);
    try {
      const res = await fetch(`/api/nbn-enquiries/${enquiryId}/convert-customer`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        toast(json.error ?? "Conversion failed", "error");
        return;
      }
      toast("Customer created");
      router.push(`/customers/${json.customerId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={currentStatus}
        onChange={(e) => patchStatus(e.target.value)}
        disabled={busy}
        className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-50 capitalize"
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      {!customerId && (
        <button
          onClick={convertToCustomer}
          disabled={busy}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Working…" : "Create Customer"}
        </button>
      )}
      {customerId && !jobId && (
        <button
          disabled
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground opacity-50"
          title="Next step: create a job linked to this customer (coming soon)"
        >
          Create Job
        </button>
      )}
    </div>
  );
}
