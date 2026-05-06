import { createClient as createServiceClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { generateScopeOfWorks } from "@/lib/quote-engine";
import { logDocumentActivity, shouldLogView } from "@/lib/activity/log";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { QuoteResponseView } from "./response-view";

export const dynamic = "force-dynamic";

interface PricingSnapshot {
  totalExGST: number;
  totalIncGST: number;
  gst: number;
  fullPriceExGST?: number;
  discount?: { percent: number; amount: number };
  pp1?: { total: number };
  pp2?: { total: number };
}

export default async function QuoteResponsePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return <NotFoundView title="Server is misconfigured" message="Please contact CentreFit." />;
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
    return (
      <NotFoundView
        title="Link not found"
        message="This quote link has expired or is invalid. Reply to the original email or contact CentreFit on (07) 3188 5115 if you need a fresh link."
      />
    );
  }

  const pricing = quote.pricing_snapshot as PricingSnapshot | null;
  if (!pricing) {
    return <NotFoundView title="Quote unavailable" message="This quote is missing pricing information. Please contact CentreFit." />;
  }

  // Build scope so we can render the same system summary the customer saw in
  // the email PDF.
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
  const bom = (bomRows ?? []).map((r) => ({
    product_id: r.product_id ?? null,
    quantity: Number(r.quantity) || 0,
  }));
  const products = (productRows ?? []) as Array<{ id: string; scope_role: string }>;
  const roleDescriptions: Record<string, string> = {};
  for (const r of scopeRoleRows ?? []) {
    if (r.description && r.description.trim().length > 0) roleDescriptions[r.slug] = r.description.trim();
  }
  const scope = generateScopeOfWorks(bom, products, siteInfo, quote.scope_overrides ?? undefined, roleDescriptions);

  const clientName = quote.customer?.name || quote.client_name;

  // Log a 'viewed' event on the timeline, deduped by IP within 1 hour so
  // a customer scrolling/refreshing the page doesn't flood the log.
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? hdrs.get("x-real-ip") ?? "unknown";
  if (await shouldLogView(sb, "quote", quote.id, ip)) {
    await logDocumentActivity({
      supabase: sb,
      documentType: "quote",
      documentId: quote.id,
      eventType: "quote.viewed",
      actor: "recipient",
      metadata: { ip, user_agent: hdrs.get("user-agent") ?? null },
    });
    // Notify subscribed staff that the customer just opened the quote.
    // shouldLogView dedupes within 1 hour so opens-and-refreshes don't
    // spam the bell.
    await enqueueNotification({
      supabase: sb,
      typeCode: "quote.viewed",
      refType: "quote",
      refId: quote.id,
      audience: { allActive: true },
      title: `${clientName} opened ${quote.ref}`,
      body: quote.site_name ? `${quote.site_name} — quote viewed` : "Quote viewed by customer",
      href: `/quoting/${quote.id}`,
    });
  }

  return (
    <QuoteResponseView
      token={token}
      quoteId={quote.id}
      quoteRef={quote.ref}
      quoteStatus={quote.status}
      isProgress={quote.quote_type === "progress"}
      clientName={clientName}
      siteName={quote.site_name}
      siteAddress={quote.site_address}
      createdAt={quote.created_at}
      pricing={pricing}
      scope={scope}
    />
  );
}

function NotFoundView({ title, message }: { title: string; message: string }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif", padding: "16px" }}>
      <div style={{ background: "#ffffff", borderRadius: "16px", padding: "40px", maxWidth: "440px", width: "100%", textAlign: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
        <div style={{ width: "56px", height: "56px", borderRadius: "50%", background: "#fef2f2", margin: "0 auto 18px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
        </div>
        <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#0f172a", margin: "0 0 8px" }}>{title}</h1>
        <p style={{ fontSize: "13px", color: "#475569", lineHeight: 1.6, margin: 0 }}>{message}</p>
      </div>
    </div>
  );
}
