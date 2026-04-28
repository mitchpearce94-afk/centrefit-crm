"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";

/**
 * "Convert to recurring plan" — calls the bridge endpoint to create (or
 * attach) a customer + site from the enquiry, then sends staff to the
 * recurring wizard with the customer + site preselected.
 */
export function ConvertToRecurringButton({
  enquiryId,
  planSku,
}: {
  enquiryId: string;
  enquiryName: string;
  enquiryEmail: string;
  enquiryPhone: string | null;
  company: string | null;
  planSku: string | null;
  address: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  async function go() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/nbn-enquiries/${enquiryId}/convert-to-recurring`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.customerId) {
        toast(json.error ?? "Couldn't convert enquiry", "error");
        setSubmitting(false);
        return;
      }
      const params = new URLSearchParams({
        customer: json.customerId,
        site: json.siteId,
        from_enquiry: enquiryId,
      });
      if (planSku) params.set("plan_sku", planSku);
      router.push(`/invoices/recurring/new?${params.toString()}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Network error", "error");
      setSubmitting(false);
    }
  }

  return (
    <button
      onClick={go}
      disabled={submitting}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
    >
      {submitting ? "Preparing..." : "Convert to recurring plan →"}
    </button>
  );
}
