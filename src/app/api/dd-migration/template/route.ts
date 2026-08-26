import { NextRequest, NextResponse } from "next/server";
import { currentUserHasPermission } from "@/lib/auth/permissions";
import { getCurrentStaff } from "@/lib/auth/current-staff";
import { createServiceRoleClient } from "@/lib/supabase/service";

/** GET/PUT /api/dd-migration/template — the singleton invitation email template. */
export async function GET() {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const svc = createServiceRoleClient();
  const { data } = await svc
    .from("dd_migration_settings")
    .select("email_subject, email_body, updated_at")
    .limit(1)
    .maybeSingle();
  return NextResponse.json(data ?? { email_subject: "", email_body: "" });
}

export async function PUT(req: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await currentUserHasPermission("invoices.manage_recurring"))) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { email_subject?: string; email_body?: string };
  const subject = (body.email_subject ?? "").trim().slice(0, 200);
  const text = (body.email_body ?? "").trim().slice(0, 6000);
  if (!subject || !text) {
    return NextResponse.json({ error: "Subject and body are both required" }, { status: 400 });
  }
  if (!text.includes("{{signup_link}}")) {
    return NextResponse.json({ error: "The body must include {{signup_link}} or the customer has nothing to click" }, { status: 400 });
  }

  const svc = createServiceRoleClient();
  const { data: existing } = await svc.from("dd_migration_settings").select("id").limit(1).maybeSingle();
  const patch = { email_subject: subject, email_body: text, updated_at: new Date().toISOString(), updated_by: staff.id };
  const { error } = existing
    ? await svc.from("dd_migration_settings").update(patch).eq("id", existing.id)
    : await svc.from("dd_migration_settings").insert(patch);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
