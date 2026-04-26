import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { generateScopeOfWorks } from "@/lib/quote-engine";
import { generateQuotePdfBuffer, type QuoteForPdf } from "@/lib/quote-pdf";

/**
 * Public PDF endpoint for the customer-facing quote-response page. The
 * response_token in the URL acts as the access-control token — anyone
 * holding the link the customer received in their email can fetch the PDF,
 * but no internal quote IDs are exposed.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const sb = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: quote } = await sb
    .from("quotes")
    .select("*, customer:customers(id, name)")
    .eq("response_token", token)
    .maybeSingle();

  if (!quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  const pricing = quote.pricing_snapshot as {
    totalExGST: number;
    totalIncGST: number;
    gst: number;
    fullPriceExGST?: number;
    discount?: { percent: number; amount: number };
    pp1?: { total: number };
    pp2?: { total: number };
  } | null;
  if (!pricing) {
    return NextResponse.json({ error: "Quote has no pricing snapshot" }, { status: 400 });
  }

  const siteInfo = {
    site_sqm: quote.site_sqm ?? 0,
    door_count: quote.door_count ?? 0,
    external_camera_count: quote.external_camera_count ?? 0,
    concrete_mount_black: quote.concrete_mount_black ?? 0,
    concrete_mount_white: quote.concrete_mount_white ?? 0,
    cardio_count: quote.cardio_count ?? 0,
    tv_count: quote.tv_count ?? 0,
    ceiling_tv_count: quote.ceiling_tv_count ?? 0,
    wall_tv_mount_count: quote.wall_tv_mount_count ?? 0,
    ceiling_tv_mount_count: quote.ceiling_tv_mount_count ?? 0,
    separate_studio_zone: quote.separate_studio_zone ?? false,
  };

  const [{ data: bomRows }, { data: productRows }, { data: scopeRoleRows }] = await Promise.all([
    sb.from("quote_line_items").select("product_id, quantity").eq("quote_id", quote.id),
    sb.from("quote_products").select("id, scope_role, name, sku"),
    sb.from("quote_scope_roles").select("slug, description"),
  ]);
  const scopeBom = (bomRows ?? []).map((r) => ({
    product_id: r.product_id ?? null,
    quantity: Number(r.quantity) || 0,
  }));
  const scopeProducts = (productRows ?? []) as Array<{ id: string; scope_role: string }>;
  const roleDescriptions: Record<string, string> = {};
  for (const r of scopeRoleRows ?? []) {
    if (r.description && r.description.trim().length > 0) roleDescriptions[r.slug] = r.description.trim();
  }

  const scope = generateScopeOfWorks(
    scopeBom,
    scopeProducts,
    siteInfo,
    quote.scope_overrides ?? undefined,
    roleDescriptions,
  );

  const quoteForPdf: QuoteForPdf = {
    ref: quote.ref,
    createdAt: quote.created_at,
    clientName: quote.customer?.name ?? quote.client_name,
    siteName: quote.site_name,
    siteAddress: quote.site_address,
    isProgress: quote.quote_type === "progress",
    pricing,
  };

  const pdf = await generateQuotePdfBuffer(quoteForPdf, scope);

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${quote.ref}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
