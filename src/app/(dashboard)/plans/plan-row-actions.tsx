"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KebabMenu } from "@/components/ui/kebab-menu";
import { NotifyStaffModal } from "@/components/notify-staff-modal";
import { useToast } from "@/components/ui/toast";

interface Props {
  planId: string;
  cfpUrl: string | null;
  pdfUrl: string | null;
  pdfDownloadName: string;
  state: string | null;
  refLabel: string;
  hasJobOrQuote: boolean;
  alreadySent: boolean;
}

export function PlanRowActions({
  planId,
  cfpUrl,
  pdfUrl,
  pdfDownloadName,
  state,
  refLabel,
  hasJobOrQuote,
  alreadySent,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  function downloadFile(url: string, filename?: string) {
    const a = document.createElement("a");
    a.href = url;
    if (filename) a.download = filename;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function sendToElectrician() {
    if (!pdfUrl) {
      toast("Plan has no PDF yet — open it in the editor and export first.", "error");
      return;
    }
    if (!state) {
      toast("Plan has no state — set one before sending.", "error");
      return;
    }
    const ok = window.confirm(
      `Send this plan PDF to the ${state} electrician for quoting?${alreadySent ? "\n\nThis plan has already been sent once — proceeding will resend." : ""}`,
    );
    if (!ok) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/plans/${planId}/send-to-electrician`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      toast(`Sent to ${data.sentTo}`);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  function sendToQuote() {
    router.push(`/quoting/new?plan=${planId}`);
  }

  return (
    <>
      <KebabMenu
        sections={[
          {
            items: [
              { label: "Open in editor", onClick: () => router.push(`/plans/${planId}`), hidden: !cfpUrl },
              { label: "Download PDF", onClick: () => pdfUrl && downloadFile(pdfUrl + "?t=" + Date.now(), pdfDownloadName), hidden: !pdfUrl },
              { label: "Download .cfp", onClick: () => cfpUrl && downloadFile(cfpUrl, undefined), hidden: !cfpUrl },
            ],
          },
          {
            items: [
              { label: "Notify staff…", onClick: () => setNotifyOpen(true) },
              {
                label: alreadySent ? "Resend to electrician…" : "Send to electrician…",
                onClick: sendToElectrician,
                disabled: busy || !pdfUrl,
              },
              { label: "Send to quote", onClick: sendToQuote, hidden: hasJobOrQuote },
            ],
          },
        ]}
      />
      <NotifyStaffModal
        open={notifyOpen}
        onClose={() => setNotifyOpen(false)}
        refType="plan"
        refId={planId}
        refLabel={refLabel}
        href={`/plans`}
      />
    </>
  );
}
