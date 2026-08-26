import { NextRequest, NextResponse } from "next/server";
import { currentUserHasPermission } from "@/lib/auth/permissions";
import { getCurrentStaff } from "@/lib/auth/current-staff";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { reconcileDdTargets } from "@/lib/recurring/dd-migration";

/**
 * PATCH /api/dd-migration/targets/[id] — campaign bookkeeping on one target:
 *   { status: "todo" | "declined" | "excluded", status_reason?, invoice_only? }
 *   { contact_email }      { notes }      { site_id }
 * Service-role writes after an explicit permission check (the page is gated
 * on invoices.manage_recurring; RLS on the table mirrors it).
 */
const MANUAL_STATUSES = new Set(["todo", "declined", "excluded"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await currentUserHasPermission("invoices.manage_recurring"))) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const svc = createServiceRoleClient();
  const { data: target } = await svc
    .from("dd_migration_targets")
    .select("id, status, site_id, contact_email")
    .eq("id", id)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "Target not found" }, { status: 404 });

  const patch: Record<string, unknown> = {};
  const touches: string[] = [];

  if (typeof body.status === "string") {
    if (!MANUAL_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "Status can only be set to todo, declined or excluded here" }, { status: 400 });
    }
    patch.status = body.status;
    patch.status_reason =
      typeof body.status_reason === "string" ? body.status_reason.trim().slice(0, 300) || null : null;
    touches.push(`Status → ${body.status}${patch.status_reason ? ` (${patch.status_reason})` : ""}`);
  }
  if (typeof body.contact_email === "string" || body.contact_email === null) {
    const email = typeof body.contact_email === "string" ? body.contact_email.trim().toLowerCase() : "";
    if (email && !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "That doesn't look like an email address" }, { status: 400 });
    }
    patch.contact_email = email || null;
    touches.push(`Contact email set to ${email || "(none)"}`);
  }
  if (typeof body.notes === "string") {
    patch.notes = body.notes.trim().slice(0, 2000) || null;
  }
  if (typeof body.site_id === "string" && body.site_id) {
    const { data: site } = await svc
      .from("customer_sites")
      .select("id, name, customer_id, billing_email, email, customers(billing_email)")
      .eq("id", body.site_id)
      .maybeSingle();
    if (!site) return NextResponse.json({ error: "Site not found" }, { status: 404 });
    patch.site_id = site.id;
    patch.customer_id = site.customer_id;
    if (!target.contact_email) {
      const cust = Array.isArray(site.customers) ? site.customers[0] : site.customers;
      patch.contact_email = site.billing_email || cust?.billing_email || site.email || null;
    }
    touches.push(`Linked to site ${site.name}`);
  }
  // Invoice-only is a property of the SITE (Total Fusion rule) — flipping it
  // here keeps the tracker and the site in step, and the next sync honours it.
  if (typeof body.invoice_only === "boolean") {
    const siteId = (patch.site_id as string | undefined) ?? target.site_id;
    if (siteId) {
      await svc.from("customer_sites").update({ invoice_only: body.invoice_only }).eq("id", siteId);
      touches.push(body.invoice_only ? "Site flagged invoice-only" : "Site invoice-only flag cleared");
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await svc.from("dd_migration_targets").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (touches.length) {
    await svc.from("dd_migration_touches").insert({
      target_id: id,
      staff_id: staff.id,
      channel: "system",
      note: touches.join(" · "),
    });
  }
  // A newly linked site may already have a plan — pick that up straight away.
  if (patch.site_id) await reconcileDdTargets(svc, [id]);

  return NextResponse.json({ ok: true });
}
