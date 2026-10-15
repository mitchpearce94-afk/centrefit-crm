import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * POST /api/procurement-items/mark-invoiced — stamp stock allocations that
 * made it onto an invoice so the job's invoice builder doesn't add them
 * again (same job as /api/receipts/mark-invoiced).
 * Body: { ids: string[], invoiceId?: string }.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v))
    : [];
  if (ids.length === 0) return NextResponse.json({ ok: true, updated: 0 });
  const invoiceId = typeof body?.invoiceId === "string" && /^[0-9a-f-]{36}$/i.test(body.invoiceId) ? body.invoiceId : null;

  const svc = createServiceRoleClient();
  const { error } = await svc
    .from("job_procurement_items")
    .update({ invoiced_at: new Date().toISOString(), invoice_id: invoiceId, updated_at: new Date().toISOString() })
    .in("id", ids)
    .is("invoiced_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, updated: ids.length });
}
