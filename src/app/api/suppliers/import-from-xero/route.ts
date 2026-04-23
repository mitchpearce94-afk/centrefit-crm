import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/xero/client";

/**
 * Pull supplier contacts from Xero and populate the CRM's suppliers table.
 *
 * Query params:
 *   dryRun=1        → preview only, don't write anything
 *   createNew=1     → also create CRM rows for Xero suppliers with no match
 *                     (default OFF — most Xero orgs have hundreds of
 *                     supplier contacts we don't want to pollute the CRM with)
 *
 * Matching strategy (per Xero contact that is marked IsSupplier):
 *   1. Already linked? (suppliers.xero_contact_id == contact.contactID) → update
 *   2. Name match (case-insensitive) with any supplier where xero_contact_id
 *      is null → link + backfill missing fields (don't overwrite non-null CRM
 *      values, since Mitchell may have typed a better number already)
 *   3. Otherwise → create new supplier
 *
 * Returns per-action summary so the UI can preview before confirming.
 */

interface XeroContactPhone {
  phoneType?: string;
  phoneNumber?: string;
}
interface XeroContactAddress {
  addressType?: string;
  addressLine1?: string;
  city?: string;
  region?: string;
  postalCode?: string;
}
interface XeroContactRaw {
  contactID?: string;
  name?: string;
  emailAddress?: string;
  phones?: XeroContactPhone[];
  addresses?: XeroContactAddress[];
  accountNumber?: string;
  contactStatus?: string;
  isSupplier?: boolean;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  const createNew = req.nextUrl.searchParams.get("createNew") === "1";

  let xeroContacts: XeroContactRaw[] = [];
  try {
    const { client, conn } = await getAuthedClient();
    // Pull all contacts marked as supplier. Xero paginates at 100/page on the
    // Contacts endpoint; loop until a page returns fewer than 100.
    let page = 1;
    for (;;) {
      // Signature: (tenantId, ifModifiedSince?, where?, order?, iDs?, page?, ...)
      const res = await client.accountingApi.getContacts(
        conn.tenant_id,
        undefined,
        "IsSupplier==true",
        undefined,
        undefined,
        page,
      );
      const batch = (res.body.contacts ?? []) as unknown as XeroContactRaw[];
      xeroContacts.push(...batch);
      if (batch.length < 100) break;
      page += 1;
      if (page > 20) break; // hard safety cap — 2000 suppliers is way more than we expect
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Xero fetch failed: ${msg}` }, { status: 502 });
  }

  // Only active suppliers
  const active = xeroContacts.filter(
    (c) => c.contactID && c.name && (c.contactStatus ?? "ACTIVE") === "ACTIVE",
  );

  const { data: existing, error: existingErr } = await supabase
    .from("suppliers")
    .select("id, name, xero_contact_id, email, phone, address, suburb, state, account_number");
  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });

  interface CrmSupplier {
    id: string;
    name: string;
    xero_contact_id: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    suburb: string | null;
    state: string | null;
    account_number: string | null;
  }
  const byXeroId = new Map<string, CrmSupplier>();
  const byName = new Map<string, CrmSupplier>();
  for (const s of (existing ?? []) as CrmSupplier[]) {
    if (s.xero_contact_id) byXeroId.set(s.xero_contact_id, s);
    byName.set(s.name.trim().toLowerCase(), s);
  }

  const actions: {
    action: "create" | "link" | "update" | "skip";
    xeroContactId: string;
    name: string;
    supplierId?: string;
    note?: string;
  }[] = [];

  const toCreate: Array<{
    name: string;
    xero_contact_id: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    suburb: string | null;
    state: string | null;
    account_number: string | null;
    is_active: boolean;
  }> = [];

  const toUpdate: Array<{
    id: string;
    patch: Partial<CrmSupplier>;
  }> = [];

  for (const c of active) {
    const xeroId = c.contactID!;
    const name = c.name!.trim();
    const email = c.emailAddress?.trim() || null;
    const phone = c.phones?.find((p) => p.phoneNumber)?.phoneNumber?.trim() || null;
    const primaryAddr = c.addresses?.find(
      (a) => a.addressType === "STREET" && (a.addressLine1 || a.city),
    ) ?? c.addresses?.find((a) => a.addressLine1 || a.city);
    const address = primaryAddr?.addressLine1?.trim() || null;
    const suburb = primaryAddr?.city?.trim() || null;
    const state = primaryAddr?.region?.trim() || null;
    const accountNumber = c.accountNumber?.trim() || null;

    // Already linked by xero_contact_id → patch any empty fields
    const linked = byXeroId.get(xeroId);
    if (linked) {
      const patch: Partial<CrmSupplier> = {};
      if (!linked.email && email) patch.email = email;
      if (!linked.phone && phone) patch.phone = phone;
      if (!linked.address && address) patch.address = address;
      if (!linked.suburb && suburb) patch.suburb = suburb;
      if (!linked.state && state) patch.state = state;
      if (!linked.account_number && accountNumber) patch.account_number = accountNumber;
      if (Object.keys(patch).length === 0) {
        actions.push({ action: "skip", xeroContactId: xeroId, name, supplierId: linked.id, note: "Already linked, no missing fields to backfill" });
      } else {
        actions.push({ action: "update", xeroContactId: xeroId, name, supplierId: linked.id });
        toUpdate.push({ id: linked.id, patch });
      }
      continue;
    }

    // Name match (case-insensitive) with an unlinked CRM supplier → link + backfill
    const nameMatch = byName.get(name.toLowerCase());
    if (nameMatch && !nameMatch.xero_contact_id) {
      const patch: Partial<CrmSupplier> = { xero_contact_id: xeroId };
      if (!nameMatch.email && email) patch.email = email;
      if (!nameMatch.phone && phone) patch.phone = phone;
      if (!nameMatch.address && address) patch.address = address;
      if (!nameMatch.suburb && suburb) patch.suburb = suburb;
      if (!nameMatch.state && state) patch.state = state;
      if (!nameMatch.account_number && accountNumber) patch.account_number = accountNumber;
      actions.push({ action: "link", xeroContactId: xeroId, name, supplierId: nameMatch.id });
      toUpdate.push({ id: nameMatch.id, patch });
      continue;
    }

    // Name match but it's already linked to a different xero contact → skip
    if (nameMatch && nameMatch.xero_contact_id && nameMatch.xero_contact_id !== xeroId) {
      actions.push({
        action: "skip",
        xeroContactId: xeroId,
        name,
        note: `Name conflicts with CRM supplier already linked to a different Xero contact`,
      });
      continue;
    }

    // No CRM match. Either skip (default) or queue for creation.
    if (!createNew) {
      actions.push({
        action: "skip",
        xeroContactId: xeroId,
        name,
        note: "No CRM match — enable 'Create new suppliers too' to import",
      });
      continue;
    }

    actions.push({ action: "create", xeroContactId: xeroId, name });
    toCreate.push({
      name,
      xero_contact_id: xeroId,
      email,
      phone,
      address,
      suburb,
      state,
      account_number: accountNumber,
      is_active: true,
    });
  }

  const summary = {
    xeroSupplierCount: active.length,
    toCreate: toCreate.length,
    toLink: actions.filter((a) => a.action === "link").length,
    toUpdate: actions.filter((a) => a.action === "update").length,
    skipped: actions.filter((a) => a.action === "skip").length,
  };

  if (dryRun) {
    return NextResponse.json({ dryRun: true, summary, actions });
  }

  // Apply changes
  let createdCount = 0;
  let updatedCount = 0;

  if (toCreate.length > 0) {
    const { error: insErr, data: inserted } = await supabase
      .from("suppliers")
      .insert(toCreate)
      .select("id");
    if (insErr) {
      return NextResponse.json(
        { error: `Insert failed: ${insErr.message}`, partial: { createdCount, updatedCount } },
        { status: 500 },
      );
    }
    createdCount = inserted?.length ?? 0;
  }

  for (const u of toUpdate) {
    const { error: upErr } = await supabase
      .from("suppliers")
      .update(u.patch)
      .eq("id", u.id);
    if (upErr) {
      return NextResponse.json(
        {
          error: `Update failed on supplier ${u.id}: ${upErr.message}`,
          partial: { createdCount, updatedCount },
        },
        { status: 500 },
      );
    }
    updatedCount += 1;
  }

  return NextResponse.json({
    ok: true,
    summary: { ...summary, createdCount, updatedCount },
  });
}
