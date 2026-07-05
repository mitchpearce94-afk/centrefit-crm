import { createClient as createServiceClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { logDocumentActivity, shouldLogView } from "@/lib/activity/log";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { HandoverAcceptView } from "./accept-view";

/**
 * Public handover review-and-accept page (Phase D). Same token model as
 * /monitoring-form: the unguessable per-recipient token is the credential;
 * the path is exempted from auth middleware. The pack PDF itself is served
 * by /api/public/handover/[token]/pdf (signed version once accepted).
 */

export const dynamic = "force-dynamic";

export default async function HandoverAcceptPage({
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
    .eq("document_type", "handover")
    .maybeSingle();

  if (!request || request.status === "void") {
    return (
      <NotFoundView
        title="Link not found"
        message="This handover link has expired or been replaced. Contact Centrefit on (07) 3188 5115 if you need a fresh link."
      />
    );
  }

  const prefill = request.prefill as { siteName?: string; clientName?: string; dateDisplay?: string };

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? hdrs.get("x-real-ip") ?? "unknown";
  if (request.status !== "signed" && (await shouldLogView(sb, "handover", request.id, ip))) {
    await logDocumentActivity({
      supabase: sb,
      documentType: "handover",
      documentId: request.id,
      eventType: "handover.viewed",
      actor: "recipient",
      metadata: { ip, user_agent: hdrs.get("user-agent") ?? null, site_id: request.site_id },
    });
    await enqueueNotification({
      typeCode: "handover.viewed",
      refType: "site",
      refId: request.site_id,
      audience: { allActive: true },
      title: `${prefill.siteName ?? "A site"} opened their handover pack`,
      body: `Handover documentation viewed by ${request.recipient_email}`,
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
    <HandoverAcceptView
      token={token}
      status={request.status as "sent" | "viewed" | "signed"}
      siteName={prefill.siteName ?? ""}
      clientName={prefill.clientName ?? ""}
      dateDisplay={prefill.dateDisplay ?? ""}
      recipientName={request.recipient_name}
      signedAt={request.signed_at}
      signerName={request.signer_name}
    />
  );
}

function NotFoundView({ title, message }: { title: string; message: string }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif", padding: "16px" }}>
      <div style={{ background: "#ffffff", borderRadius: "16px", padding: "40px", maxWidth: "440px", width: "100%", textAlign: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#0f172a", margin: "0 0 8px" }}>{title}</h1>
        <p style={{ fontSize: "13px", color: "#475569", lineHeight: 1.6, margin: 0 }}>{message}</p>
      </div>
    </div>
  );
}
