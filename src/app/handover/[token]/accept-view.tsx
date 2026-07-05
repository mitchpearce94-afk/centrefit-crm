"use client";

import { useState } from "react";
import { SignaturePad } from "@/components/ui/signature-pad";

/**
 * Client side of the public handover acceptance page: review the pack PDF
 * (served by token), then sign on glass to acknowledge receipt.
 */

export function HandoverAcceptView({
  token,
  status,
  siteName,
  clientName,
  dateDisplay,
  recipientName,
  signedAt,
  signerName: signedBy,
}: {
  token: string;
  status: "sent" | "viewed" | "signed";
  siteName: string;
  clientName: string;
  dateDisplay: string;
  recipientName: string | null;
  signedAt: string | null;
  signerName: string | null;
}) {
  const [signature, setSignature] = useState<string | null>(null);
  const [name, setName] = useState(recipientName ?? "");
  const [position, setPosition] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(status === "signed");

  const pdfUrl = `/api/public/handover/${token}/pdf`;

  async function submit() {
    if (!name.trim() || !position.trim() || !signature) {
      setError("Please print your name, enter your position and sign in the box.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/handover/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signerName: name.trim(), signerPosition: position.trim(), signature }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Something went wrong");
      setDone(true);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif", paddingBottom: 60 }}>
      <header style={{ background: "linear-gradient(135deg,#0f172a,#1e293b)", padding: "20px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/centrefit-logo-white.png" alt="Centrefit Group" style={{ height: 34, width: "auto", display: "block" }} />
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: 10, color: "#94a3b8", margin: 0, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700 }}>Handover</p>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#60a5fa", margin: "2px 0 0" }}>{dateDisplay}</p>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "20px 16px", display: "grid", gap: 16 }}>
        {done ? (
          <div style={{ background: "#fff", borderRadius: 14, padding: "44px 30px", textAlign: "center", boxShadow: "0 1px 3px rgba(15,23,42,0.08)" }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#dcfce7", margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", margin: "0 0 10px" }}>Handover accepted</h1>
            <p style={{ fontSize: 14, color: "#475569", lineHeight: 1.7, margin: 0 }}>
              Thanks{signedBy ? `, signed by ${signedBy}` : ""}
              {signedAt ? ` on ${new Date(signedAt).toLocaleDateString("en-AU")}` : ""}. Your signed pack
              (including the acceptance record) is available below — save a copy for your records.
            </p>
            <p style={{ marginTop: 20 }}>
              <a href={pdfUrl} style={{ display: "inline-block", background: "#3b82f6", color: "#fff", padding: "12px 24px", borderRadius: 10, fontSize: 14, fontWeight: 700, textDecoration: "none" }}>
                Download Signed Pack
              </a>
            </p>
          </div>
        ) : (
          <>
            <div style={{ background: "#fff", borderRadius: 14, padding: 24, boxShadow: "0 1px 3px rgba(15,23,42,0.08)" }}>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", margin: "0 0 6px", letterSpacing: "-0.3px" }}>
                Handover Documentation — {siteName}
              </h1>
              <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.65, margin: 0 }}>
                {clientName ? `Prepared for ${clientName}. ` : ""}This pack contains the datasheets for the
                equipment installed at your facility, operating procedures, your Wi-Fi details and our
                compliance statement. Review it below, then sign to acknowledge receipt.
              </p>
              <p style={{ marginTop: 16 }}>
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: "inline-block", background: "#3b82f6", color: "#fff", padding: "12px 24px", borderRadius: 10, fontSize: 14, fontWeight: 700, textDecoration: "none" }}
                >
                  Open Handover Pack (PDF)
                </a>
              </p>
            </div>

            <div style={{ background: "#fff", borderRadius: 14, padding: 24, boxShadow: "0 1px 3px rgba(15,23,42,0.08)" }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", margin: "0 0 6px" }}>Acknowledge receipt</h2>
              <p style={{ fontSize: 12.5, color: "#64748b", lineHeight: 1.6, margin: "0 0 16px" }}>
                I acknowledge receipt of this handover documentation and accept the installation of the
                equipment described within as complete.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <label style={{ display: "block" }}>
                  <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>Print Name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={{ width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: 8, padding: "9px 12px", fontSize: 13.5, fontFamily: "inherit" }}
                  />
                </label>
                <label style={{ display: "block" }}>
                  <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>Position</span>
                  <input
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    style={{ width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: 8, padding: "9px 12px", fontSize: 13.5, fontFamily: "inherit" }}
                  />
                </label>
              </div>
              <SignaturePad onChange={setSignature} />
              {error && (
                <p style={{ marginTop: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#b91c1c" }}>{error}</p>
              )}
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                style={{ display: "block", width: "100%", marginTop: 16, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 12, padding: 15, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: submitting ? 0.6 : 1 }}
              >
                {submitting ? "Submitting…" : "Sign & Accept Handover"}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
