import type { SupabaseClient } from "@supabase/supabase-js";
import type { XeroClient } from "xero-node";

export interface CustomerForXero {
  id: string;
  name: string;
  xero_contact_id?: string | null;
  email?: string | null;
  phone?: string | null;
  abn?: string | null;
}

/**
 * Resolve a CRM customer to a Xero ContactID, pushing them into Xero on first
 * touch. Strategy:
 *   1. If `customers.xero_contact_id` is already set → trust it.
 *   2. Otherwise search Xero by exact Name match. If found → persist that ID.
 *   3. Otherwise create a new Xero contact and persist the returned ID.
 *
 * Caller must have an authenticated XeroClient (see getAuthedClient()).
 */
export async function findOrCreateContact(
  supabase: SupabaseClient,
  xero: XeroClient,
  tenantId: string,
  customer: CustomerForXero,
): Promise<string> {
  if (customer.xero_contact_id) return customer.xero_contact_id;

  const safeName = customer.name.replace(/"/g, '\\"');
  let contactId: string | undefined;

  // 1. Search by exact name
  try {
    const search = await xero.accountingApi.getContacts(
      tenantId,
      undefined,
      `Name=="${safeName}"`,
    );
    contactId = search.body.contacts?.[0]?.contactID;
  } catch {
    // Search failure shouldn't block creation — fall through.
  }

  // 2. Create if not found
  if (!contactId) {
    const contactPayload: Record<string, unknown> = {
      name: customer.name.slice(0, 255),
    };
    if (customer.email) contactPayload.emailAddress = customer.email;
    if (customer.phone) {
      contactPayload.phones = [{ phoneType: "DEFAULT", phoneNumber: customer.phone }];
    }
    if (customer.abn) {
      contactPayload.taxNumber = customer.abn;
    }

    const created = await xero.accountingApi.createContacts(tenantId, {
      contacts: [contactPayload],
    });
    contactId = created.body.contacts?.[0]?.contactID;
    if (!contactId) {
      throw new Error("Xero did not return a ContactID for the new contact");
    }
  }

  // 3. Persist the mapping
  await supabase
    .from("customers")
    .update({ xero_contact_id: contactId })
    .eq("id", customer.id);

  return contactId;
}
