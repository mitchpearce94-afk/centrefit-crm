import { createClient as createServiceClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { generateScopeOfWorks, manualScopeDocument } from "@/lib/quote-engine";
import { formatAuAddress } from "@/lib/format-address";
import { logDocumentActivity, shouldLogView } from "@/lib/activity/log";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { ProposalView } from "./proposal-view";

export const dynamic = "force-dynamic";

// Tokened customer link — never let search engines index a live proposal.
export const metadata = { robots: { index: false, follow: false } };

interface PricingSnapshot {
  totalExGST: number;
  totalIncGST: number;
  gst: number;
  fullPriceExGST?: number;
  discount?: { percent: number; amount: number };
  pp1?: { total: number };
  pp2?: { total: number };
}

export default async function ProposalPage({
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
        message="This proposal link has expired or is invalid. Reply to the original email or contact CentreFit on (07) 3188 5115 if you need a fresh link."
      />
    );
  }

  const pricing = quote.pricing_snapshot as PricingSnapshot | null;
  if (!pricing) {
    return <NotFoundView title="Proposal unavailable" message="This proposal is missing pricing information. Please contact CentreFit." />;
  }

  // Same scope pipeline as the quote-response page and both PDF routes.
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
  const manualScopeText =
    quote.quote_mode === "manual"
      ? (quote.labour_data?.scope_of_works ?? "").trim()
      : "";
  const scope = manualScopeText
    ? manualScopeDocument(manualScopeText)
    : generateScopeOfWorks(bom, products, siteInfo, quote.scope_overrides ?? undefined, roleDescriptions);

  const clientName = quote.customer?.name || quote.client_name;
  const distinctSite =
    quote.site_name && quote.site_name.trim().toLowerCase() !== clientName.trim().toLowerCase()
      ? quote.site_name
      : null;

  // View logging shares the quote's `quote.viewed` event + 1-hour IP dedupe
  // with the plain quote page, so one customer open never notifies twice —
  // `surface` in metadata tells the timeline this open came via the proposal.
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? hdrs.get("x-real-ip") ?? "unknown";
  if (await shouldLogView(sb, "quote", quote.id, ip)) {
    await logDocumentActivity({
      supabase: sb,
      documentType: "quote",
      documentId: quote.id,
      eventType: "quote.viewed",
      actor: "recipient",
      metadata: { ip, user_agent: hdrs.get("user-agent") ?? null, surface: "proposal" },
    });
    await enqueueNotification({
      supabase: sb,
      typeCode: "quote.viewed",
      refType: "quote",
      refId: quote.id,
      audience: { allActive: true },
      title: `${clientName} opened proposal ${quote.ref}`,
      body: quote.site_name ? `${quote.site_name} — web proposal viewed` : "Web proposal viewed by customer",
      href: `/quoting/${quote.id}`,
    });
  }

  return (
    <ProposalView
      token={token}
      quoteId={quote.id}
      quoteRef={quote.ref}
      quoteStatus={quote.status}
      isProgress={quote.quote_type === "progress"}
      clientName={clientName}
      siteName={distinctSite}
      siteAddress={formatAuAddress(quote.site_address) || null}
      createdAt={quote.created_at}
      pricing={pricing}
      scope={scope}
    />
  );
}

function NotFoundView({ title, message }: { title: string; message: string }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0f172a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
        padding: "32px 16px",
      }}
    >
      <div style={{ maxWidth: "440px", textAlign: "center" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#ffffff", margin: "0 0 10px" }}>{title}</h1>
        <p style={{ fontSize: "14px", color: "#94a3b8", lineHeight: 1.6, margin: 0 }}>{message}</p>
      </div>
    </div>
  );
}
