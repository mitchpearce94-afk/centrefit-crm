"use client";

import { useState } from "react";
import { renderScopeAsHtml, type ScopeDocument } from "@/lib/quote-engine";

interface Props {
  token: string;
  quoteId: string;
  quoteRef: string;
  quoteStatus: string;
  isProgress: boolean;
  clientName: string;
  siteName: string | null;
  siteAddress: string | null;
  createdAt: string;
  pricing: {
    totalExGST: number;
    totalIncGST: number;
    gst: number;
    fullPriceExGST?: number;
    discount?: { percent: number; amount: number };
    pp1?: { total: number };
    pp2?: { total: number };
  };
  scope: ScopeDocument;
}

function fmt(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function QuoteResponseView(props: Props) {
  const {
    token, quoteId, quoteRef, quoteStatus, isProgress,
    clientName, siteName, siteAddress, createdAt, pricing, scope,
  } = props;

  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [done, setDone] = useState<{ action: "accept" | "decline"; ref: string } | null>(
    quoteStatus === "accepted" ? { action: "accept", ref: quoteRef }
    : quoteStatus === "declined" ? { action: "decline", ref: quoteRef }
    : null
  );
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState<"accept" | "decline" | null>(null);

  const dateStr = new Date(createdAt).toLocaleDateString("en-AU", {
    day: "numeric", month: "long", year: "numeric",
  });

  async function respond(action: "accept" | "decline") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/quotes/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      setDone({ action, ref: data.ref });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
    setBusy(null);
    setShowConfirm(null);
  }

  // ── Done state (already accepted/declined) ───────────────────────────────
  if (done) {
    return (
      <div style={pageStyle}>
        <div style={panelStyle}>
          <div style={{ ...iconWrap, background: done.action === "accept" ? "#dcfce7" : "#fef2f2" }}>
            {done.action === "accept" ? (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            )}
          </div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#0f172a", margin: "0 0 8px", textAlign: "center" }}>
            Quote {done.ref} {done.action === "accept" ? "Accepted" : "Declined"}
          </h1>
          <p style={{ fontSize: "14px", color: "#64748b", lineHeight: 1.6, textAlign: "center", margin: 0 }}>
            {done.action === "accept"
              ? "Thank you! Your quote has been accepted. The CentreFit team will be in touch shortly to schedule the work."
              : "Quote declined. If you'd like to discuss alternatives, please contact the CentreFit team."}
          </p>
          <div style={{ marginTop: "24px", padding: "16px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", textAlign: "center" }}>
            <p style={{ fontSize: "12px", color: "#94a3b8", margin: 0 }}>Centrefit Group Pty Ltd</p>
            <p style={{ fontSize: "12px", color: "#94a3b8", margin: "2px 0 0" }}>(07) 3188 5115 · admin@centrefit.com.au</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Active state — quote viewable + respondable ──────────────────────────
  // We render the same scope HTML used in the PDF + email so customers see
  // the identical document. A sticky footer holds the Accept / Decline
  // buttons so they're reachable no matter how far the customer has scrolled.
  const scopeHtml = renderScopeAsHtml(scope);

  return (
    <div className="qr-page">
      <style>{`
        .qr-page {
          min-height: 100vh;
          background: #f1f5f9;
          font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
          padding: 24px 12px calc(140px + env(safe-area-inset-bottom));
        }
        .qr-card {
          background: #ffffff;
          border-radius: 16px;
          padding: 28px 24px;
          max-width: 780px;
          width: 100%;
          margin: 0 auto;
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
          box-sizing: border-box;
        }
        .qr-brand-strip {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          border-bottom: 2px solid #0f172a;
          padding-bottom: 14px;
          margin-bottom: 20px;
          gap: 16px;
        }
        .qr-brand-logo { height: 40px; width: auto; display: block; }
        .qr-h1 {
          font-size: 20px;
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 4px;
          letter-spacing: -0.3px;
          line-height: 1.25;
        }
        .qr-pp-grid { display: flex; gap: 10px; margin-bottom: 20px; }
        .qr-sticky {
          position: fixed;
          left: 0; right: 0; bottom: 0;
          background: rgba(255,255,255,0.96);
          -webkit-backdrop-filter: saturate(180%) blur(8px);
          backdrop-filter: saturate(180%) blur(8px);
          border-top: 1px solid #e2e8f0;
          padding-top: 14px;
          padding-bottom: calc(14px + env(safe-area-inset-bottom));
          padding-left: 16px;
          padding-right: 16px;
          z-index: 40;
          box-shadow: 0 -4px 16px rgba(15,23,42,0.08);
        }
        .qr-sticky-inner {
          max-width: 780px;
          margin: 0 auto;
          display: flex;
          gap: 10px;
          align-items: center;
          justify-content: center;
        }
        .qr-btn {
          appearance: none;
          border: none;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          letter-spacing: 0.3px;
          padding: 14px 20px;
        }
        .qr-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
        .qr-btn-decline { background: #fff; color: #dc2626; border: 2px solid #fca5a5; }
        .qr-btn-accept  { background: #16a34a; color: #fff; }

        /* The renderScopeAsHtml output uses inline pixel styles — these
           overrides relax them so cards reflow on small screens. */
        .qr-scope img, .qr-scope table { max-width: 100%; }
        .qr-scope > div, .qr-scope > div > div {
          box-sizing: border-box;
        }

        @media (max-width: 640px) {
          .qr-page { padding: 12px 8px calc(150px + env(safe-area-inset-bottom)); }
          .qr-card { padding: 20px 16px; border-radius: 12px; }
          .qr-brand-strip { padding-bottom: 12px; margin-bottom: 16px; gap: 10px; }
          .qr-brand-logo { height: 32px; }
          .qr-h1 { font-size: 18px; }
          .qr-pp-grid { flex-direction: column; gap: 8px; }
          /* The summary card grid emitted by renderScopeAsHtml uses a 2-column
             grid that's tight on phones — collapse to one column. */
          .qr-scope div[style*="grid-template-columns:repeat(2,1fr)"] {
            grid-template-columns: 1fr !important;
          }
          .qr-sticky-inner { gap: 8px; }
          .qr-btn { padding: 12px 14px; font-size: 13px; flex: 1; min-width: 0; }
        }
      `}</style>

      <div className="qr-card">
        {/* Brand strip */}
        <div className="qr-brand-strip">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/centrefit-logo-blue.png"
            alt="Centrefit Group"
            className="qr-brand-logo"
          />
          <div style={{ textAlign: "right", flex: "0 0 auto" }}>
            <p style={{ fontSize: "10px", color: "#94a3b8", letterSpacing: "1.5px", margin: 0, fontWeight: 700, textTransform: "uppercase" }}>Quotation</p>
            <p style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a", margin: "2px 0 0", fontFamily: "Consolas, monospace" }}>{quoteRef}</p>
            <p style={{ fontSize: "11px", color: "#475569", margin: "1px 0 0" }}>{dateStr}</p>
          </div>
        </div>

        {/* Title + client */}
        <h1 className="qr-h1">
          {clientName}{siteName ? ` — ${siteName}` : ""}
        </h1>
        {siteAddress && (
          <p style={{ fontSize: "13px", color: "#94a3b8", margin: "0 0 20px" }}>{siteAddress}</p>
        )}

        {/* Headline total */}
        <div style={{ background: "#0f172a", borderRadius: "10px", padding: "20px 24px", marginBottom: "12px" }}>
          <p style={{ fontSize: "11px", color: "#94a3b8", margin: 0, letterSpacing: "1px", textTransform: "uppercase", fontWeight: 700 }}>Total inc GST</p>
          <p style={{ fontSize: "32px", color: "#fff", fontWeight: 800, margin: "4px 0 0", fontFamily: "Consolas, monospace", letterSpacing: "-0.5px" }}>
            ${fmt(pricing.totalIncGST)}
          </p>
          <p style={{ fontSize: "12px", color: "#94a3b8", margin: "3px 0 0" }}>
            ${fmt(pricing.totalExGST)} ex GST · ${fmt(pricing.gst)} GST
          </p>
        </div>

        {isProgress && pricing.pp1 && pricing.pp2 && (
          <div className="qr-pp-grid">
            <div style={{ flex: 1, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "14px", textAlign: "center" }}>
              <p style={{ fontSize: "10px", color: "#64748b", letterSpacing: "1px", textTransform: "uppercase", fontWeight: 700, margin: 0 }}>Payment 1 — On Acceptance</p>
              <p style={{ fontSize: "20px", color: "#0f172a", fontWeight: 700, margin: "5px 0 0", fontFamily: "Consolas, monospace" }}>${fmt(pricing.pp1.total * 1.1)}</p>
              <p style={{ fontSize: "10px", color: "#94a3b8", margin: "2px 0 0" }}>inc GST</p>
            </div>
            <div style={{ flex: 1, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "14px", textAlign: "center" }}>
              <p style={{ fontSize: "10px", color: "#64748b", letterSpacing: "1px", textTransform: "uppercase", fontWeight: 700, margin: 0 }}>Payment 2 — On Completion</p>
              <p style={{ fontSize: "20px", color: "#0f172a", fontWeight: 700, margin: "5px 0 0", fontFamily: "Consolas, monospace" }}>${fmt(pricing.pp2.total * 1.1)}</p>
              <p style={{ fontSize: "10px", color: "#94a3b8", margin: "2px 0 0" }}>inc GST</p>
            </div>
          </div>
        )}

        {/* PDF download */}
        <div style={{ margin: "20px 0", padding: "14px 16px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
          <div>
            <p style={{ fontSize: "13px", color: "#0f172a", fontWeight: 600, margin: 0 }}>Centrefit Quote PDF</p>
            <p style={{ fontSize: "11px", color: "#64748b", margin: "2px 0 0" }}>Same document as below — downloadable copy</p>
          </div>
          <a
            href={`/api/quotes/by-token/${token}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-block", background: "#fff", color: "#0f172a", border: "1px solid #cbd5e1", borderRadius: "6px", padding: "9px 16px", fontSize: "12px", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
          >
            Download PDF
          </a>
        </div>

        {/* Full scope of works — same content as the PDF */}
        <div
          className="qr-scope"
          style={{ marginTop: "8px" }}
          dangerouslySetInnerHTML={{ __html: scopeHtml }}
        />

        {/* Error inline */}
        {error && (
          <div style={{ marginTop: "16px", padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", color: "#991b1b", fontSize: "12px" }}>
            {error}
          </div>
        )}

        <p style={{ fontSize: "11px", color: "#94a3b8", textAlign: "center", margin: "20px 0 0" }}>
          Quotation valid for 30 days from {dateStr}.
        </p>
      </div>

      {/* Persistent Accept / Decline bar */}
      <div className="qr-sticky">
        <div className="qr-sticky-inner">
          <button
            type="button"
            onClick={() => setShowConfirm("decline")}
            disabled={!!busy}
            className="qr-btn qr-btn-decline"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => setShowConfirm("accept")}
            disabled={!!busy}
            className="qr-btn qr-btn-accept"
          >
            Accept Quote
          </button>
        </div>
      </div>

      {/* Confirm modal */}
      {showConfirm && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowConfirm(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", zIndex: 50 }}
        >
          <div style={{ background: "#fff", borderRadius: "12px", padding: "28px", maxWidth: "400px", width: "100%", boxShadow: "0 12px 48px rgba(0,0,0,0.2)" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a", margin: "0 0 6px" }}>
              {showConfirm === "accept" ? `Accept quote ${quoteRef}?` : `Decline quote ${quoteRef}?`}
            </h2>
            <p style={{ fontSize: "13px", color: "#475569", lineHeight: 1.6, margin: "0 0 18px" }}>
              {showConfirm === "accept"
                ? `By accepting, you confirm the scope and total of $${fmt(pricing.totalIncGST)} inc GST. The CentreFit team will be in touch to schedule.`
                : "We'll mark this quote as declined and the CentreFit team will get in touch if there's anything to discuss."}
            </p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowConfirm(null)}
                disabled={!!busy}
                style={{ background: "#fff", color: "#475569", border: "1px solid #cbd5e1", borderRadius: "8px", padding: "9px 16px", fontSize: "13px", fontWeight: 600, cursor: busy ? "not-allowed" : "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={() => respond(showConfirm)}
                disabled={!!busy}
                style={{
                  background: showConfirm === "accept" ? "#16a34a" : "#dc2626",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  padding: "9px 16px",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: busy ? "not-allowed" : "pointer",
                }}
              >
                {busy === showConfirm ? "Submitting..." : showConfirm === "accept" ? "Yes, accept" : "Yes, decline"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Layout styles ──────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f1f5f9",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
  padding: "32px 16px",
};

const panelStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: "16px",
  padding: "32px",
  maxWidth: "480px",
  width: "100%",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
};

const iconWrap: React.CSSProperties = {
  width: "64px",
  height: "64px",
  borderRadius: "50%",
  margin: "0 auto 18px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
