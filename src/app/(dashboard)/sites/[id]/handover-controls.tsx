"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import type { SignRequestRow } from "./site-documents-panel";

/**
 * Handover pack controls (Phase D): generate & download, or generate & send
 * the tokenised review-and-accept link. The pack is assembled server-side
 * from the site's key-information assets + the datasheet library.
 */

export interface HandoverData {
  requests: SignRequestRow[];
  defaultRecipientName: string | null;
  defaultRecipientEmail: string | null;
}

export function HandoverControls({
  siteId,
  handover,
  buttonOnly,
}: {
  siteId: string;
  handover: HandoverData;
  buttonOnly?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(handover.defaultRecipientName ?? "");
  const [email, setEmail] = useState(handover.defaultRecipientEmail ?? "");
  const [busy, setBusy] = useState<"download" | "send" | null>(null);

  const live = handover.requests.find((r) => r.status === "sent" || r.status === "viewed");

  async function generate(mode: "download" | "send") {
    if (mode === "send" && !email.trim()) {
      toast("Recipient email is required", "error");
      return;
    }
    setBusy(mode);
    try {
      const res = await fetch(`/api/sites/${siteId}/handover/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          recipientName: name.trim() || null,
          recipientEmail: email.trim() || null,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? "Generate failed");
      }
      if (mode === "download") {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "Handover.pdf";
        a.click();
        URL.revokeObjectURL(url);
        toast("Handover pack generated — copy saved under the Handover heading");
      } else {
        toast(`Handover acceptance link sent to ${email.trim()}`);
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Generate failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function copyLink(token: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/handover/${token}`);
    toast("Acceptance link copied");
  }

  if (buttonOnly) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Generate Handover Pack
        </button>
        {open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !busy && setOpen(false)}>
            <div className="surface-card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-sm font-semibold">Handover Documentation Pack</h3>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                Assembled from this site&apos;s key-information assets: branded cover + contents, the matching
                datasheets from the library, operating procedures (duress testing included only when the
                site has duress equipment), Wi-Fi details and the compliance statement. Download it, or
                send the customer a review-and-accept link.
              </p>
              {live && (
                <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-400">
                  A live acceptance link sent to {live.recipient_email} will be voided if you send a new one.
                </p>
              )}
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="text-[11px] font-medium text-muted-foreground">Recipient name (for the send option)</span>
                  <input
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium text-muted-foreground">Recipient email</span>
                  <input
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={busy !== null}
                  className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => generate("download")}
                  disabled={busy !== null}
                  className="rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
                >
                  {busy === "download" ? "Assembling…" : "Generate & Download"}
                </button>
                <button
                  type="button"
                  onClick={() => generate("send")}
                  disabled={busy !== null}
                  className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {busy === "send" ? "Sending…" : "Send for acceptance"}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  if (!live) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2">
      <span className="text-[11px] font-semibold text-sky-400">Handover awaiting acceptance</span>
      <span className="text-[11px] text-muted-foreground">
        {live.recipient_email}
        {live.sent_at ? ` · sent ${new Date(live.sent_at).toLocaleDateString("en-AU")}` : ""}
        {live.viewed_at ? ` · opened ${new Date(live.viewed_at).toLocaleDateString("en-AU")}` : " · not yet opened"}
      </span>
      <button
        type="button"
        onClick={() => copyLink(live.token)}
        className="ml-auto rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-accent transition-colors"
      >
        Copy link
      </button>
    </div>
  );
}
