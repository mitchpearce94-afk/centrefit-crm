import { createClient as createServiceClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { logDocumentActivity, shouldLogView } from "@/lib/activity/log";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import type { MonitoringPrefill } from "@/lib/monitoring-form/spec";
import { MonitoringFormView } from "./form-view";

/**
 * Public tokenised Security Monitoring Response Instructions form
 * (docs/documentation-CONTEXT.md Phase B). Same access model as
 * /quote-response/[token]: the unguessable per-recipient token in the URL is
 * the credential; data access runs on the service-role client. The path is
 * exempted from auth in src/lib/supabase/middleware.ts.
 */

export const dynamic = "force-dynamic";

export default async function MonitoringFormPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return <NotFoundView title="Server is misconfigured" message="Please contact Centrefit on (07) 3188 5115." />;
  }

  const sb = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: request } = await sb
    .from("document_sign_requests")
    .select("*")
    .eq("token", token)
    .eq("document_type", "monitoring_form")
    .maybeSingle();

  if (!request || request.status === "void") {
    return (
      <NotFoundView
        title="Link not found"
        message="This form link has expired or been replaced. Reply to the original email or contact Centrefit on (07) 3188 5115 if you need a fresh link."
      />
    );
  }

  const prefill = request.prefill as MonitoringPrefill;

  // Audit: log the open (deduped by IP within an hour), flip sent → viewed,
  // and let subscribed staff know the customer has the form open.
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? hdrs.get("x-real-ip") ?? "unknown";
  if (request.status !== "signed" && (await shouldLogView(sb, "monitoring_form", request.id, ip))) {
    await logDocumentActivity({
      supabase: sb,
      documentType: "monitoring_form",
      documentId: request.id,
      eventType: "monitoring_form.viewed",
      actor: "recipient",
      metadata: { ip, user_agent: hdrs.get("user-agent") ?? null, site_id: request.site_id },
    });
    await enqueueNotification({
      typeCode: "monitoring_form.viewed",
      refType: "site",
      refId: request.site_id,
      audience: { allActive: true },
      title: `${prefill.siteName ?? "A site"} opened the monitoring form`,
      body: `Security monitoring instructions v${request.version} viewed by ${request.recipient_email}`,
      href: `/sites/${request.site_id}`,
    });
    if (request.status === "sent") {
      await sb
        .from("document_sign_requests")
        .update({ status: "viewed", viewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", request.id)
        .eq("status", "sent");
    }
  }

  return (
    <MonitoringFormView
      token={token}
      status={request.status as "sent" | "viewed" | "signed"}
      prefill={prefill}
      signedAt={request.signed_at}
      signerName={request.signer_name}
    />
  );
}

function NotFoundView({ title, message }: { title: string; message: string }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif", padding: "16px" }}>
      <div style={{ background: "#ffffff", borderRadius: "16px", padding: "40px", maxWidth: "440px", width: "100%", textAlign: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
        <div style={{ width: "56px", height: "56px", borderRadius: "50%", background: "#fef2f2", margin: "0 auto 18px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
        </div>
        <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#0f172a", margin: "0 0 8px" }}>{title}</h1>
        <p style={{ fontSize: "13px", color: "#475569", lineHeight: 1.6, margin: 0 }}>{message}</p>
      </div>
    </div>
  );
}
