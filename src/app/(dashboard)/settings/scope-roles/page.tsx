import { createClient } from "@/lib/supabase/server";
import { ScopeRolesManager } from "./scope-roles-manager";

export default async function ScopeRolesSettingsPage() {
  const supabase = await createClient();
  const { data: roles } = await supabase
    .from("quote_scope_roles")
    .select("*")
    .order("sort_order")
    .order("label");

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Scope Roles</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Vocabulary of <code className="font-mono text-xs">scope_role</code> values that products can be tagged with.
        The generator owns the wording for roles flagged as <span className="text-emerald-400">Handled</span>;
        anything else falls into the <strong>Additional items</strong> block on the scope of works.
      </p>
      <div className="mt-6">
        <ScopeRolesManager roles={roles ?? []} />
      </div>
    </div>
  );
}
