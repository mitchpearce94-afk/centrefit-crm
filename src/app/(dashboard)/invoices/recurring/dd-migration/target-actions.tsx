"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KebabMenu } from "@/components/ui/kebab-menu";
import { useToast } from "@/components/ui/toast";
import { renderDdTemplate, type DdStatus } from "@/lib/recurring/dd-migration-shared";

export interface TargetActionsProps {
  target: {
    id: string;
    status: DdStatus;
    siteId: string | null;
    siteName: string | null;
    contactName: string;
    contactEmail: string | null;
    planId: string | null;
    planStatus: string | null;
    planFirstInvoiceDate: string | null;
    riId: string | null;
    riReference: string | null;
    riTotal: number;
    nextScheduledDate: string | null;
    monthlyValue: number;
    lineText: string | null;
    notes: string | null;
  };
  template: { subject: string; body: string };
  senderName: string;
}

async function api(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error((j.error as string) ?? `Request failed (${res.status})`) as Error & { data?: Record<string, unknown> };
    err.data = j;
    throw err;
  }
  return j;
}

const fmtMoney = (n: number) => n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-AU") : "—");

export function TargetActions({ target, template, senderName }: TargetActionsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const wizardUrl = target.siteId ? `/invoices/recurring/new?site=${target.siteId}` : null;
  const canInvite = ["todo", "invited", "mandate_pending"].includes(target.status);
  const canRetire = target.status === "dd_live" && !!target.riId;

  function buildEmail(link: string) {
    const vars = {
      site_name: target.siteName ?? target.contactName,
      contact_name: target.contactName || "there",
      services: (target.lineText ?? "")
        .split(" • ")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => `- ${s}`)
        .join("\r\n"),
      monthly_value: fmtMoney(target.monthlyValue),
      signup_link: link,
      sender_name: senderName,
    };
    return {
      subject: renderDdTemplate(template.subject, vars),
      body: renderDdTemplate(template.body, vars).replace(/\r?\n/g, "\r\n"),
    };
  }

  async function mintLink(): Promise<string> {
    const j = await api(`/api/dd-migration/targets/${target.id}/signup-link`, { method: "POST" });
    return j.url as string;
  }

  function sendToWizard(message: string) {
    toast(message, "error");
    if (wizardUrl) window.open(wizardUrl, "_blank", "noopener");
  }

  async function withBusy<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      const err = e as Error & { data?: { wizardUrl?: string | null } };
      if (err.data?.wizardUrl !== undefined) {
        sendToWizard(err.message);
      } else {
        toast(err.message || "Something went wrong", "error");
      }
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function draft(mode: "mailto" | "copy") {
    if (!target.planId && !target.siteId) {
      toast("Link this repeating invoice to a site first, then create its plan", "error");
      return;
    }
    if (mode === "mailto" && !target.contactEmail) {
      toast("Add a contact email first", "error");
      return;
    }
    await withBusy(async () => {
      const link = await mintLink();
      const { subject, body } = buildEmail(link);
      if (mode === "copy") {
        await navigator.clipboard.writeText(`Subject: ${subject}\r\n\r\n${body}`);
        toast("Email text copied — paste it into a new email from accounts@");
      } else {
        window.location.href = `mailto:${target.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      }
      await api(`/api/dd-migration/targets/${target.id}/touch`, {
        method: "POST",
        body: JSON.stringify({
          channel: "email",
          note: mode === "copy" ? "Invitation email copied for sending" : "Invitation email drafted in mail client",
          markInvited: true,
        }),
      });
      router.refresh();
    });
  }

  async function copyLink() {
    await withBusy(async () => {
      const link = await mintLink();
      await navigator.clipboard.writeText(link);
      toast("Signup link copied (valid ~7 days)");
    });
  }

  async function logNote() {
    const note = window.prompt("Note for this customer (what happened?)");
    if (!note?.trim()) return;
    await withBusy(async () => {
      await api(`/api/dd-migration/targets/${target.id}/touch`, {
        method: "POST",
        body: JSON.stringify({ channel: "note", note: note.trim(), markInvited: false }),
      });
      router.refresh();
    });
  }

  async function markInvitedManually() {
    await withBusy(async () => {
      await api(`/api/dd-migration/targets/${target.id}/touch`, {
        method: "POST",
        body: JSON.stringify({ channel: "email", note: "Invitation sent manually", markInvited: true }),
      });
      router.refresh();
    });
  }

  async function patch(body: Record<string, unknown>, done: string) {
    await withBusy(async () => {
      await api(`/api/dd-migration/targets/${target.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast(done);
      router.refresh();
    });
  }

  async function setEmail() {
    const v = window.prompt("Contact email for the invitation", target.contactEmail ?? "");
    if (v === null) return;
    await patch({ contact_email: v.trim() }, "Contact email saved");
  }

  async function decline() {
    const reason = window.prompt("Why did they decline? (kept on the record)");
    if (reason === null) return;
    await patch({ status: "declined", status_reason: reason.trim() || "Customer declined" }, "Marked declined");
  }

  async function exclude() {
    if (!window.confirm("Exclude this customer from direct debit permanently? The site will be flagged invoice-only.")) return;
    await patch({ status: "excluded", status_reason: "Invoice-only", invoice_only: true }, "Excluded — site flagged invoice-only");
  }

  async function backToTodo() {
    await patch({ status: "todo", status_reason: "", invoice_only: false }, "Back in the queue");
  }

  const sections = [
    {
      items: [
        { label: "Draft invitation email", onClick: () => void draft("mailto"), hidden: !canInvite, disabled: busy },
        { label: "Copy invitation text", onClick: () => void draft("copy"), hidden: !canInvite, disabled: busy },
        { label: "Copy signup link only", onClick: () => void copyLink(), hidden: !canInvite, disabled: busy },
        { label: "Mark invited (sent by hand)", onClick: () => void markInvitedManually(), hidden: target.status !== "todo", disabled: busy },
        { label: "Log a note", onClick: () => void logNote(), disabled: busy },
      ],
    },
    {
      items: [
        { label: "Create plan in wizard", onClick: () => wizardUrl && window.open(wizardUrl, "_blank", "noopener"), hidden: !wizardUrl || !!target.planId || !canInvite },
        { label: "Open plan", onClick: () => router.push(`/invoices/recurring/${target.planId}`), hidden: !target.planId },
        { label: "Open site", onClick: () => router.push(`/sites/${target.siteId}`), hidden: !target.siteId },
        { label: target.siteId ? "Re-link to a different site" : "Link to a site", onClick: () => setLinkOpen(true), hidden: !canInvite },
        { label: "Set contact email", onClick: () => void setEmail(), hidden: !canInvite },
      ],
    },
    {
      items: [
        { label: "Retire legacy repeating invoice…", onClick: () => setRetireOpen(true), hidden: !canRetire, danger: true },
        { label: "Mark declined", onClick: () => void decline(), hidden: !canInvite },
        { label: "Exclude — invoice only", onClick: () => void exclude(), hidden: !canInvite },
        { label: "Back to To do", onClick: () => void backToTodo(), hidden: !["declined", "excluded", "invited"].includes(target.status) },
      ],
    },
  ];

  return (
    <>
      <KebabMenu sections={sections} triggerLabel="Actions" />
      {retireOpen && (
        <RetireModal
          target={target}
          busy={busy}
          onClose={() => setRetireOpen(false)}
          onConfirm={async () => {
            await withBusy(async () => {
              await api(`/api/dd-migration/targets/${target.id}/retire-ri`, {
                method: "POST",
                body: JSON.stringify({ confirmRiId: target.riId }),
              });
              toast("Legacy repeating invoice retired in Xero");
              setRetireOpen(false);
              router.refresh();
            });
          }}
        />
      )}
      {linkOpen && (
        <LinkSiteModal
          onClose={() => setLinkOpen(false)}
          onPick={async (siteId) => {
            await patch({ site_id: siteId }, "Linked to site");
            setLinkOpen(false);
          }}
        />
      )}
    </>
  );
}

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="surface-card w-full max-w-md p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function RetireModal({
  target,
  busy,
  onClose,
  onConfirm,
}: {
  target: TargetActionsProps["target"];
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const ok = typed.trim().toUpperCase() === "RETIRE";
  return (
    <ModalShell title="Retire the legacy repeating invoice" onClose={onClose}>
      <p className="mt-2 text-sm text-muted-foreground">
        This deletes the old Xero repeating invoice so the customer isn&rsquo;t invoiced twice. The CRM plan&rsquo;s own repeating invoice and GoCardless subscription keep going.
      </p>
      <dl className="mt-4 grid grid-cols-[120px_1fr] gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Customer</dt>
        <dd className="font-medium">{target.siteName ?? target.contactName}</dd>
        <dt className="text-muted-foreground">Legacy RI</dt>
        <dd className="font-mono text-xs">{target.riReference ? `${target.riReference} · ` : ""}{target.riId}</dd>
        <dt className="text-muted-foreground">Amount</dt>
        <dd>${fmtMoney(target.riTotal)} per cycle</dd>
        <dt className="text-muted-foreground">Next would fire</dt>
        <dd>{fmtDate(target.nextScheduledDate)}</dd>
        <dt className="text-muted-foreground">Plan first invoice</dt>
        <dd>{fmtDate(target.planFirstInvoiceDate)}</dd>
      </dl>
      {target.nextScheduledDate && target.planFirstInvoiceDate && target.nextScheduledDate < target.planFirstInvoiceDate && (
        <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
          The legacy RI fires before the plan&rsquo;s first invoice — retiring it now leaves a gap of one cycle. Check the dates before confirming.
        </p>
      )}
      <label className="mt-4 block text-xs text-muted-foreground">
        Type <span className="font-mono font-semibold text-foreground">RETIRE</span> to confirm
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          autoFocus
        />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent">
          Cancel
        </button>
        <button
          type="button"
          disabled={!ok || busy}
          onClick={() => void onConfirm()}
          className="rounded-md bg-destructive px-3 py-2 text-sm font-semibold text-white hover:bg-destructive/90 disabled:opacity-50"
        >
          {busy ? "Retiring…" : "Retire in Xero"}
        </button>
      </div>
    </ModalShell>
  );
}

function LinkSiteModal({ onClose, onPick }: { onClose: () => void; onPick: (siteId: string) => Promise<void> }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string; suburb: string | null; owner: string | null }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/dd-migration/sites?q=${encodeURIComponent(q.trim())}`);
        const j = await res.json();
        setResults(j.sites ?? []);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <ModalShell title="Link to a CRM site" onClose={onClose}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search site name or suburb…"
        className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        autoFocus
      />
      <ul className="mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
        {loading && <li className="px-3 py-2 text-xs text-muted-foreground">Searching…</li>}
        {!loading && q.trim().length >= 2 && results.length === 0 && (
          <li className="px-3 py-2 text-xs text-muted-foreground">No sites match.</li>
        )}
        {results.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => void onPick(s.id)}
              className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <span className="font-medium">{s.name}</span>
              <span className="text-[11px] text-muted-foreground">
                {[s.suburb, s.owner].filter(Boolean).join(" · ")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </ModalShell>
  );
}
