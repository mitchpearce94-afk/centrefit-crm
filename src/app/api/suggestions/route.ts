import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendSuggestionEmail } from "@/lib/emails/suggestion";

const VALID_CATEGORIES = new Set(["Feature", "Bug", "UI/UX", "Other"]);

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let payload: { body?: string; category?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const body = (payload.body ?? "").trim();
  const category = (payload.category ?? "Other").trim();

  if (body.length < 3) {
    return NextResponse.json({ error: "Suggestion is too short" }, { status: 400 });
  }
  if (body.length > 5000) {
    return NextResponse.json({ error: "Suggestion is too long" }, { status: 400 });
  }
  if (!VALID_CATEGORIES.has(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const { data: staff } = await supabase
    .from("staff")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const fromName = staff?.display_name ?? user.email ?? "Unknown staff";
  const fromEmail = user.email ?? "noreply@centrefit.com.au";

  // Persist BEFORE sending so a Resend failure doesn't lose the suggestion.
  // The email_sent + email_error fields get patched after the send attempt.
  const { data: row, error: insertErr } = await supabase
    .from("staff_suggestions")
    .insert({
      staff_id: user.id,
      staff_name: fromName,
      staff_email: fromEmail,
      category,
      body,
    })
    .select("id")
    .single();
  if (insertErr) {
    // DB write failed — don't even try the email; surface the error so the
    // user sees something rather than silently swallowing.
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  const result = await sendSuggestionEmail({ fromName, fromEmail, category, body });

  // Best-effort patch the email outcome onto the row — failure here is
  // non-blocking (the row still exists, the email status just won't be
  // reflected).
  await supabase
    .from("staff_suggestions")
    .update({
      email_sent: result.ok,
      email_error: result.ok ? null : (result as { error: string }).error,
    })
    .eq("id", row.id);

  if (!result.ok) {
    // Suggestion is safe in the DB but Mitchell won't have got the email.
    // Surface the error so the user knows to ping him directly.
    return NextResponse.json(
      { error: `Saved, but email failed: ${result.error}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
