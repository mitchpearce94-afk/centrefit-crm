import { createClient } from "@/lib/supabase/server";
import { ReviewList } from "./review-list";

export const dynamic = "force-dynamic";

// Review queue (docs/finance-CONTEXT.md D7): everything the agent refused to guess.
export default async function FinanceReviewPage() {
  const supabase = await createClient();
  const { data: items } = await supabase
    .from("finance_review_items")
    .select("id, kind, title, evidence, payout_id, payout_item_id, gc_customer_id, status, created_at, finance_payouts(arrival_date, provider_payout_id)")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(300);
  // candidate invoices per contact for the resolver (mirror only, no Xero calls)
  const contactIds = [...new Set((items ?? []).map((i) => (i.evidence as { xero_contact_id?: string })?.xero_contact_id).filter(Boolean))] as string[];
  const { data: invoices } = contactIds.length
    ? await supabase.from("finance_xero_invoices").select("invoice_id, invoice_number, contact_id, contact_name, status, date, total, amount_due").in("contact_id", contactIds).in("status", ["AUTHORISED", "SUBMITTED", "PAID"]).order("date", { ascending: false })
    : { data: [] };
  const { data: contacts } = await supabase.from("finance_xero_contacts").select("contact_id, name, status").neq("status", "ARCHIVED").order("name");
  return <ReviewList items={(items ?? []) as never} invoices={(invoices ?? []) as never} contacts={(contacts ?? []).filter((c) => !/^PAYMENT FROM/i.test(c.name as string)) as never} />;
}
