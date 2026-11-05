import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Builders tendering on a quote (docs/job-lifecycle-CONTEXT.md D10).
 *
 * POST   { siteBuilderId }   — add a site builder to the tender (idempotent)
 * DELETE { siteBuilderId }   — take them off (only while they haven't responded)
 *
 * Adding the first builder flips the quote to bill the builder; removing the
 * last one flips it back to the owner. Sending the links is the send route.
 */
async function staffClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: staffRow } = await supabase.from("staff").select("is_active").eq("id", user.id).maybeSingle();
  if (!staffRow?.is_active) return { error: NextResponse.json({ error: "Staff only" }, { status: 403 }) };
  return { svc: createServiceRoleClient() };
}

async function loadQuote(svc: ReturnType<typeof createServiceRoleClient>, quoteId: string) {
  const { data } = await svc.from("quotes").select("id, site_id, status, accepted_builder_id").eq("id", quoteId).maybeSingle();
  return data;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: quoteId } = await params;
  const auth = await staffClient();
  if ("error" in auth) return auth.error;
  const { svc } = auth;

  const body = await req.json().catch(() => ({}));
  const siteBuilderId = String(body?.siteBuilderId ?? "");
  if (!siteBuilderId) return NextResponse.json({ error: "siteBuilderId is required" }, { status: 400 });

  const quote = await loadQuote(svc, quoteId);
  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  if (quote.status === "accepted" || quote.status === "declined") {
    return NextResponse.json({ error: `Quote is already ${quote.status}` }, { status: 409 });
  }
  if (!quote.site_id) return NextResponse.json({ error: "Link a site to the quote first" }, { status: 400 });
  const { data: builder } = await svc.from("site_builders").select("id").eq("id", siteBuilderId).eq("site_id", quote.site_id).maybeSingle();
  if (!builder) return NextResponse.json({ error: "That builder isn't on this quote's site" }, { status: 400 });

  const { error } = await svc
    .from("quote_builders")
    .upsert({ quote_id: quoteId, site_builder_id: siteBuilderId }, { onConflict: "quote_id,site_builder_id", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await svc.from("quotes").update({ bill_to_party: "builder" }).eq("id", quoteId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: quoteId } = await params;
  const auth = await staffClient();
  if ("error" in auth) return auth.error;
  const { svc } = auth;

  const body = await req.json().catch(() => ({}));
  const siteBuilderId = String(body?.siteBuilderId ?? "");
  if (!siteBuilderId) return NextResponse.json({ error: "siteBuilderId is required" }, { status: 400 });

  const quote = await loadQuote(svc, quoteId);
  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  if (quote.accepted_builder_id === siteBuilderId) {
    return NextResponse.json({ error: "This builder accepted the quote — it can't be removed" }, { status: 409 });
  }
  const { data: row } = await svc.from("quote_builders").select("id, status").eq("quote_id", quoteId).eq("site_builder_id", siteBuilderId).maybeSingle();
  if (!row) return NextResponse.json({ ok: true, unchanged: true });
  if (row.status === "accepted") return NextResponse.json({ error: "This builder accepted the quote" }, { status: 409 });

  const { error } = await svc.from("quote_builders").delete().eq("id", row.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { count } = await svc.from("quote_builders").select("id", { count: "exact", head: true }).eq("quote_id", quoteId);
  if ((count ?? 0) === 0) await svc.from("quotes").update({ bill_to_party: "owner" }).eq("id", quoteId);
  return NextResponse.json({ ok: true, remaining: count ?? 0 });
}
