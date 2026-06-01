import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import crypto from "crypto";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";

interface Body {
  email: string;
}

/**
 * Public endpoint — no auth required (the user can't log in, that's the point).
 *
 * Hardened 2026-06-01 (audit). The old version called updateUserById() the
 * instant any email was submitted, which (a) instantly invalidated the
 * victim's current password — an unauthenticated lockout DoS — and (b) had
 * no rate limiting, so it was repeatable at will.
 *
 * New flow: mint a single-use, 1-hour token, store only its SHA-256 hash, and
 * email a reset LINK. The password is NOT changed here. It only changes when
 * the user clicks the link and chooses a new password (see
 * /api/auth/reset-password/complete). We still never reveal whether the email
 * exists, and we rate-limit per email to stop reset-email spam.
 */

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const RESEND_COOLDOWN_MS = 5 * 60 * 1000; // one reset email per address per 5 min

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!serviceKey || !resendKey) {
    return NextResponse.json({ error: "Server is missing email configuration" }, { status: 500 });
  }

  const admin = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: pageData } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = pageData?.users.find((u) => u.email?.toLowerCase() === email);

  // Always respond OK to avoid leaking which emails are real users.
  if (!existing) {
    return NextResponse.json({ ok: true });
  }

  // Rate limit: if we already sent a reset link to this address very recently,
  // silently succeed without sending another. Stops reset-email spam/abuse.
  const cooldownSince = new Date(Date.now() - RESEND_COOLDOWN_MS).toISOString();
  const { data: recent } = await admin
    .from("password_reset_tokens")
    .select("id")
    .eq("email", email)
    .gte("created_at", cooldownSince)
    .limit(1);
  if (recent && recent.length > 0) {
    return NextResponse.json({ ok: true });
  }

  // Mint a single-use token; store only its hash.
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  const { error: insErr } = await admin.from("password_reset_tokens").insert({
    user_id: existing.id,
    email,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });
  if (insErr) {
    return NextResponse.json({ error: `Failed to start reset: ${insErr.message}` }, { status: 502 });
  }

  const resetUrl = `${req.nextUrl.origin}/reset-password?token=${rawToken}`;

  const html = emailLayout(`
    ${emailHeader({ rightLabel: "Password Reset" })}
    <tr><td style="padding:32px 32px 8px">
      <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 8px">Reset your Centrefit CRM password</h1>
      <p style="margin:0 0 16px;font-size:13px;color:#475569;line-height:1.55">Someone (hopefully you) requested a password reset on your Centrefit CRM account. Click the button below to choose a new password. This link expires in 1 hour and can only be used once.</p>

      <p style="margin:24px 0;text-align:center">
        <a href="${resetUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">Choose a new password</a>
      </p>

      <p style="margin:16px 0 0;font-size:12px;color:#64748b;line-height:1.55">If the button doesn't work, copy this link into your browser:</p>
      <p style="margin:4px 0 0;font-family:monospace;font-size:12px;color:#0f172a;word-break:break-all">${resetUrl}</p>

      <p style="margin:24px 0 0;font-size:11px;color:#94a3b8;text-align:center;line-height:1.5">
        If you didn't request this, you can safely ignore this email — your current password has NOT been changed and will keep working. Nothing happens until the link above is used.
      </p>
    </td></tr>
    ${emailFooter()}
  `);

  try {
    const resend = new Resend(resendKey);
    const { error: sendErr } = await resend.emails.send({
      from: "Centrefit CRM <noreply@centrefit.com.au>",
      to: email,
      subject: "Reset your Centrefit CRM password",
      html,
    });
    if (sendErr) {
      return NextResponse.json(
        { error: `Couldn't send the reset email: ${sendErr.message}` },
        { status: 502 },
      );
    }
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `Couldn't send the reset email: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
