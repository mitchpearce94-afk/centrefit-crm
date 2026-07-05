"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";

/**
 * Site Documentation (docs/documentation-CONTEXT.md Phase A). Replaces the
 * old per-site Vault tab: every document about the site lives here under a
 * fixed set of headings, stored in the PRIVATE `site-documents` bucket and
 * viewed via short-lived signed URLs. The Plans heading also surfaces the
 * CRM's own plan_files so builder PDFs and CFP plans sit side by side.
 * Generate buttons (SWMS / monitoring form / handover) arrive in Phases B–D.
 */

export interface SiteDocumentRow {
  id: string;
  category: string;
  name: string;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  status: string;
  version: number;
  created_at: string;
  uploader: { display_name: string | null } | null;
}

export interface SitePlanFileRow {
  id: string;
  name: string;
  state: string | null;
  revision: number | null;
  pdf_url: string | null;
  updated_at: string | null;
}

export interface SignRequestRow {
  id: string;
  site_document_id: string | null;
  document_type: string;
  status: string;
  recipient_name: string | null;
  recipient_email: string;
  version: number;
  token: string;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
}

export interface MonitoringProfileSummary {
  selections: Record<string, string | undefined>;
  updated_at: string;
}

const SELECTION_LABELS: Record<string, string> = {
  late_to_close: "Late to close",
  out_of_hours: "Out of hours",
  holdup: "Hold-up",
  sim_supply: "SIM",
  burglar: "Burglar",
  apply_scope: "Scope",
  vav: "VAV",
  power_fail: "Power fail",
  battery_fail: "Battery fail",
};

const CATEGORIES: Array<{ key: string; label: string; hint: string }> = [
  { key: "plans", label: "Plans", hint: "Builder / architect plans and Centrefit CFP plans" },
  { key: "security", label: "Security Paperwork", hint: "Monitoring response instructions and security forms" },
  { key: "swms", label: "SWMS", hint: "Safe work method statements for work at this site" },
  { key: "handover", label: "Handover Documentation", hint: "Handover manuals and acceptance records" },
  { key: "compliance", label: "Compliance & Certificates", hint: "Certificates, licences and compliance records" },
  { key: "other", label: "Other", hint: "Anything that doesn't fit above" },
];

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  sent: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  signed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
};

function fmtSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SiteDocumentsPanel({
  siteId,
  documents,
  planFiles,
  signRequests,
  monitoringProfile,
  defaultRecipientName,
  defaultRecipientEmail,
  isAdmin,
}: {
  siteId: string;
  documents: SiteDocumentRow[];
  planFiles: SitePlanFileRow[];
  signRequests: SignRequestRow[];
  monitoringProfile: MonitoringProfileSummary | null;
  defaultRecipientName: string | null;
  defaultRecipientEmail: string | null;
  isAdmin: boolean;
}) {
  return (
    <div className="space-y-6">
      {CATEGORIES.map((cat) => (
        <CategorySection
          key={cat.key}
          siteId={siteId}
          category={cat}
          documents={documents.filter((d) => d.category === cat.key)}
          planFiles={cat.key === "plans" ? planFiles : []}
          monitoring={
            cat.key === "security"
              ? {
                  requests: signRequests.filter((r) => r.document_type === "monitoring_form"),
                  profile: monitoringProfile,
                  defaultRecipientName,
                  defaultRecipientEmail,
                }
              : null
          }
          isAdmin={isAdmin}
        />
      ))}
    </div>
  );
}

interface MonitoringSectionData {
  requests: SignRequestRow[];
  profile: MonitoringProfileSummary | null;
  defaultRecipientName: string | null;
  defaultRecipientEmail: string | null;
}

function CategorySection({
  siteId,
  category,
  documents,
  planFiles,
  monitoring,
  isAdmin,
}: {
  siteId: string;
  category: { key: string; label: string; hint: string };
  documents: SiteDocumentRow[];
  planFiles: SitePlanFileRow[];
  monitoring: MonitoringSectionData | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      for (const file of files) {
        const safeName = file.name.replace(/[^\w.\- ()]/g, "_");
        const path = `sites/${siteId}/${category.key}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("site-documents")
          .upload(path, file, { contentType: file.type || undefined });
        if (upErr) {
          toast(`${file.name}: ${upErr.message}`, "error");
          continue;
        }
        const { error: insErr } = await supabase.from("site_documents").insert({
          site_id: siteId,
          category: category.key,
          name: file.name,
          storage_path: path,
          mime_type: file.type || null,
          size_bytes: file.size,
          uploaded_by: user?.id ?? null,
        });
        if (insErr) toast(`${file.name}: ${insErr.message}`, "error");
      }
      router.refresh();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function openDocument(doc: SiteDocumentRow) {
    if (!doc.storage_path) return;
    const { data, error } = await supabase.storage
      .from("site-documents")
      .createSignedUrl(doc.storage_path, 3600);
    if (error || !data?.signedUrl) {
      toast(error?.message ?? "Couldn't open document", "error");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  function handleDeleteClick(docId: string) {
    if (confirmingDeleteId !== docId) {
      setConfirmingDeleteId(docId);
      if (deleteTimer.current) clearTimeout(deleteTimer.current);
      deleteTimer.current = setTimeout(() => setConfirmingDeleteId(null), 4000);
      return;
    }
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    setConfirmingDeleteId(null);
    void deleteDocument(docId);
  }

  async function deleteDocument(docId: string) {
    const res = await fetch(`/api/site-documents/${docId}`, { method: "DELETE" });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      toast(json?.error ?? "Delete failed", "error");
      return;
    }
    toast("Document deleted");
    router.refresh();
  }

  const isEmpty = documents.length === 0 && planFiles.length === 0;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <h2 className="text-sm font-semibold">{category.label}</h2>
          <p className="text-[11px] text-muted-foreground">{category.hint}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {monitoring && <MonitoringSendButton siteId={siteId} monitoring={monitoring} />}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
          >
            {uploading ? "Uploading…" : "+ Upload"}
          </button>
        </div>
        <input ref={inputRef} type="file" multiple onChange={handleUpload} className="hidden" />
      </div>

      {monitoring && <MonitoringStatus siteId={siteId} monitoring={monitoring} />}

      {isEmpty ? (
        <div className="rounded-lg border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
          Nothing here yet.
        </div>
      ) : (
        <div className="surface-card overflow-hidden">
          {planFiles.map((pf) => (
            <div
              key={`pf-${pf.id}`}
              className="flex items-center justify-between gap-3 border-b border-border last:border-0 px-4 py-2.5"
            >
              <div className="min-w-0">
                <span className="text-sm font-medium truncate">{pf.name}</span>
                <span className="ml-2 text-[11px] text-muted-foreground">
                  CFP plan{pf.revision != null ? ` · rev ${pf.revision}` : ""}
                  {pf.updated_at ? ` · ${new Date(pf.updated_at).toLocaleDateString("en-AU")}` : ""}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                  Plan builder
                </span>
                {pf.pdf_url && (
                  <a
                    href={pf.pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-border px-2.5 py-1 text-[11px] hover:bg-accent transition-colors"
                  >
                    Open
                  </a>
                )}
              </div>
            </div>
          ))}
          {documents.map((doc) => {
            const confirming = confirmingDeleteId === doc.id;
            return (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-3 border-b border-border last:border-0 px-4 py-2.5"
              >
                <button
                  type="button"
                  onClick={() => openDocument(doc)}
                  className="min-w-0 text-left group"
                >
                  <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                    {doc.name}
                  </span>
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    {[
                      fmtSize(doc.size_bytes),
                      new Date(doc.created_at).toLocaleDateString("en-AU"),
                      doc.uploader?.display_name ?? null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  {doc.status !== "file" && (
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_STYLE[doc.status] ?? "border-border text-muted-foreground"}`}>
                      {doc.status}
                    </span>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleDeleteClick(doc.id)}
                      className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                        confirming
                          ? "bg-destructive text-white font-semibold"
                          : "border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40"
                      }`}
                    >
                      {confirming ? "Confirm" : "Delete"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Phase B — "Generate & send" for the Security Monitoring Response
 * Instructions. Pre-fills the recipient from the site owner, POSTs to the
 * send route which snapshots CRM data + catalogue fees into a tokenised
 * public form link emailed from accounts@.
 */
function MonitoringSendButton({ siteId, monitoring }: { siteId: string; monitoring: MonitoringSectionData }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(monitoring.defaultRecipientName ?? "");
  const [email, setEmail] = useState(monitoring.defaultRecipientEmail ?? "");
  const [sending, setSending] = useState(false);

  const live = monitoring.requests.find((r) => r.status === "sent" || r.status === "viewed");
  const isReissue = Boolean(monitoring.profile);

  async function send() {
    if (!email.trim()) {
      toast("Recipient email is required", "error");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/monitoring-form/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientName: name.trim() || null, recipientEmail: email.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Send failed");
      toast(`Monitoring form v${json.version} sent to ${email.trim()}`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Send failed", "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        {isReissue ? "Re-issue Monitoring Form" : "Generate & Send Monitoring Form"}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !sending && setOpen(false)}>
          <div className="surface-card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold">Security Monitoring Response Instructions</h3>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              {isReissue
                ? "The customer gets a link to the form pre-filled with their current instructions — they change what's needed and sign electronically."
                : "The customer gets a link to a fillable form pre-filled with everything the CRM knows, chooses their alarm responses and signs electronically."}
              {" "}Fees are pulled live from the recurring services catalogue. The signed PDF lands back here under Security Paperwork.
            </p>
            {live && (
              <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-400">
                A live link sent to {live.recipient_email} will be voided and replaced.
              </p>
            )}
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-[11px] font-medium text-muted-foreground">Recipient name</span>
                <input
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. the facility manager"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-muted-foreground">Recipient email</span>
                <input
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@business.com.au"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={sending}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={send}
                disabled={sending}
                className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {sending ? "Sending…" : "Send to customer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Live-link status + current monitoring profile summary for the security heading. */
function MonitoringStatus({ siteId, monitoring }: { siteId: string; monitoring: MonitoringSectionData }) {
  const { toast } = useToast();
  const [resending, setResending] = useState(false);
  const live = monitoring.requests.find((r) => r.status === "sent" || r.status === "viewed");
  const profile = monitoring.profile;

  async function copyLink(token: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/monitoring-form/${token}`);
    toast("Form link copied");
  }

  async function resend(requestId: string) {
    setResending(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/monitoring-form/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resendRequestId: requestId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Resend failed");
      toast("Form link re-sent");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Resend failed", "error");
    } finally {
      setResending(false);
    }
  }

  if (!live && !profile) return null;

  return (
    <div className="mb-3 space-y-2">
      {live && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2">
          <span className="text-[11px] font-semibold text-sky-400">
            v{live.version} awaiting signature
          </span>
          <span className="text-[11px] text-muted-foreground">
            {live.recipient_email}
            {live.sent_at ? ` · sent ${new Date(live.sent_at).toLocaleDateString("en-AU")}` : ""}
            {live.viewed_at ? ` · opened ${new Date(live.viewed_at).toLocaleDateString("en-AU")}` : " · not yet opened"}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => copyLink(live.token)}
              className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-accent transition-colors"
            >
              Copy link
            </button>
            <button
              type="button"
              onClick={() => resend(live.id)}
              disabled={resending}
              className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-accent disabled:opacity-50 transition-colors"
            >
              {resending ? "Re-sending…" : "Re-send email"}
            </button>
          </span>
        </div>
      )}
      {profile && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
          <span className="mr-1 text-[11px] font-semibold text-muted-foreground">Monitoring profile:</span>
          {Object.entries(profile.selections)
            .filter(([, v]) => v)
            .map(([key, value]) => (
              <span
                key={key}
                className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                {SELECTION_LABELS[key] ?? key}{" "}
                <span className="ml-1 font-semibold text-foreground uppercase">{String(value)}</span>
              </span>
            ))}
          <span className="ml-auto text-[10px] text-muted-foreground">
            updated {new Date(profile.updated_at).toLocaleDateString("en-AU")}
          </span>
        </div>
      )}
    </div>
  );
}
