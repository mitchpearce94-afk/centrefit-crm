import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { TemplateForm } from "../template-form";

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: template, error } = await supabase
    .from("checklist_templates")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !template) {
    notFound();
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/checklists"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          Checklists
        </Link>
        <span className="text-muted-foreground">/</span>
      </div>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">
        {template.name}
      </h1>

      <div className="mt-6">
        <TemplateForm template={template} />
      </div>
    </div>
  );
}
