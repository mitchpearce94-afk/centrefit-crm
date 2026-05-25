"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

interface Props {
  invoiceId: string;
  invoiceRef: string | null;
  payLink: string | null;
  status: string;
  amountDue: number;
  xeroInvoiceId: string | null;
  sentAt: string | null;
  sentToEmail: string | null;
  defaultRecipient: string | null;
  lastReminderAt: string | null;
  reminderCount: number;
}

export function InvoiceActions({
  invoiceId,
  invoiceRef,
  payLink,
  status,
  amountDue,
  xeroInvoiceId,
  sentAt,
  sentToEmail,
  defaultRecipient,
  lastReminderAt,
  reminderCount,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [authorising, setAuthorising] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [recipient, setRecipient] = useState<string>(sentToEmail ?? defaultRecipient ?? "");
  const [reminderRecipient, setReminderRecipient] = useState<string>(sentToEmail ?? defaultRecipient ?? "");
  const [sending, setSending] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/refresh`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Refresh failed");
      toast("Invoice refreshed from Xero");
      router.refresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Refresh failed", "error");
    }
    setRefreshing(false);
  }

  async function handleAuthorise() {
    if (!confirm("Authorise this invoice? It will post to Xero's books (A/R, revenue, GST) and a pay-now link will be generated.")) {
      return;
    }
    setAuthorising(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/authorise`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authorise failed");
      toast("Invoice authorised in Xero");
      router.refresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Authorise failed", "error");
    }
    setAuthorising(false);
  }

  async function copyPayLink() {
    if (!payLink) {
      toast("No pay-now link on this invoice", "error");
      return;
    }
    await navigator.clipboard.writeText(payLink);
    toast("Pay-now link copied");
  }

  function openSendModal() {
    setMenuOpen(false);
    setRecipient(sentToEmail ?? defaultRecipient ?? "");
    setShowSendModal(true);
  }

  async function handleSend() {
    const email = recipient.trim();
    if (!email) {
      toast("Recipient email required", "error");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      toast(`Invoice emailed to ${email}`);
      setShowSendModal(false);
      router.refresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Send failed", "error");
    }
    setSending(false);
  }

  const xeroEditUrl = xeroInvoiceId
    ? `https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=${xeroInvoiceId}`
    : null;

  async function handleSendReminder() {
    const email = reminderRecipient.trim();
    if (!email) {
      toast("Recipient email required", "error");
      return;
    }
    setSendingReminder(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/send-reminder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, trigger: "manual" }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 409 means Xero said paid/voided — sync already happened server-side,
        // refresh the page so the user sees the latest status.
        if (res.status === 409) {
          toast(data.error ?? "Reminder skipped — invoice may have been paid.", "error");
          setShowReminderModal(false);
          router.refresh();
          return;
        }
        throw new Error(data.error || "Reminder failed");
      }
      toast(`Reminder ${data.reminderNumber} sent to ${email}`);
      setShowReminderModal(false);
      router.refresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Reminder failed", "error");
    }
    setSendingReminder(false);
  }

  function openReminderModal() {
    setMenuOpen(false);
    setReminderRecipient(sentToEmail ?? defaultRecipient ?? "");
    setShowReminderModal(true);
  }

  // Send/Resend is offered for any invoice that has actually been pushed to
  // Xero (i.e. has an xero_invoice_id). Drafts can be sent too — the email
  // includes the pay link only if one exists, so authorised invoices are the
  // useful case but a draft send is harmless.
  const canSend = !!xeroInvoiceId && status !== "void";
  const sendLabel = sentAt ? "Resend invoice" : "Send invoice";
  // Reminders only make sense for authorised invoices with money outstanding.
  // The server route also re-checks Xero before sending, so this is just to
  // hide the menu item where it'd never apply.
  const canRemind = status === "authorised" && amountDue > 0 && !!xeroInvoiceId;

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {payLink && (
          <button
            onClick={copyPayLink}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Copy pay link
          </button>
        )}
        {xeroEditUrl && (
          <a
            href={xeroEditUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Edit in Xero
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        )}
        {status === "draft" && (
          <button
            onClick={handleAuthorise}
            disabled={authorising}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {authorising ? "Authorising…" : "Authorise"}
          </button>
        )}
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {refreshing ? "Refreshing…" : "Refresh from Xero"}
        </button>

        {/* Kebab — currently only houses Send/Resend; lives alongside the
            inline buttons rather than absorbing them, since they're the
            high-frequency actions for an admin landing on this page. */}
        {(canSend || canRemind) && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label="More actions"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="12" cy="19" r="1.6" />
              </svg>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 mt-1 z-50 min-w-[220px] rounded-md border border-border bg-popover shadow-lg py-1">
                  {canSend && (
                    <button
                      onClick={openSendModal}
                      className="block w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                    >
                      {sendLabel}
                    </button>
                  )}
                  {canRemind && (
                    <button
                      onClick={openReminderModal}
                      className="block w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                    >
                      Send payment reminder
                      {reminderCount > 0 && (
                        <span className="ml-1.5 text-[10px] text-muted-foreground">
                          ({reminderCount} sent)
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Send / Resend confirmation modal — never skip the confirm step on
          customer-facing email actions. The recipient is editable in case the
          primary contact has changed or the customer asked for a different
          inbox. */}
      {showSendModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !sending && setShowSendModal(false)} />
          <div className="relative w-full max-w-md rounded-xl bg-background border border-border shadow-2xl">
            <div className="border-b border-border px-5 py-3">
              <p className="text-sm font-semibold text-foreground">{sendLabel}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {sentAt
                  ? `Last sent ${new Date(sentAt).toLocaleString("en-AU")}${sentToEmail ? ` to ${sentToEmail}` : ""}.`
                  : `Invoice ${invoiceRef ?? ""} — sent from accounts@centrefit.com.au.`}
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Recipient email
                </label>
                <input
                  type="email"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="customer@example.com"
                  className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3 bg-muted/30">
              <button
                onClick={() => setShowSendModal(false)}
                disabled={sending}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending || !recipient.trim()}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {sending ? "Sending…" : sentAt ? "Resend now" : "Send now"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reminder modal — separate from the Send/Resend flow so the copy and
          confirmation context are explicit. Server re-checks Xero before
          actually emailing, but we still want the operator to confirm. */}
      {showReminderModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !sendingReminder && setShowReminderModal(false)} />
          <div className="relative w-full max-w-md rounded-xl bg-background border border-border shadow-2xl">
            <div className="border-b border-border px-5 py-3">
              <p className="text-sm font-semibold text-foreground">Send payment reminder</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Invoice {invoiceRef ?? ""}
                {amountDue > 0 ? ` — $${amountDue.toFixed(2)} outstanding.` : "."}
                {lastReminderAt
                  ? ` Last reminded ${new Date(lastReminderAt).toLocaleString("en-AU")} (${reminderCount}× total).`
                  : " No previous reminders sent."}
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                The CRM will re-check the invoice with Xero before sending. If it&apos;s actually been paid, the reminder will be skipped and the local status updated automatically.
              </p>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Recipient email
                </label>
                <input
                  type="email"
                  value={reminderRecipient}
                  onChange={(e) => setReminderRecipient(e.target.value)}
                  placeholder="customer@example.com"
                  className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3 bg-muted/30">
              <button
                onClick={() => setShowReminderModal(false)}
                disabled={sendingReminder}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSendReminder}
                disabled={sendingReminder || !reminderRecipient.trim()}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {sendingReminder ? "Sending…" : "Send reminder"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
