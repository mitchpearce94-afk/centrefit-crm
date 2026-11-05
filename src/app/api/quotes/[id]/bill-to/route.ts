import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { parseBillTo } from "@/lib/invoices/bill-to";

/**
 * PATCH /api/quotes/[id]/bill-to — who the invoices for this quote go to
 * (docs/job-lifecycle-CONTEXT.md D2). The automatic PP1 on acceptance and
 * the automatic PP2 on Ready to Invoice read this, so it has to be set
 * BEFORE the customer accepts when the builder is paying.
 *
 * Body: { billTo: "owner" | "builder" }
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: quoteId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: staffRow } = await supabase.from("staff").select("is_active").eq("id", user.id).maybeSingle();
  if (!staffRow?.is_active) return NextResponse.json({ error: "Staff only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (body?.billTo !== "owner" && body?.billTo !== "builder") {
    return NextResponse.json({ error: "billTo must be owner or builder" }, { status: 400 });
  }
  const billTo = parseBillTo(body.billTo);

  const svc = createServiceRoleClient();
  const { data: quote } = await svc
    .from("quotes")
    .select("id, site_id")
    .eq("id", quoteId)
    .maybeSingle();
  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

  if (billTo === "builder") {
    if (!quote.site_id) {
      return NextResponse.json({ error: "This quote has no site — link a site before billing a builder" }, { status: 400 });
    }
    const { count } = await svc.from("site_builders").select("id", { count: "exact", head: true }).eq("site_id", quote.site_id);
    if ((count ?? 0) === 0) {
      return NextResponse.json({ error: "The site has no builder on file — add one on the site's Builder tab first" }, { status: 400 });
    }
  }

  const { error } = await svc.from("quotes").update({ bill_to_party: billTo }).eq("id", quoteId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, billTo });
}
