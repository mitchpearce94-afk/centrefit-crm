import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { TemplateList } from "./template-list";

export default async function ChecklistsPage() {
  const supabase = await createClient();

  const { data: templates } = await supabase
    .from("checklist_templates")
    .select("*")
    .order("name");

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          Checklist Templates
        </h1>
        <Link
          href="/checklists/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          New Template
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Create and manage reusable checklists that techs can apply to jobs.
      </p>

      <div className="mt-6">
        <TemplateList templates={templates ?? []} />
      </div>
    </div>
  );
}
