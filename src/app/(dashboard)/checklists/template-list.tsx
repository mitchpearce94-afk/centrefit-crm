"use client";

import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";

interface Template {
  id: string;
  name: string;
  description: string | null;
  items: { task_number: number; title: string; sub_items: string[] }[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function TemplateList({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();
  const [deleting, setDeleting] = useState<string | null>(null);

  async function toggleActive(id: string, current: boolean) {
    await supabase
      .from("checklist_templates")
      .update({ is_active: !current })
      .eq("id", id);
    router.refresh();
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Delete this template? This won't affect jobs already using it.")) return;
    setDeleting(id);
    const { error } = await supabase
      .from("checklist_templates")
      .delete()
      .eq("id", id);
    if (error) {
      toast(error.message, "error");
    } else {
      router.refresh();
    }
    setDeleting(null);
  }

  if (templates.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-12 text-center">
        <p className="text-sm text-muted-foreground">No templates yet.</p>
        <Link
          href="/checklists/new"
          className="mt-2 inline-block text-sm text-primary hover:text-primary/80 transition-colors"
        >
          Create your first template
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {templates.map((t) => (
        <div
          key={t.id}
          className={`rounded-lg border p-4 transition-colors ${
            t.is_active ? "border-border bg-card" : "border-border/50 bg-muted/30"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Link
                  href={`/checklists/${t.id}`}
                  className="text-sm font-medium hover:text-primary transition-colors"
                >
                  {t.name}
                </Link>
                {!t.is_active && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                    Inactive
                  </span>
                )}
              </div>
              {t.description && (
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                  {t.description}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {t.items.length} task{t.items.length !== 1 ? "s" : ""}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => toggleActive(t.id, t.is_active)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  t.is_active
                    ? "bg-success/10 text-success hover:bg-success/20"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                {t.is_active ? "Active" : "Activate"}
              </button>
              <Link
                href={`/checklists/${t.id}`}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
              >
                Edit
              </Link>
              <button
                onClick={() => deleteTemplate(t.id)}
                disabled={deleting === t.id}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 hover:border-destructive transition-colors disabled:opacity-50"
              >
                {deleting === t.id ? "..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
