import { createClient } from "@/lib/supabase/server";
import { requirePermissionOrNotFound } from "@/lib/auth/route-guards";
import { GuidedInterview } from "./guided-interview";

export const dynamic = "force-dynamic";

// Guided quote (docs/quoting-v2-CONTEXT.md D4): questions instead of a plan.
export default async function GuidedQuotePage() {
  await requirePermissionOrNotFound("quoting.create");
  const supabase = await createClient();
  const { data: templates } = await supabase.from("quote_rule_templates").select("id, name, slug, is_default").eq("is_active", true).order("sort_order");
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight">Guided quote</h1>
      <p className="mt-1 text-sm text-muted-foreground">Answer what&apos;s on site. The engine builds the parts, kits, labour and scope the same way it does from a plan. Add the odd extra afterwards.</p>
      <div className="mt-5"><GuidedInterview templates={templates ?? []} /></div>
    </div>
  );
}
