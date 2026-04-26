import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateScopeOfWorks } from "@/lib/quote-engine";
import { generateQuotePdfBuffer, type QuoteForPdf } from "@/lib/quote-pdf";

/**
 * GET /api/quotes/[id]/pdf — returns the full quote rendered as a PDF.
 *
 * Used by the CRM (download button) and re-used by the send-email route to
 * produce the same attachment customers receive.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const [quoteResult, lineItemsResult, productsResult, scopeRolesResult] = await Promise.all([
    supabase
      .from("quotes")
      .select("*, customer:customers(id, name)")
      .eq("id", id)
      .single(),
    supabase.from("quote_line_items").select("product_id, quantity").eq("quote_id", id),
    supabase.from("quote_products").select("id, scope_role, name, sku"),
    supabase.from("quote_scope_roles").select("slug, description"),
  ]);
  const roleDescriptions: Record<string, string> = {};
  for (const r of scopeRolesResult.data ?? []) {
    if (r.description && r.description.trim().length > 0) roleDescriptions[r.slug] = r.description.trim();
  }

  if (quoteResult.error || !quoteResult.data) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  const quote = quoteResult.data as Record<string, unknown> & {
    ref: string;
    created_at: string;
    customer?: { name: string } | null;
    client_name: string;
    site_name: string | null;
    site_address: string | null;
    quote_type: string | null;
    pricing_snapshot: {
      totalExGST: number;
      totalIncGST: number;
      gst: number;
      fullPriceExGST?: number;
      discount?: { percent: number; amount: number };
      pp1?: { total: number };
      pp2?: { total: number };
    } | null;
    scope_overrides: unknown;
  };

  const pricing = quote.pricing_snapshot;
  if (!pricing) {
    return NextResponse.json({ error: "Quote has no pricing snapshot" }, { status: 400 });
  }

  const siteInfo = {
    site_sqm: (quote.site_sqm as number | undefined) ?? 0,
    door_count: (quote.door_count as number | undefined) ?? 0,
    external_camera_count: (quote.external_camera_count as number | undefined) ?? 0,
    concrete_mount_black: (quote.concrete_mount_black as number | undefined) ?? 0,
    concrete_mount_white: (quote.concrete_mount_white as number | undefined) ?? 0,
    cardio_count: (quote.cardio_count as number | undefined) ?? 0,
    tv_count: (quote.tv_count as number | undefined) ?? 0,
    ceiling_tv_count: (quote.ceiling_tv_count as number | undefined) ?? 0,
    wall_tv_mount_count: (quote.wall_tv_mount_count as number | undefined) ?? 0,
    ceiling_tv_mount_count: (quote.ceiling_tv_mount_count as number | undefined) ?? 0,
    separate_studio_zone: (quote.separate_studio_zone as boolean | undefined) ?? false,
  };

  const scopeBom = (lineItemsResult.data ?? []).map((r) => ({
    product_id: r.product_id ?? null,
    quantity: Number(r.quantity) || 0,
  }));
  const scopeProducts = (productsResult.data ?? []) as Array<{ id: string; scope_role: string }>;

  const scope = generateScopeOfWorks(
    scopeBom,
    scopeProducts,
    siteInfo,
    (quote.scope_overrides as Parameters<typeof generateScopeOfWorks>[3]) ?? undefined,
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
