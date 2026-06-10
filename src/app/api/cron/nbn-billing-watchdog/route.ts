import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { fetchProductsByStatus, fetchProductDetailCached, fetchEndUserByBizRefCached, type ActiveProduct } from "@/lib/kinetix/client";
import { getAuthedClient } from "@/lib/xero/client";
import { listRepeatingInvoices } from "@/lib/xero/repeating-invoices";
import { nameMatches, SERVICE_TESTS } from "@/lib/recurring/billing-match";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * Weekly NBN billing watchdog (Mon 7:30am AEST). Pulls every ACTIVE Kinetix
 * service (= a circuit Centrefit is paying for), resolves who it belongs to,
 * and checks a matching NBN line exists on an active CRM recurring plan or
 * an AUTHORISED Xero repeating invoice. Anything unmatched is revenue
 * leaking — bell+email the admins.
 *
 * Born from the 2026-06-11 audit that found ~$4.1k/mo of unbilled services.
 * Sentinel (monitoring) and M2M (SIMs) have no API — they stay on the
 * manual recon scripts until Mitchell sources API access.
 *
 * Auth: X-Cf-Cron-Secret must match CRON_SECRET (same as other crons).
 */

export const maxDuration = 300;

// Known personal/internal circuits — deliberately not billed. Reviewed by
// Mitchell 2026-06-11; amend here if any of these start billing.
const IGNORE_END_USERS = [
  /centrefit/i,
  /sue pearce/i,
  /mark pearce/i,
];

const CONCURRENCY = 8;

interface ServiceRow {
  productId: string;
  who: string;
  tech: string;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cf-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (provided !== secret) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const svc = createServiceRoleClient();

  // ── cost side: every active Kinetix service, resolved to an end-user name ──
  const products = await fetchProductsByStatus("active");
  const services: ServiceRow[] = [];
  const queue = [...products];
  const worker = async () => {
    while (queue.length > 0) {
      const p = queue.shift() as ActiveProduct;
      try {
        const detail = await fetchProductDetailCached(String(p.id));
        const bizRef = (detail.relatedParty as { id?: string } | undefined)?.id;
        let who = String(detail.customerRef ?? p.id);
        if (bizRef?.startsWith("BIZ")) {
          const eu = await fetchEndUserByBizRefCached(bizRef).catch(() => null);
          who = eu?.[0]?.tradingName ?? eu?.[0]?.name ?? who;
        }
        services.push({ productId: String(p.id), who, tech: String(detail.accessServiceTechnologyType ?? "") });
      } catch {
        services.push({ productId: String(p.id), who: String(p.id), tech: "" });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // ── billing side ───────────────────────────────────────────────────────────
  const { data: plans } = await svc
    .from("recurring_plans")
    .select("customers(name), customer_sites(name), recurring_plan_items(service_code, service_name)")
    .eq("status", "active");
  const planRecords = (plans ?? []).map((p) => {
    const customer = Array.isArray(p.customers) ? p.customers[0] : p.customers;
    const site = Array.isArray(p.customer_sites) ? p.customer_sites[0] : p.customer_sites;
    return {
      customer: customer?.name ?? "",
      site: site?.name ?? "",
      itemText: (p.recurring_plan_items ?? []).map((i) => `${i.service_code} ${i.service_name}`).join(" || "),
    };
  });

  let xeroRis: { contactName: string; lineText: string }[] = [];
  let xeroOk = true;
  try {
    const { client: xero, conn } = await getAuthedClient(svc);
    xeroRis = (await listRepeatingInvoices(xero, conn.tenant_id)).filter((r) => r.status === "AUTHORISED");
  } catch (err) {
    // Without Xero we can't tell DD-less-but-invoiced apart from unbilled —
    // report the failure rather than crying wolf on 100+ sites.
    console.error("[watchdog] Xero unavailable:", err);
    xeroOk = false;
  }
  if (!xeroOk) return NextResponse.json({ ok: false, reason: "xero_unavailable" }, { status: 502 });

  // ── match ──────────────────────────────────────────────────────────────────
  const nbnTest = SERVICE_TESTS.nbn;
  const unbilled: ServiceRow[] = [];
  for (const s of services) {
    if (IGNORE_END_USERS.some((re) => re.test(s.who))) continue;
    const viaPlan = planRecords.some(
      (p) => (nameMatches(s.who, p.site) || nameMatches(s.who, p.customer) || nameMatches(p.site, s.who)) && nbnTest(p.itemText),
    );
    if (viaPlan) continue;
    const viaXero = xeroRis.some(
      (r) => (nameMatches(s.who, r.contactName) || nameMatches(r.contactName, s.who)) && nbnTest(r.lineText),
    );
    if (!viaXero) unbilled.push(s);
  }

  if (unbilled.length > 0) {
    const sample = unbilled.slice(0, 8).map((s) => s.who).join(", ");
    await enqueueNotification({
      typeCode: "nbn.unbilled",
      refType: "invoice",
      refId: "nbn-billing-watchdog",
      audience: { role: "admin" },
      title: `${unbilled.length} NBN service${unbilled.length === 1 ? "" : "s"} unbilled — ~$${(unbilled.length * 139).toLocaleString()}/mo leaking`,
      body: `Active at Kinetix with no DD plan or authorised Xero invoice: ${sample}${unbilled.length > 8 ? ` +${unbilled.length - 8} more` : ""}.`,
      href: "/nbn/services",
    });
  }

  return NextResponse.json({
    ok: true,
    checked: services.length,
    unbilled: unbilled.length,
    names: unbilled.map((s) => s.who),
  });
}
