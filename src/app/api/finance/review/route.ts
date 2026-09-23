import { NextRequest, NextResponse } from "next/server";
import { financeViewerOrNull } from "@/lib/finance/access";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { audit } from "@/lib/finance/audit";
import { decideContact } from "@/lib/finance/contacts";

/**
 * Review queue resolutions (D7). Every resolution teaches the mapping.
 *   { id, action: "dismiss", note? }
 *   { id, action: "link_invoice", invoice_id }      — pay THIS invoice with the payment
 *   { id, action: "link_contact", xero_contact_id, canonical_name, site_id? } — the customer's contact
 *   { id, action: "skip_payment", note }           — leave it unposted (e.g. refund coming)
 */
export async function POST(req: NextRequest) {
  const viewer = await financeViewerOrNull();
  if (!viewer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const svc = createServiceRoleClient();
  const { data: item } = await svc.from("finance_review_items").select("*").eq("id", id).maybeSingle();
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const now = new Date().toISOString();
  try {
    if (body.action === "dismiss") {
      await svc.from("finance_review_items").update({ status: "dismissed", resolution: { by: viewer.email, note: body.note ?? null }, resolved_by: viewer.userId, resolved_at: now }).eq("id", id);
      await audit(svc, { actor: viewer.email, action: "review.dismissed", entity: "finance_review_items", entityId: id, after: { note: body.note ?? null }, rule: "D7" });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "skip_payment" && item.payout_item_id) {
      await svc.from("finance_payout_items").update({ match_status: "skipped", match_note: `skipped by ${viewer.email}: ${String(body.note ?? "")}`, resolved_by: viewer.userId, resolved_at: now }).eq("id", item.payout_item_id);
      await svc.from("finance_review_items").update({ status: "resolved", resolution: { by: viewer.email, action: "skip_payment", note: body.note ?? null }, resolved_by: viewer.userId, resolved_at: now }).eq("id", id);
      await audit(svc, { actor: viewer.email, action: "payment.skipped", entity: "finance_payout_items", entityId: item.payout_item_id, after: { note: body.note ?? null }, rule: "D7" });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "link_invoice" && item.payout_item_id) {
      const invoiceId = String(body.invoice_id ?? "");
      const { data: inv } = await svc.from("finance_xero_invoices").select("invoice_id, invoice_number, contact_id, contact_name, total, status").eq("invoice_id", invoiceId).maybeSingle();
      if (!inv) return NextResponse.json({ error: "Invoice not in the mirror" }, { status: 400 });
      await svc.from("finance_payout_items").update({ match_status: inv.status === "PAID" ? "already_paid" : "matched_manual", match_note: `linked by ${viewer.email} to ${inv.invoice_number}`, xero_invoice_id: inv.invoice_id, invoice_number: inv.invoice_number, invoice_ids: [inv.invoice_id], xero_contact_id: inv.contact_id, xero_contact_name: inv.contact_name, resolved_by: viewer.userId, resolved_at: now }).eq("id", item.payout_item_id);
      await svc.from("finance_review_items").update({ status: "resolved", resolution: { by: viewer.email, action: "link_invoice", invoice_id: inv.invoice_id, invoice_number: inv.invoice_number }, resolved_by: viewer.userId, resolved_at: now }).eq("id", id);
      await audit(svc, { actor: viewer.email, action: "payment.linked_invoice", entity: "finance_payout_items", entityId: item.payout_item_id, after: { invoice: inv.invoice_number, contact: inv.contact_name }, rule: "D7" });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "link_contact") {
      const gc = String(item.gc_customer_id ?? body.gc_customer_id ?? "");
      const xero = String(body.xero_contact_id ?? "");
      const canonical = String(body.canonical_name ?? "").trim();
      if (!gc || !xero || !canonical) return NextResponse.json({ error: "gc customer, xero contact and canonical name required" }, { status: 400 });
      await decideContact(svc, { gc_customer_id: gc, xero_contact_id: xero, canonical_name: canonical, site_id: typeof body.site_id === "string" ? body.site_id : null, actor: viewer.email });
      await svc.from("finance_review_items").update({ status: "resolved", resolution: { by: viewer.email, action: "link_contact", xero_contact_id: xero }, resolved_by: viewer.userId, resolved_at: now }).eq("id", id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
