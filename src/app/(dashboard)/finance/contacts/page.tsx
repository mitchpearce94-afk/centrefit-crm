import { createServiceRoleClient } from "@/lib/supabase/service";
import { requireFinanceViewerOrNotFound } from "@/lib/finance/access";
import { buildWorksheet } from "@/lib/finance/contacts";
import { ContactsWorksheet } from "./contacts-worksheet";

export const dynamic = "force-dynamic";

// Contact worksheet (docs/finance-CONTEXT.md D5, D6): one GoCardless customer,
// one Xero contact, decided by Mitchell, keyed by id in the CRM.
export default async function FinanceContactsPage() {
  await requireFinanceViewerOrNotFound();
  const svc = createServiceRoleClient();
  const rows = await buildWorksheet(svc);
  const { data: contacts } = await svc.from("finance_xero_contacts").select("contact_id, name, status").neq("status", "ARCHIVED").order("name");
  const { data: sites } = await svc.from("customer_sites").select("id, name").order("name");
  return <ContactsWorksheet rows={rows} contacts={(contacts ?? []).filter((c) => !/^PAYMENT FROM/i.test(c.name as string)) as never} sites={(sites ?? []) as never} />;
}
