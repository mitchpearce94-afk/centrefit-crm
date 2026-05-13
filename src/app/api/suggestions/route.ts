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

  const result = await sendSuggestionEmail({ fromName, fromEmail, category, body });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
