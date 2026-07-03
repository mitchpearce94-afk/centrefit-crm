import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Site-first Phase C: owner details are edited on the site page's Owner card.
export default async function CustomerEditRedirectPage({
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
