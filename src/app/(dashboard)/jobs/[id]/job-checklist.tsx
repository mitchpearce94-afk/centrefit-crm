"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface ChecklistItem {
  id: string;
  task_number: number;
  title: string;
  sub_items: string[];
  is_completed: boolean;
  completed_by_text: string | null;
  completed_at: string | null;
}

interface Template {
  id: string;
  name: string;
  description: string | null;
  items: { task_number: number; title: string; sub_items: string[] }[];
}

export function JobChecklist({
  jobId,
  items,
  templates,
}: {
  jobId: string;
  items: ChecklistItem[];
  templates: Template[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [applying, setApplying] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  const completedCount = items.filter((i) => i.is_completed).length;
  const totalCount = items.length;

  async function applyTemplate(template: Template) {
    setApplying(true);
    const rows = template.items.map((item, i) => ({
      job_id: jobId,
      template_id: template.id,
      task_number: item.task_number,
      title: item.title,
      sub_items: item.sub_items,
      sort_order: i,
    }));

    const { error } = await supabase.from("job_checklist_items").insert(rows);
    if (error) {
      alert(error.message);
    } else {
      setShowTemplates(false);
      router.refresh();
    }
    setApplying(false);
  }

  async function toggleItem(item: ChecklistItem) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Get current staff info for initials
    let completedText: string | null = null;
    if (!item.is_completed) {
      const { data: staff } = await supabase
        .from("staff")
        .select("initials")
        .eq("id", user?.id ?? "")
        .single();

      const today = new Date().toLocaleDateString("en-AU", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      });
      completedText = `${staff?.initials ?? "??"} ${today}`;
    }

    const { error } = await supabase
      .from("job_checklist_items")
      .update({
        is_completed: !item.is_completed,
        completed_by_text: item.is_completed ? null : completedText,
        completed_at: item.is_completed ? null : new Date().toISOString(),
        completed_by_staff_id: item.is_completed ? null : user?.id,
      })
      .eq("id", item.id);

    if (error) {
      alert(error.message);
    } else {
      router.refresh();
    }
  }

  async function updateCompletedText(itemId: string, text: string) {
    await supabase
      .from("job_checklist_items")
      .update({ completed_by_text: text })
      .eq("id", itemId);
  }

  // No checklist yet — show template picker
  if (items.length === 0) {
    return (
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Checklist
          </h2>
        </div>

        {!showTemplates ? (
          <div className="rounded-lg border border-dashed border-border py-6 text-center">
            <p className="text-sm text-muted-foreground mb-2">
              No checklist applied to this job.
            </p>
            <button
              onClick={() => setShowTemplates(true)}
              className="text-sm text-primary hover:text-primary/80 transition-colors"
            >
              Apply a template
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-primary/30 bg-card p-4">
            <p className="text-sm font-medium mb-3">Choose a template:</p>
            <div className="space-y-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => applyTemplate(t)}
                  disabled={applying}
                  className="flex w-full items-start gap-3 rounded-lg border border-border p-3 text-left hover:bg-accent transition-colors disabled:opacity-50"
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium">{t.name}</p>
                    {t.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {t.items.length} tasks
                    </p>
                  </div>
                </button>
              ))}
              {templates.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No templates created yet.
                </p>
              )}
            </div>
            <button
              onClick={() => setShowTemplates(false)}
              className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  // Checklist exists — show tasks
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Checklist
        </h2>
        <span className="text-xs font-medium text-muted-foreground">
          {completedCount}/{totalCount} complete
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-4">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            progress === 100 ? "bg-success" : "bg-primary"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Tasks */}
      <div className="space-y-1">
        {items
          .sort((a, b) => a.task_number - b.task_number)
          .map((item) => (
            <ChecklistTask
              key={item.id}
              item={item}
              onToggle={() => toggleItem(item)}
              onUpdateText={(text) => updateCompletedText(item.id, text)}
            />
          ))}
      </div>
    </div>
  );
}

function ChecklistTask({
  item,
  onToggle,
  onUpdateText,
}: {
  item: ChecklistItem;
  onToggle: () => void;
  onUpdateText: (text: string) => void;
}) {
  const [editingText, setEditingText] = useState(false);
  const [localText, setLocalText] = useState(item.completed_by_text ?? "");

  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        item.is_completed
          ? "border-success/20 bg-success/5"
          : "border-border bg-card"
      }`}
    >
      <div className="flex gap-3">
        {/* Checkbox */}
        <button
          onClick={onToggle}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
            item.is_completed
              ? "border-success bg-success text-white"
              : "border-muted-foreground/40 hover:border-primary"
          }`}
        >
          {item.is_completed && (
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </button>

        <div className="flex-1 min-w-0">
          {/* Task header */}
          <div className="flex items-start justify-between gap-2">
            <p
              className={`text-sm font-medium ${
                item.is_completed ? "text-muted-foreground" : ""
              }`}
            >
              <span className="text-muted-foreground mr-1.5">
                {item.task_number}.
              </span>
              {item.title}
            </p>
          </div>

          {/* Sub-items */}
          {item.sub_items.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 ml-1">
              {item.sub_items.map((sub: string, i: number) => (
                <li key={i} className="flex gap-1.5 text-xs text-muted-foreground">
                  <span className="mt-0.5 shrink-0">•</span>
                  <span>{sub}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Completed by */}
          {item.is_completed && (
            <div className="mt-2">
              {editingText ? (
                <input
                  value={localText}
                  onChange={(e) => setLocalText(e.target.value)}
                  onBlur={() => {
                    onUpdateText(localText);
                    setEditingText(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      onUpdateText(localText);
                      setEditingText(false);
                    }
                  }}
                  autoFocus
                  className="rounded border border-border bg-input px-2 py-0.5 text-xs font-medium text-success focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="e.g. MM & MJP 28-30/10/25"
                />
              ) : (
                <button
                  onClick={() => {
                    setLocalText(item.completed_by_text ?? "");
                    setEditingText(true);
                  }}
                  className="text-xs font-semibold text-success hover:underline"
                >
                  Completed by {item.completed_by_text ?? "—"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
