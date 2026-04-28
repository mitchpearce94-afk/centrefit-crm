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
 * Optional site context. When supplied:
 *   - The Xero contact is named "<customer> — <site>" so a customer with
 *     multiple sites gets one contact per facility (the billing entity model
 *     Centrefit actually operates against).
 *   - The site address is attached to the contact's POBOX address slot,
 *     which Xero renders in the "Bill To" block on the invoice template.
 *   - Resolution prefers `customer_sites.xero_contact_id` (per-site) over
 *     `customers.xero_contact_id` (legacy/site-less).
 *   - Persistence writes back to `customer_sites.xero_contact_id`.
 *
 * Without site context, we fall back to legacy customer-level contact
 * mapping (used for the site-less "ad-hoc" customer record case).
 */
export interface SiteForXero {
  id: string;
  name: string;
  xero_contact_id?: string | null;
  address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
}

/**
 * Resolve a CRM customer (and optionally a specific site) to a Xero
 * ContactID, pushing them into Xero on first touch.
 *
 * Strategy:
 *   1. If we already have the right ContactID stored locally → trust it.
 *      - With site: customer_sites.xero_contact_id wins.
 *      - Without site: customers.xero_contact_id.
 *   2. Otherwise search Xero by exact display name. Two-pass:
 *      - First the precise "<customer> — <site>" match.
 *      - Then a normalised loose match (case-insensitive, punctuation
 *        stripped) so we link onto pre-existing Xero contacts that someone
 *        named slightly differently (e.g. "Snap Fitness Tuggerah" with no
 *        em-dash, vs our "Snap Fitness — Tuggerah").
 *   3. Otherwise create a new Xero contact with the site address attached
 *      so it shows in the invoice "Bill To" block.
 *
 * Caller must have an authenticated XeroClient (see getAuthedClient()).
 */
export async function findOrCreateContact(
  supabase: SupabaseClient,
  xero: XeroClient,
  tenantId: string,
  customer: CustomerForXero,
  site?: SiteForXero | null,
): Promise<string> {
  // 1. Trust the stored mapping. Site-level wins over customer-level.
  if (site?.xero_contact_id) return site.xero_contact_id;
  if (!site && customer.xero_contact_id) return customer.xero_contact_id;

  // Display name follows the per-site naming convention when there's a site.
  const displayName = site
    ? `${customer.name} — ${site.name}`.slice(0, 255)
    : customer.name.slice(0, 255);
  const safeName = displayName.replace(/"/g, '\\"');
  let contactId: string | undefined;

  // 2a. Exact-name search.
  try {
    const search = await xero.accountingApi.getContacts(
      tenantId,
      undefined,
      `Name=="${safeName}"`,
    );
    contactId = search.body.contacts?.[0]?.contactID;
  } catch {
    // Search failure shouldn't block creation.
  }

  // 2b. Loose match — strip punctuation + lowercase + collapse spaces. Catches
  // pre-existing Xero contacts where staff used a slightly different style.
  // We pull a small page and filter client-side because the Xero where-clause
  // doesn't support fuzzy / case-insensitive directly.
  if (!contactId) {
    const target = normaliseContactName(displayName);
    try {
      const search = await xero.accountingApi.getContacts(
        tenantId,
        undefined,
        site
          ? `Name.Contains("${customer.name.replace(/"/g, '\\"').slice(0, 60)}")`
          : `Name.Contains("${safeName.slice(0, 60)}")`,
        undefined,  // order
        undefined,  // iDs
        1,          // page
      );
      const candidates = search.body.contacts ?? [];
      contactId = candidates.find(
        (c) => c.name && normaliseContactName(c.name) === target,
      )?.contactID;
    } catch {
      // Fuzzy search is best-effort. Fall through.
    }
  }

  // 3. Create if still nothing.
  if (!contactId) {
    const contactPayload: Record<string, unknown> = {
      name: displayName,
    };
    if (customer.email) contactPayload.emailAddress = customer.email;
    if (customer.phone) {
      contactPayload.phones = [{ phoneType: "DEFAULT", phoneNumber: customer.phone }];
    }
    if (customer.abn) {
      contactPayload.taxNumber = customer.abn;
    }
    if (site?.address || site?.suburb || site?.postcode) {
      // POBOX is Xero's "billing address" slot — what shows in the Bill To
      // block on the invoice template. STREET is the alternative slot for
      // a separate physical / shipping address; we only have one address per
      // site so we put it on POBOX.
      contactPayload.addresses = [
        {
          addressType: "POBOX",
          addressLine1: site.address ?? "",
          city: site.suburb ?? "",
          region: site.state ?? "",
          postalCode: site.postcode ?? "",
          country: "Australia",
        },
      ];
    }

    const created = await xero.accountingApi.createContacts(tenantId, {
      contacts: [contactPayload],
    });
    contactId = created.body.contacts?.[0]?.contactID;
    if (!contactId) {
      throw new Error("Xero did not return a ContactID for the new contact");
    }
  } else if (site?.address || site?.suburb || site?.postcode) {
    // Linked onto a pre-existing Xero contact that may not have an address —
    // patch it on so the invoice template renders the Bill To block.
    try {
      await xero.accountingApi.updateContact(tenantId, contactId, {
        contacts: [
          {
            addresses: [
              {
                addressType: "POBOX",
                addressLine1: site.address ?? "",
                city: site.suburb ?? "",
                region: site.state ?? "",
                postalCode: site.postcode ?? "",
                country: "Australia",
              },
            ],
          } as Record<string, unknown>,
        ],
      });
    } catch {
      // Non-fatal — contact still works for invoicing without the address.
    }
  }

  // 4. Persist the mapping back. Site-level when there's a site (so the next
  // invoice for this exact site picks it up directly without re-searching),
  // customer-level otherwise (legacy site-less flow).
  if (site) {
    await supabase
      .from("customer_sites")
      .update({ xero_contact_id: contactId })
      .eq("id", site.id);
  } else {
    await supabase
      .from("customers")
      .update({ xero_contact_id: contactId })
      .eq("id", customer.id);
  }

  return contactId;
}

function normaliseContactName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ") // strip punctuation, keep boundaries
    .replace(/\s+/g, " ")
    .trim();
}

export interface SupplierForXero {
  id: string;
  name: string;
  xero_contact_id?: string | null;
  email?: string | null;
  phone?: string | null;
  account_number?: string | null;
}

/**
 * Same find-or-create pattern as the customer helper, but for suppliers.
 * Persists the Xero ContactID back to `suppliers.xero_contact_id`.
 *
 * Suppliers don't have ABN in our schema (they're often overseas / China
 * direct), so we skip the taxNumber field.
 */
export async function findOrCreateSupplierContact(
  supabase: SupabaseClient,
  xero: XeroClient,
  tenantId: string,
  supplier: SupplierForXero,
): Promise<string> {
  if (supplier.xero_contact_id) return supplier.xero_contact_id;

  const safeName = supplier.name.replace(/"/g, '\\"');
  let contactId: string | undefined;

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

  if (!contactId) {
    const contactPayload: Record<string, unknown> = {
      name: supplier.name.slice(0, 255),
      isSupplier: true,
    };
    if (supplier.email) contactPayload.emailAddress = supplier.email;
    if (supplier.phone) {
      contactPayload.phones = [{ phoneType: "DEFAULT", phoneNumber: supplier.phone }];
    }
    if (supplier.account_number) {
      contactPayload.accountNumber = supplier.account_number;
    }

    const created = await xero.accountingApi.createContacts(tenantId, {
      contacts: [contactPayload],
    });
    contactId = created.body.contacts?.[0]?.contactID;
    if (!contactId) {
      throw new Error("Xero did not return a ContactID for the new supplier contact");
    }
  }

  await supabase
    .from("suppliers")
    .update({ xero_contact_id: contactId })
    .eq("id", supplier.id);

  return contactId;
}
