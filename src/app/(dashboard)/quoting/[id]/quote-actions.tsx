"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { generateScopeOfWorks } from "@/lib/quote-engine";
import { autoTransitionJobStatus } from "@/lib/job-status-transitions";
import type { SiteInfo } from "@/lib/quote-engine";

function fmt(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  quoteId: string;
  status: string;
  quoteRef: string;
  clientName: string;
  siteName: string | null;
  siteAddress: string | null;
  quoteType: string;
  pricing: any;
  deviceCounts: Record<string, number>;
  lineItems: any[];
  createdAt: string;
  siteInfo: SiteInfo;
  contactEmail: string | null;
  jobId: string | null;
  jobs?: { id: string; number: string; customer_name: string | null }[];
}

export function QuoteActions({
  quoteId, status, quoteRef, clientName, siteName, siteAddress,
  quoteType, pricing, deviceCounts, lineItems, createdAt,
  siteInfo, contactEmail, jobId, jobs = [],
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [currentJobId, setCurrentJobId] = useState(jobId);
  const { toast } = useToast();
  const [updating, setUpdating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendEmail, setSendEmail] = useState(contactEmail ?? "");

  async function updateStatus(newStatus: string, extra?: Record<string, unknown>) {
    setUpdating(true);
    const { error } = await supabase.from("quotes").update({ status: newStatus, ...extra }).eq("id", quoteId);
    if (error) {
      toast(error.message, "error");
    } else {
      // Auto-transition linked job status
      if (currentJobId) {
        const actionMap: Record<string, string> = { sent: "quote_sent", accepted: "quote_accepted", declined: "quote_declined" };
        if (actionMap[newStatus]) await autoTransitionJobStatus(currentJobId, actionMap[newStatus], supabase);
      }
      toast(`Quote marked as ${newStatus}`);
      router.refresh();
    }
    setUpdating(false);
  }

  async function markPayment(field: "pp1_paid" | "pp2_paid") {
    setUpdating(true);
    const { error } = await supabase.from("quotes").update({ [field]: true, [`${field}_at`]: new Date().toISOString() }).eq("id", quoteId);
    if (error) toast(error.message, "error");
    else { toast("Payment recorded"); router.refresh(); }
    setUpdating(false);
  }

  async function handleSendToCustomer() {
    if (!sendEmail.trim()) {
      toast("Enter a recipient email", "error");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/quotes/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId, email: sendEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      toast("Quote sent to customer");
      router.refresh();
    } catch (err: any) {
      toast(err.message, "error");
    }
    setSending(false);
  }

  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleDelete() {
    setUpdating(true);
    // Unlink plan_files (plans outlive quotes), then delete line items and extras
    await supabase.from("plan_files").update({ quote_id: null }).eq("quote_id", quoteId);
    await supabase.from("quote_line_items").delete().eq("quote_id", quoteId);
    await supabase.from("quote_extras").delete().eq("quote_id", quoteId);
    const { error } = await supabase.from("quotes").delete().eq("id", quoteId);
    if (error) { toast(error.message, "error"); setUpdating(false); return; }
    toast("Quote deleted");
    router.push("/quoting");
    router.refresh();
  }

  async function revertToDraft() {
    setUpdating(true);
    const { error } = await supabase.from("quotes").update({
      status: "draft", sent_at: null, sent_to_email: null, response_token: null,
      accepted_at: null, declined_at: null,
    }).eq("id", quoteId);
    if (error) toast(error.message, "error");
    else { toast("Quote reverted to draft"); router.refresh(); }
    setUpdating(false);
  }

  const isProgress = quoteType === "progress";
  const scope = generateScopeOfWorks(deviceCounts, siteInfo);

  function openBOMWindow(mode: "warehouse" | "supplier") {
    const w = window.open("", "_blank");
    if (!w) return;

    const date = new Date(createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
    const items = lineItems.filter((i: any) => i.quantity > 0);

    let body = "";

    if (mode === "warehouse") {
      // Flat pick list sorted by category, with checkbox column
      const sorted = [...items].sort((a: any, b: any) => (a.category || "").localeCompare(b.category || "") || (a.product_name || "").localeCompare(b.product_name || ""));
      let currentCat = "";
      let rows = "";
      for (const item of sorted) {
        if (item.category !== currentCat) {
          currentCat = item.category;
          rows += `<tr><td colspan="5" style="padding:12px 8px 6px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;border-bottom:2px solid #e2e8f0">${currentCat}</td></tr>`;
        }
        rows += `<tr>
          <td style="padding:8px;text-align:center;width:40px"><div style="width:18px;height:18px;border:2px solid #94a3b8;border-radius:3px;margin:0 auto"></div></td>
          <td style="padding:8px;font-weight:500">${item.product_name}</td>
          <td style="padding:8px;font-family:monospace;color:#64748b;font-size:12px">${item.sku || "—"}</td>
          <td style="padding:8px;text-align:center;font-weight:700;font-size:16px">${item.quantity}</td>
          <td style="padding:8px;color:#94a3b8;font-size:12px">${item.supplier || "—"}</td>
        </tr>`;
      }
      body = `
        <h1 style="font-size:22px;font-weight:700;margin:0">Warehouse Pick List</h1>
        <p style="color:#64748b;margin:4px 0 0;font-size:13px">${quoteRef} — ${clientName}${siteName ? " — " + siteName : ""}</p>
        <p style="color:#94a3b8;margin:2px 0 24px;font-size:12px">${date} · ${items.length} line items</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="border-bottom:2px solid #0f172a">
            <th style="padding:8px;width:40px"></th>
            <th style="padding:8px;text-align:left">Product</th>
            <th style="padding:8px;text-align:left">SKU</th>
            <th style="padding:8px;text-align:center;width:60px">Qty</th>
            <th style="padding:8px;text-align:left">Supplier</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between">
          <div><p style="font-size:11px;color:#94a3b8">Picked by: ___________________________</p></div>
          <div><p style="font-size:11px;color:#94a3b8">Date: _______________</p></div>
        </div>`;
    } else {
      // Group by supplier
      const bySupplier = new Map<string, any[]>();
      for (const item of items) {
        const sup = item.supplier || "No Supplier Assigned";
        const list = bySupplier.get(sup) ?? [];
        list.push(item);
        bySupplier.set(sup, list);
      }
      const sortedSuppliers = [...bySupplier.entries()].sort((a, b) => a[0].localeCompare(b[0]));

      let sections = "";
      for (const [supplier, supItems] of sortedSuppliers) {
        const supTotal = supItems.reduce((s: number, i: any) => s + (i.cost_price || 0) * (i.quantity || 0), 0);
        let rows = "";
        for (const item of supItems) {
          const lineTotal = (item.cost_price || 0) * (item.quantity || 0);
          rows += `<tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:8px;font-weight:500">${item.product_name}</td>
            <td style="padding:8px;font-family:monospace;color:#64748b;font-size:12px">${item.sku || "—"}</td>
            <td style="padding:8px;text-align:center;font-weight:600">${item.quantity}</td>
            <td style="padding:8px;text-align:right;font-family:monospace">$${(item.cost_price || 0).toFixed(2)}</td>
            <td style="padding:8px;text-align:right;font-family:monospace;font-weight:600">$${lineTotal.toFixed(2)}</td>
          </tr>`;
        }
        sections += `
          <div style="margin-bottom:28px;page-break-inside:avoid">
            <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #0f172a;padding-bottom:6px;margin-bottom:0">
              <h2 style="font-size:15px;font-weight:700;margin:0">${supplier}</h2>
              <span style="font-size:14px;font-weight:700;font-family:monospace">$${supTotal.toFixed(2)}</span>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead><tr style="border-bottom:1px solid #e2e8f0">
                <th style="padding:8px;text-align:left">Product</th>
                <th style="padding:8px;text-align:left">SKU</th>
                <th style="padding:8px;text-align:center;width:50px">Qty</th>
                <th style="padding:8px;text-align:right">Unit Cost</th>
                <th style="padding:8px;text-align:right">Total</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
      }

      const grandTotal = items.reduce((s: number, i: any) => s + (i.cost_price || 0) * (i.quantity || 0), 0);
      body = `
        <h1 style="font-size:22px;font-weight:700;margin:0">Supplier Purchase Orders</h1>
        <p style="color:#64748b;margin:4px 0 0;font-size:13px">${quoteRef} — ${clientName}${siteName ? " — " + siteName : ""}</p>
        <p style="color:#94a3b8;margin:2px 0 24px;font-size:12px">${date} · ${sortedSuppliers.length} supplier${sortedSuppliers.length !== 1 ? "s" : ""} · Total cost: <strong style="color:#0f172a">$${grandTotal.toFixed(2)}</strong></p>
        ${sections}`;
    }

    w.document.write(`<!DOCTYPE html><html><head>
      <title>${mode === "warehouse" ? "Warehouse Pick List" : "Supplier Orders"} — ${quoteRef}</title>
      <style>
        @page { size: A4; margin: 15mm; }
        body { font-family: 'Segoe UI', system-ui, sans-serif; padding: 32px; color: #1a1a1a; }
        @media print { body { padding: 0; } }
        table { border-spacing: 0; }
        tr:nth-child(even) { background: #f8fafc; }
      </style>
    </head><body>${body}</body></html>`);
    w.document.close();
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {/* Edit — draft only */}
        {status === "draft" && (
          <button onClick={() => router.push(`/quoting/${quoteId}/edit`)} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Edit</button>
        )}

        <button onClick={() => setShowPreview(true)} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors">Preview Quote</button>

        {/* Warehouse Pick List */}
        <button onClick={() => openBOMWindow("warehouse")} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Warehouse BOM</button>

        {/* Supplier Purchase Orders */}
        <button onClick={() => openBOMWindow("supplier")} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Supplier Orders</button>

        {/* Mark as Sent */}
        {status === "draft" && (
          <button onClick={() => updateStatus("sent", { sent_at: new Date().toISOString() })} disabled={updating} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors">Mark as Sent</button>
        )}

        {/* Send to Customer email */}
        {(status === "draft" || status === "sent") && (
          <div className="flex items-center gap-1.5">
            <input type="email" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} placeholder="customer@email.com" className="h-8 w-48 rounded-md border border-border bg-input px-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
            <button onClick={handleSendToCustomer} disabled={sending} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors">
              {sending ? "Sending..." : "Send to Customer"}
            </button>
          </div>
        )}

        {/* Accept / Decline */}
        {status === "sent" && (
          <>
            <button onClick={() => updateStatus("accepted", { accepted_at: new Date().toISOString() })} disabled={updating} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors">Accepted</button>
            <button onClick={() => updateStatus("declined", { declined_at: new Date().toISOString() })} disabled={updating} className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors">Declined</button>
          </>
        )}

        {/* Payment tracking */}
        {status === "accepted" && (
          <>
            <button onClick={() => markPayment("pp1_paid")} disabled={updating} className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors">Record PP1</button>
            <button onClick={() => markPayment("pp2_paid")} disabled={updating} className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors">Record PP2</button>
          </>
        )}

        {/* Revert to Draft — for sent/declined/accepted */}
        {(status === "sent" || status === "declined" || status === "accepted") && (
          <button onClick={revertToDraft} disabled={updating} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors">Revert to Draft</button>
        )}

        {/* Link to Job */}
        <select
          value={currentJobId || ""}
          onChange={async (e) => {
            const newJobId = e.target.value || null;
            setCurrentJobId(newJobId);
            await supabase.from("quotes").update({ job_id: newJobId }).eq("id", quoteId);
            // Auto-transition the newly linked job based on current quote status
            if (newJobId) {
              const actionMap: Record<string, string> = { draft: "quote_created", sent: "quote_sent", accepted: "quote_accepted", declined: "quote_declined" };
              if (actionMap[status]) await autoTransitionJobStatus(newJobId, actionMap[status], supabase);
            }
            router.refresh();
          }}
          className="h-8 rounded-md border border-border bg-input px-2 text-xs text-foreground focus:border-primary focus:outline-none"
        >
          <option value="">No job linked</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.number}{j.customer_name ? ` — ${j.customer_name}` : ''}
            </option>
          ))}
        </select>

        {/* Delete */}
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} className="rounded-md border border-red-500/20 px-3 py-1.5 text-xs text-red-400/60 hover:text-red-400 hover:border-red-500/40 transition-colors">Delete</button>
        ) : (
          <div className="flex items-center gap-1.5">
            <button onClick={handleDelete} disabled={updating} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50 transition-colors">Confirm Delete</button>
            <button onClick={() => setConfirmDelete(false)} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
          </div>
        )}
      </div>

      {/* ── QUOTE PREVIEW MODAL ── */}
      {showPreview && pricing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowPreview(false)} />

          <div className="relative w-full max-w-[850px] max-h-[95vh] overflow-y-auto rounded-xl shadow-2xl">
            {/* Floating toolbar */}
            <div className="sticky top-0 z-10 flex items-center justify-between bg-gray-900/95 backdrop-blur px-6 py-3 rounded-t-xl border-b border-white/10">
              <span className="text-sm font-medium text-white">Quote Preview — {quoteRef}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => {
                  const el = document.getElementById("quote-doc");
                  if (!el) return;
                  const w = window.open("", "_blank");
                  if (!w) return;
                  // Clone and fix image URLs to absolute
                  const clone = el.cloneNode(true) as HTMLElement;
                  clone.querySelectorAll("img").forEach((img) => {
                    if (img.src.startsWith("/")) img.src = window.location.origin + img.getAttribute("src");
                  });
                  w.document.write(`<!DOCTYPE html>
<html>
<head>
<title>${quoteRef} — CentreFit Quotation</title>
<style>
  @page {
    size: A4;
    margin: 15mm 15mm 20mm 15mm;
  }
  @media print {
    html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    /* Page break controls */
    .scope-section { page-break-inside: avoid; }
    .pricing-block { page-break-inside: avoid; }
    .payment-block { page-break-inside: avoid; }
    .notes-block { page-break-inside: avoid; }
    .standards-block { page-break-inside: avoid; }
    .terms-block { page-break-inside: avoid; }
    /* Force footer to bottom of last page */
    .quote-footer { page-break-inside: avoid; }
  }
</style>
</head>
<body>${clone.outerHTML}</body>
</html>`);
                  w.document.close();
                  // Wait for images to load then print
                  w.onload = () => w.print();
                  setTimeout(() => w.print(), 500);
                }} className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20 transition-colors">Print / Save PDF</button>
                <button onClick={() => setShowPreview(false)} className="rounded-md bg-white/10 px-2 py-1.5 text-white hover:bg-white/20 transition-colors">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            {/* ── THE QUOTE DOCUMENT ── */}
            <div id="quote-doc" style={{ background: "#ffffff", color: "#1a1a1a", fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif", fontSize: "14px", lineHeight: "1.6" }}>

              {/* Header band */}
              <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)", color: "#ffffff", padding: "40px 48px 32px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <img src="/centrefit-logo.png" alt="CentreFit" style={{ height: "48px", marginBottom: "12px" }} />
                    <p style={{ fontSize: "11px", color: "#94a3b8", margin: 0 }}>Centrefit Group Pty Ltd</p>
                    <p style={{ fontSize: "11px", color: "#94a3b8", margin: 0 }}>ABN: 55 168 413 161</p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: "28px", fontWeight: 700, margin: 0, letterSpacing: "-0.5px" }}>QUOTATION</p>
                    <p style={{ fontSize: "16px", color: "#60a5fa", fontWeight: 600, margin: "4px 0 0" }}>{quoteRef}</p>
                    <p style={{ fontSize: "12px", color: "#94a3b8", margin: "4px 0 0" }}>
                      {new Date(createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  </div>
                </div>
              </div>

              {/* Client details bar */}
              <div style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", padding: "20px 48px", display: "flex", justifyContent: "space-between" }}>
                <div>
                  <p style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px", color: "#64748b", margin: "0 0 4px" }}>Prepared For</p>
                  <p style={{ fontSize: "18px", fontWeight: 700, margin: 0, color: "#0f172a" }}>{clientName}</p>
                  {siteName && <p style={{ fontSize: "14px", color: "#475569", margin: "2px 0 0" }}>{siteName}</p>}
                  {siteAddress && <p style={{ fontSize: "12px", color: "#94a3b8", margin: "2px 0 0" }}>{siteAddress}</p>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px", color: "#64748b", margin: "0 0 4px" }}>Contact</p>
                  <p style={{ fontSize: "12px", color: "#475569", margin: "2px 0 0" }}>(07) 3188 5115</p>
                  <p style={{ fontSize: "12px", color: "#475569", margin: "2px 0 0" }}>admin@centrefit.com.au</p>
                  <p style={{ fontSize: "12px", color: "#475569", margin: "2px 0 0" }}>1/25 Paisley Drive, Lawnton QLD 4501</p>
                </div>
              </div>

              {/* Content area */}
              <div style={{ padding: "32px 48px" }}>

                {/* ── SCOPE OF WORKS ── */}
                <div style={{ marginBottom: "32px" }}>
                  <p style={{ fontSize: "14px", textTransform: "uppercase", letterSpacing: "1.5px", color: "#0f172a", fontWeight: 700, margin: "0 0 20px", borderBottom: "2px solid #0f172a", paddingBottom: "8px" }}>Scope of Works</p>

                  {scope.sections.map((section) => (
                    <div key={section.heading} className="scope-section" style={{ marginBottom: "24px" }}>
                      <p style={{ fontSize: "12px", fontWeight: 700, color: "#334155", textTransform: "uppercase", letterSpacing: "1px", margin: "0 0 12px", paddingBottom: "4px", borderBottom: "1px solid #e2e8f0" }}>{section.heading}</p>
                      {section.items.map((item, i) => {
                        const isExclusion = item.startsWith('ANY AND ALL');
                        return (
                          <p key={i} style={{
                            fontSize: "12px",
                            color: isExclusion ? "#dc2626" : "#475569",
                            fontWeight: isExclusion ? 700 : 400,
                            margin: "0 0 8px",
                            paddingLeft: isExclusion ? 0 : "12px",
                            borderLeft: isExclusion ? "none" : "2px solid #e2e8f0",
                            lineHeight: "1.6",
                          }}>
                            {item}
                          </p>
                        );
                      })}
                    </div>
                  ))}

                  {/* Please Note items */}
                  {scope.notes.length > 0 && (
                    <div className="notes-block" style={{ marginTop: "16px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", padding: "16px 20px" }}>
                      {scope.notes.map((note, i) => (
                        <p key={i} style={{ fontSize: "11px", color: "#92400e", margin: i === 0 ? 0 : "6px 0 0", lineHeight: "1.5" }}>
                          <strong>PLEASE NOTE:</strong>&nbsp;&nbsp;{note}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── PRICING ── */}
                <div className="pricing-block" style={{ marginBottom: "32px" }}>
                  <p style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "1.5px", color: "#64748b", fontWeight: 700, margin: "0 0 16px", borderBottom: "2px solid #e2e8f0", paddingBottom: "8px" }}>Pricing</p>

                  <div style={{ background: "#f8fafc", borderRadius: "12px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
                    <div style={{ padding: "24px 28px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
                        <span style={{ fontSize: "14px", color: "#64748b" }}>Total (ex GST)</span>
                        <span style={{ fontSize: "18px", fontWeight: 600, color: "#0f172a", fontFamily: "monospace" }}>${fmt(pricing.totalExGST)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
                        <span style={{ fontSize: "14px", color: "#64748b" }}>GST (10%)</span>
                        <span style={{ fontSize: "16px", color: "#475569", fontFamily: "monospace" }}>${fmt(pricing.gst)}</span>
                      </div>
                    </div>
                    <div style={{ background: "#0f172a", padding: "20px 28px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: "16px", fontWeight: 700, color: "#ffffff", textTransform: "uppercase", letterSpacing: "0.5px" }}>Total (inc GST)</span>
                      <span style={{ fontSize: "28px", fontWeight: 800, color: "#ffffff", fontFamily: "monospace" }}>${fmt(pricing.totalIncGST)}</span>
                    </div>
                  </div>
                </div>

                {/* Progress Payments */}
                {isProgress && (
                  <div className="payment-block" style={{ marginBottom: "32px" }}>
                    <p style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "1.5px", color: "#64748b", fontWeight: 700, margin: "0 0 16px", borderBottom: "2px solid #e2e8f0", paddingBottom: "8px" }}>Progress Payments</p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                      <div style={{ background: "#f8fafc", borderRadius: "10px", border: "1px solid #e2e8f0", padding: "20px" }}>
                        <p style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px", color: "#64748b", margin: "0 0 8px" }}>Payment 1 — Due on Acceptance</p>
                        <p style={{ fontSize: "24px", fontWeight: 700, color: "#0f172a", fontFamily: "monospace", margin: 0 }}>${fmt(pricing.pp1.total * 1.1)}</p>
                        <p style={{ fontSize: "11px", color: "#94a3b8", margin: "4px 0 0" }}>inc GST</p>
                      </div>
                      <div style={{ background: "#f8fafc", borderRadius: "10px", border: "1px solid #e2e8f0", padding: "20px" }}>
                        <p style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px", color: "#64748b", margin: "0 0 8px" }}>Payment 2 — Due on Completion</p>
                        <p style={{ fontSize: "24px", fontWeight: 700, color: "#0f172a", fontFamily: "monospace", margin: 0 }}>${fmt(pricing.pp2.total * 1.1)}</p>
                        <p style={{ fontSize: "11px", color: "#94a3b8", margin: "4px 0 0" }}>inc GST</p>
                      </div>
                    </div>
                    <p style={{ fontSize: "11px", color: "#64748b", marginTop: "12px", textAlign: "center" }}>
                      Invoice as per Progress Payment schedule. Quote as per Zone 1 or Zone 2 (Zone 1: 0-100km — Zone 2: 101km+).
                    </p>
                  </div>
                )}

                {/* Terms */}
                <div className="terms-block" style={{ marginBottom: "32px" }}>
                  <p style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "1.5px", color: "#64748b", fontWeight: 700, margin: "0 0 12px", borderBottom: "2px solid #e2e8f0", paddingBottom: "8px" }}>Terms & Conditions</p>
                  <div style={{ fontSize: "11px", color: "#64748b", lineHeight: "1.7" }}>
                    <p style={{ margin: "0 0 6px" }}>This quotation is valid for 30 days from the date of issue.</p>
                    <p style={{ margin: "0 0 6px" }}>Any and all electrical works are not included in this quotation.</p>
                    <p style={{ margin: "0 0 6px" }}>The fitting of electronic door strikes is not included and will be invoiced directly by the locksmith.</p>
                    <p style={{ margin: "0 0 6px" }}>Monthly security monitoring fees of $55.00 ex GST applies to this service (Direct Debit).</p>
                    <p style={{ margin: "0 0 6px" }}>Annual mobile app subscription of $133.50 ex GST applies (Direct Debit).</p>
                    <p style={{ margin: "0 0 6px" }}>Full training for all facility staff is included.</p>
                  </div>
                </div>

                {/* Standards */}
                <div className="standards-block" style={{ marginBottom: "24px" }}>
                  <p style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "1.5px", color: "#64748b", fontWeight: 700, margin: "0 0 12px", borderBottom: "2px solid #e2e8f0", paddingBottom: "8px" }}>Standards and Codes of Practice</p>
                  <div style={{ fontSize: "11px", color: "#94a3b8", lineHeight: "1.7" }}>
                    {scope.standards.map((std, i) => (
                      <p key={i} style={{ margin: "0 0 3px" }}>{std}</p>
                    ))}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="quote-footer" style={{ background: "#f8fafc", borderTop: "1px solid #e2e8f0", padding: "20px 48px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: "10px", color: "#94a3b8" }}>
                  <p style={{ margin: 0 }}>Centrefit Group Pty Ltd · ABN 55 168 413 161</p>
                  <p style={{ margin: "2px 0 0" }}>1/25 Paisley Drive, Lawnton QLD 4501 · (07) 3188 5115</p>
                </div>
                <img src="/centrefit-badge.png" alt="" style={{ height: "32px", opacity: 0.5 }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
