import type { SupabaseClient } from "@supabase/supabase-js";
import { generateScopeOfWorks, renderScopeAsText } from "@/lib/quote-engine";

function formatAud(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Mirror the quote's full Scope of Works + payment-terms block into the
 * linked job's description. Quote is the source of truth for scope — we
 * overwrite on every call so the job stays in sync.
 *
 * Called from both `/api/quotes/send` (on send) and `/api/quotes/respond`
 * (on accept) so a quote sent before this sync existed still backfills
 * when the customer accepts. No-op if the quote has no linked job.
 */
export async function syncQuoteScopeToJob(
  supabase: SupabaseClient,
  quoteId: string,
): Promise<void> {
  const { data: quote } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", quoteId)
    .single();
  if (!quote || !quote.job_id) return;

  const pricing = quote.pricing_snapshot as
    | { totalExGST: number; pp1?: { total: number }; pp2?: { total: number } }
    | null;
  if (!pricing) return;

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

  const [{ data: bomRows }, { data: productRows }, { data: roleRows }] = await Promise.all([
    supabase.from("quote_line_items").select("product_id, quantity").eq("quote_id", quoteId),
    supabase.from("quote_products").select("id, scope_role, name, sku"),
    supabase.from("quote_scope_roles").select("slug, description"),
  ]);

  const bom = (bomRows ?? []).map((r: { product_id: string | null; quantity: number }) => ({
    product_id: r.product_id ?? null,
    quantity: Number(r.quantity) || 0,
  }));
  const products = (productRows ?? []) as Array<{ id: string; scope_role: string }>;
  const roleDescriptions: Record<string, string> = {};
  for (const r of roleRows ?? []) {
    if (r.description && r.description.trim().length > 0) {
      roleDescriptions[r.slug] = r.description.trim();
    }
  }

  const scope = generateScopeOfWorks(
    bom,
    products,
    siteInfo,
    quote.scope_overrides ?? undefined,
    roleDescriptions,
  );
  const scopeText = renderScopeAsText(scope);

  const isProgress = quote.quote_type === "progress";
  const paymentLines: string[] = ["PAYMENT TERMS"];
  if (isProgress && pricing.pp1 && pricing.pp2) {
    paymentLines.push(
      `  • Progress Payment 1 (PP1) — On acceptance: $${formatAud(pricing.pp1.total)} ex GST`,
    );
    paymentLines.push(
      `  • Progress Payment 2 (PP2) — On completion: $${formatAud(pricing.pp2.total)} ex GST`,
    );
  } else {
    paymentLines.push(
      `  • Full payment on completion: $${formatAud(pricing.totalExGST)} ex GST`,
    );
  }

  const jobDescription = `${scopeText}\n\n${paymentLines.join("\n")}`;

  await supabase.from("jobs").update({ description: jobDescription }).eq("id", quote.job_id);
}
