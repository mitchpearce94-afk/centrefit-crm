import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import crypto from "crypto";

interface Body {
  token: string;
  password: string;
}

/**
 * Completes a password reset started by /api/auth/forgot-password. Public
 * (the user isn't logged in) but safe: it only succeeds with a valid,
 * unexpired, unused token whose hash matches a row we minted. THIS is the
 * only place the password actually changes — submitting an email never does.
 */
export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const token = body.token?.trim();
  const password = body.password ?? "";
  if (!token) {
    return NextResponse.json({ error: "Missing reset token" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Server is missing configuration" }, { status: 500 });
  }
  const admin = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const { data: row } = await admin
    .from("password_reset_tokens")
    .select("id, user_id, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired. Request a new one." },
      { status: 400 },
    );
  }

  const { error: updErr } = await admin.auth.admin.updateUserById(row.user_id, {
    password,
    email_confirm: true,
  });
  if (updErr) {
    return NextResponse.json({ error: `Couldn't set the new password: ${updErr.message}` }, { status: 502 });
  }

  // Burn the token and clear any leftover forced-change flag.
  await admin.from("password_reset_tokens").update({ used_at: new Date().toISOString() }).eq("id", row.id);
  await admin.from("staff").update({ must_change_password: false }).eq("id", row.user_id);

  return NextResponse.json({ ok: true });
}
