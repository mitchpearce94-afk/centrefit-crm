import { NextRequest, NextResponse } from "next/server";
import { financeViewerOrNull } from "@/lib/finance/access";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { decideContact, refreshGcCustomers } from "@/lib/finance/contacts";

/**
 * Contacts worksheet actions (D5/D6):
 *   { action: "refresh" }                       — pull GC customers with a live mandate
 *   { action: "decide", gc_customer_id, xero_contact_id, canonical_name, site_id? }
 *   { action: "ignore", gc_customer_id }        — dormant mandate, nothing billed
 */
export async function POST(req: NextRequest) {
  const viewer = await financeViewerOrNull();
  if (!viewer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const svc = createServiceRoleClient();
  try {
    if (body.action === "refresh") {
      const r = await refreshGcCustomers(svc);
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.action === "decide" || body.action === "ignore") {
      const gc = String(body.gc_customer_id ?? "");
      if (!gc) return NextResponse.json({ error: "gc_customer_id required" }, { status: 400 });
      if (body.action === "ignore") {
        await decideContact(svc, { gc_customer_id: gc, xero_contact_id: null, canonical_name: String(body.canonical_name ?? ""), status: "ignored", actor: viewer.email });
        return NextResponse.json({ ok: true });
      }
      const xero = typeof body.xero_contact_id === "string" && body.xero_contact_id ? body.xero_contact_id : null;
      const canonical = String(body.canonical_name ?? "").trim();
      if (!xero || !canonical) return NextResponse.json({ error: "xero_contact_id and canonical_name required" }, { status: 400 });
      await decideContact(svc, { gc_customer_id: gc, xero_contact_id: xero, canonical_name: canonical, site_id: typeof body.site_id === "string" ? body.site_id : null, actor: viewer.email });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
