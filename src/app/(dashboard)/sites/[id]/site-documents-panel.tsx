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
  isAdmin,
}: {
  siteId: string;
  documents: SiteDocumentRow[];
  planFiles: SitePlanFileRow[];
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
          isAdmin={isAdmin}
        />
      ))}
    </div>
  );
}

function CategorySection({
  siteId,
  category,
  documents,
  planFiles,
  isAdmin,
}: {
  siteId: string;
  category: { key: string; label: string; hint: string };
  documents: SiteDocumentRow[];
  planFiles: SitePlanFileRow[];
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
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
        >
          {uploading ? "Uploading…" : "+ Upload"}
        </button>
        <input ref={inputRef} type="file" multiple onChange={handleUpload} className="hidden" />
      </div>

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
