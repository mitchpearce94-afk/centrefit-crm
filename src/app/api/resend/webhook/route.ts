import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { logDocumentActivity } from "@/lib/activity/log";

/**
 * Resend webhook receiver. Resend signs each request with the Svix-style
 * scheme (also documented as svix-id, svix-timestamp, svix-signature). The
 * signing secret is stashed as RESEND_WEBHOOK_SECRET in Vercel.
 *
 * Subscribed events (configure in Resend dashboard):
 *   - email.delivered
 *   - email.bounced
 *   - email.opened
 *   - email.clicked
 *   - email.complained
 *
 * For activity logs we attach events to a document by reading custom
 * `headers.X-Cf-Doc-Type` / `headers.X-Cf-Doc-Id` values that the sending
 * code can attach when calling Resend. Today the staff-quote sender doesn't
 * yet pass those — staged in the next iteration. Without them we just log
 * to console for visibility.
 */

interface ResendEvent {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    from?: string;
    to?: string[];
    subject?: string;
    headers?: Array<{ name: string; value: string }>;
    [k: string]: unknown;
  };
}

function verifySvix(raw: string, headers: Headers, secret: string): boolean {
  // Svix signs as `v1,<base64sig>` over `${id}.${timestamp}.${body}` HMAC-SHA256
  // using the secret (without `whsec_` prefix). See Resend docs.
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const sigHeader = headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;

  // Allow plain `secret` or `whsec_secret` form.
  const decoded = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try { key = Buffer.from(decoded, "base64"); }
  catch { key = Buffer.from(decoded, "utf8"); }

  const signedContent = `${id}.${ts}.${raw}`;
  const expected = crypto.createHmac("sha256", key).update(signedContent).digest("base64");

  return sigHeader.split(" ").some((part) => {
    const [, sig] = part.split(",");
    if (!sig) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

function findHeader(event: ResendEvent, name: string): string | null {
  const lowered = name.toLowerCase();
  return event.data.headers?.find((h) => h.name.toLowerCase() === lowered)?.value ?? null;
}

const RESEND_TO_ACTIVITY: Record<string, string> = {
  "email.delivered": "email_delivered",
  "email.bounced": "email_bounced",
  "email.opened": "email_opened",
  "email.clicked": "email_clicked",
  "email.complained": "email_complained",
};

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[resend-webhook] RESEND_WEBHOOK_SECRET not set");
    return new NextResponse(null, { status: 500 });
  }

  const raw = await req.text();
  if (!verifySvix(raw, req.headers, secret)) {
    return new NextResponse(null, { status: 401 });
  }

  let event: ResendEvent;
  try { event = JSON.parse(raw); }
  catch { return new NextResponse(null, { status: 400 }); }

  const activitySuffix = RESEND_TO_ACTIVITY[event.type];
  if (!activitySuffix) return new NextResponse(null, { status: 200 });

  // Sender-supplied custom headers tell us which document to attach the
  // event to. Without them we can't link to a quote/invoice — log + bail.
  const docType = findHeader(event, "X-Cf-Doc-Type") as
    | "quote" | "invoice" | "recurring_plan" | null;
  const docId = findHeader(event, "X-Cf-Doc-Id");
  if (!docType || !docId) {
    return new NextResponse(null, { status: 200 });
  }

  const supabase = createServiceRoleClient();
  await logDocumentActivity({
    supabase,
    documentType: docType,
    documentId: docId,
    eventType: `${docType}.${activitySuffix}`,
    actor: activitySuffix === "email_delivered" || activitySuffix === "email_bounced" || activitySuffix === "email_complained"
      ? "system" : "recipient",
    metadata: {
      resend_email_id: event.data.email_id,
      to: event.data.to,
      subject: event.data.subject,
    },
  });

  return new NextResponse(null, { status: 200 });
}
