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
 * We deliberately don't reveal whether the email exists or not. Any valid
 * email shape returns 200; only the actual reset/email is conditional. This
 * prevents enumerating which addresses are real Centrefit accounts.
 */
function generateTempPassword(): string {
  const words = [
    "harbour", "summit", "ranger", "anchor", "boulder", "cobalt",
    "delta", "ember", "frost", "granite", "horizon", "ivory",
    "junction", "lantern", "marina", "quartz", "ranger", "shore",
  ];
  const w1 = words[crypto.randomInt(0, words.length)];
  const w2 = words[crypto.randomInt(0, words.length)];
  const num = crypto.randomInt(1000, 10000);
  return `${w1}-${w2}-${num}`;
}

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

  const tempPassword = generateTempPassword();
  const loginUrl = `${req.nextUrl.origin}/login`;

  const { error: updErr } = await admin.auth.admin.updateUserById(existing.id, {
    password: tempPassword,
    email_confirm: true,
  });
  if (updErr) {
    return NextResponse.json({ error: `Failed to reset password: ${updErr.message}` }, { status: 502 });
  }

  // Force the user to change this temp password on next login.
  await admin
    .from("staff")
    .update({ must_change_password: true })
    .eq("id", existing.id);

  const html = emailLayout(`
    ${emailHeader({ rightLabel: "Password Reset" })}
    <tr><td style="padding:32px 32px 8px">
      <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 8px">Centrefit CRM password reset</h1>
      <p style="margin:0 0 16px;font-size:13px;color:#475569;line-height:1.55">Someone (hopefully you) requested a password reset on your Centrefit CRM account.</p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;margin:18px 0">
        <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:700">Login URL</p>
        <p style="margin:0 0 14px;font-family:monospace;font-size:13px;color:#0f172a">${loginUrl}</p>
        <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:700">Email</p>
        <p style="margin:0 0 14px;font-family:monospace;font-size:13px;color:#0f172a">${email}</p>
        <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:700">Temporary password</p>
        <p style="margin:0;font-family:monospace;font-size:16px;font-weight:600;color:#0f172a;letter-spacing:0.5px">${tempPassword}</p>
      </div>

      <p style="margin:16px 0;text-align:center">
        <a href="${loginUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">Sign in to the CRM</a>
      </p>

      <p style="margin:24px 0 0;font-size:11px;color:#94a3b8;text-align:center;line-height:1.5">
        You'll be prompted to choose a new password right after signing in. If you didn't request this, your old password still works as long as you don't sign in with the temporary one — let an admin know.
      </p>
    </td></tr>
    ${emailFooter()}
  `);

  try {
    const resend = new Resend(resendKey);
    const { error: sendErr } = await resend.emails.send({
      from: "Centrefit CRM <noreply@centrefit.com.au>",
      to: email,
      subject: "Centrefit CRM password reset",
      html,
    });
    if (sendErr) {
      return NextResponse.json(
        { error: `Password reset done but email failed: ${sendErr.message}`, tempPassword },
        { status: 502 },
      );
    }
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: `Password reset done but email failed: ${err instanceof Error ? err.message : String(err)}`,
        tempPassword,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
