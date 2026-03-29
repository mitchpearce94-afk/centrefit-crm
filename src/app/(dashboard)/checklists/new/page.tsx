import Link from "next/link";
import { TemplateForm } from "../template-form";

export default function NewTemplatePage() {
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
      <h1 className="mt-1 text-2xl font-bold tracking-tight">New Template</h1>

      <div className="mt-6">
        <TemplateForm />
      </div>
    </div>
  );
}
