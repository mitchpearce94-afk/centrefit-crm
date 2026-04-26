import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Staff id required" }, { status: 400 });
  }

  // Caller must be an authenticated admin
  const supabase = await createClient();
  const {
    data: { user: caller },
  } = await supabase.auth.getUser();
  if (!caller) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: callerStaff } = await supabase
    .from("staff")
    .select("role")
    .eq("id", caller.id)
    .single();
  if (callerStaff?.role !== "admin") {
    return NextResponse.json({ error: "Only admins can delete staff" }, { status: 403 });
  }

  if (id === caller.id) {
    return NextResponse.json(
      { error: "You can't delete your own account" },
      { status: 400 },
    );
  }

  // Block deleting the last remaining admin
  const { data: target } = await supabase
    .from("staff")
    .select("role, display_name")
    .eq("id", id)
    .single();
  if (!target) {
    return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  }
  if (target.role === "admin") {
    const { count } = await supabase
      .from("staff")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("is_active", true);
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "Can't delete the last active admin" },
        { status: 400 },
      );
    }
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 },
    );
  }
  const admin = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Deleting the auth.users row cascades into public.staff via the FK on
  // staff.id → auth.users.id. If the auth row isn't there (orphan), fall
  // back to deleting just the staff row.
  const { error: authErr } = await admin.auth.admin.deleteUser(id);
  if (authErr && !/not found|user not found/i.test(authErr.message)) {
    return NextResponse.json(
      { error: `Failed to delete auth user: ${authErr.message}` },
      { status: 502 },
    );
  }

  // Defensive: ensure the staff row is gone (in case the FK cascade didn't run)
  await admin.from("staff").delete().eq("id", id);

  return NextResponse.json({ ok: true, deleted: target.display_name });
}
