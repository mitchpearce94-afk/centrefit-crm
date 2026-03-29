"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

export default function QuoteResponsePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = params.token as string;
  const action = searchParams.get("action") as "accept" | "decline" | null;

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const [quoteRef, setQuoteRef] = useState("");

  useEffect(() => {
    if (!action || !["accept", "decline"].includes(action)) {
      setStatus("error");
      setMessage("Invalid link.");
      return;
    }

    fetch("/api/quotes/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setStatus("success");
        setQuoteRef(data.ref);
        setMessage(
          action === "accept"
            ? "Thank you! Your quote has been accepted. The CentreFit team will be in touch shortly."
            : "Quote declined. If you have any questions, please contact the CentreFit team."
        );
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err.message || "Something went wrong.");
      });
  }, [token, action]);

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif" }}>
      <div style={{ background: "#ffffff", borderRadius: "16px", padding: "48px", maxWidth: "480px", width: "100%", textAlign: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
        {status === "loading" && (
          <>
            <div style={{ width: "48px", height: "48px", border: "4px solid #e2e8f0", borderTopColor: "#3b82f6", borderRadius: "50%", margin: "0 auto 20px", animation: "spin 1s linear infinite" }} />
            <p style={{ fontSize: "16px", color: "#475569" }}>Processing your response...</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </>
        )}
        {status === "success" && (
          <>
            <div style={{ width: "64px", height: "64px", borderRadius: "50%", margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center", background: action === "accept" ? "#dcfce7" : "#fef2f2" }}>
              {action === "accept" ? (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              ) : (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              )}
            </div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#0f172a", margin: "0 0 8px" }}>
              Quote {quoteRef} {action === "accept" ? "Accepted" : "Declined"}
            </h1>
            <p style={{ fontSize: "14px", color: "#64748b", lineHeight: "1.6" }}>{message}</p>
            <div style={{ marginTop: "24px", padding: "16px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <p style={{ fontSize: "12px", color: "#94a3b8", margin: 0 }}>CentreFit Services Pty Ltd</p>
              <p style={{ fontSize: "12px", color: "#94a3b8", margin: "2px 0 0" }}>(07) 3205 0440 · admin@centrefitgroup.com.au</p>
            </div>
          </>
        )}
        {status === "error" && (
          <>
            <div style={{ width: "64px", height: "64px", borderRadius: "50%", background: "#fef2f2", margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            </div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#0f172a", margin: "0 0 8px" }}>Something went wrong</h1>
            <p style={{ fontSize: "14px", color: "#64748b" }}>{message}</p>
          </>
        )}
      </div>
    </div>
  );
}
