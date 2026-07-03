import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Site-first Phase C (D1): customer pages die. Backing customers are 1:1
// with sites post-split, so an old /customers/<id> link (bookmark, bell
// notification, external doc) lands on that owner's site page.
export default async function CustomerRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: site } = await supabase
    .from("customer_sites")
    .select("id")
    .eq("customer_id", id)
    .limit(1)
    .maybeSingle();
  redirect(site ? `/sites/${site.id}` : "/sites");
}
