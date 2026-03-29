"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";

interface TaskItem {
  task_number: number;
  title: string;
  sub_items: string[];
}

interface TemplateData {
  id?: string;
  name: string;
  description: string | null;
  items: TaskItem[];
  is_active: boolean;
}

export function TemplateForm({ template }: { template?: TemplateData }) {
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();
  const isEditing = !!template?.id;

  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [isActive, setIsActive] = useState(template?.is_active ?? true);
  const [tasks, setTasks] = useState<TaskItem[]>(
    template?.items?.length
      ? template.items
      : [{ task_number: 1, title: "", sub_items: [] }]
  );
  const [saving, setSaving] = useState(false);

  function addTask() {
    setTasks([
      ...tasks,
      { task_number: tasks.length + 1, title: "", sub_items: [] },
    ]);
  }

  function removeTask(index: number) {
    const updated = tasks.filter((_, i) => i !== index);
    // Re-number tasks
    setTasks(updated.map((t, i) => ({ ...t, task_number: i + 1 })));
  }

  function updateTask(index: number, title: string) {
    setTasks(tasks.map((t, i) => (i === index ? { ...t, title } : t)));
  }

  function addSubItem(taskIndex: number) {
    setTasks(
      tasks.map((t, i) =>
        i === taskIndex ? { ...t, sub_items: [...t.sub_items, ""] } : t
      )
    );
  }

  function updateSubItem(taskIndex: number, subIndex: number, value: string) {
    setTasks(
      tasks.map((t, i) =>
        i === taskIndex
          ? {
              ...t,
              sub_items: t.sub_items.map((s, si) =>
                si === subIndex ? value : s
              ),
            }
          : t
      )
    );
  }

  function removeSubItem(taskIndex: number, subIndex: number) {
    setTasks(
      tasks.map((t, i) =>
        i === taskIndex
          ? { ...t, sub_items: t.sub_items.filter((_, si) => si !== subIndex) }
          : t
      )
    );
  }

  function moveTask(index: number, direction: "up" | "down") {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= tasks.length) return;
    const updated = [...tasks];
    [updated[index], updated[target]] = [updated[target], updated[index]];
    setTasks(updated.map((t, i) => ({ ...t, task_number: i + 1 })));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    // Filter out empty tasks and sub-items
    const cleanedTasks = tasks
      .filter((t) => t.title.trim())
      .map((t, i) => ({
        task_number: i + 1,
        title: t.title.trim(),
        sub_items: t.sub_items.filter((s) => s.trim()),
      }));

    if (cleanedTasks.length === 0) {
      toast("Add at least one task", "error");
      return;
    }

    setSaving(true);

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      items: cleanedTasks,
      is_active: isActive,
    };

    if (isEditing && template?.id) {
      const { error } = await supabase
        .from("checklist_templates")
        .update(payload)
        .eq("id", template.id);
      if (error) {
        toast(error.message, "error");
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase
        .from("checklist_templates")
        .insert(payload);
      if (error) {
        toast(error.message, "error");
        setSaving(false);
        return;
      }
    }

    router.push("/checklists");
    router.refresh();
  }

  const inputClass =
    "block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <form onSubmit={handleSubmit}>
      {/* Template info */}
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Template Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Snap Fitness Full Fitout"
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of when to use this template..."
            rows={2}
            className={`${inputClass} resize-none`}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsActive(!isActive)}
            className={`relative h-5 w-9 rounded-full transition-colors ${
              isActive ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                isActive ? "left-[18px]" : "left-0.5"
              }`}
            />
          </button>
          <span className="text-sm text-muted-foreground">
            {isActive ? "Active — visible to techs" : "Inactive — hidden from techs"}
          </span>
        </div>
      </div>

      {/* Tasks */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Tasks ({tasks.filter((t) => t.title.trim()).length})
          </h2>
          <button
            type="button"
            onClick={addTask}
            className="text-xs text-primary hover:text-primary/80 transition-colors"
          >
            + Add Task
          </button>
        </div>

        <div className="space-y-3">
          {tasks.map((task, taskIndex) => (
            <div
              key={taskIndex}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex gap-3">
                {/* Task number + reorder */}
                <div className="flex flex-col items-center gap-0.5 shrink-0 pt-2">
                  <button
                    type="button"
                    onClick={() => moveTask(taskIndex, "up")}
                    disabled={taskIndex === 0}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="18 15 12 9 6 15" />
                    </svg>
                  </button>
                  <span className="text-xs font-mono text-muted-foreground">
                    {task.task_number}
                  </span>
                  <button
                    type="button"
                    onClick={() => moveTask(taskIndex, "down")}
                    disabled={taskIndex === tasks.length - 1}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                </div>

                {/* Task content */}
                <div className="flex-1 min-w-0">
                  <input
                    value={task.title}
                    onChange={(e) => updateTask(taskIndex, e.target.value)}
                    placeholder="Task title..."
                    className={inputClass}
                  />

                  {/* Sub-items */}
                  {task.sub_items.length > 0 && (
                    <div className="mt-2 space-y-1.5 ml-2">
                      {task.sub_items.map((sub, subIndex) => (
                        <div key={subIndex} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground shrink-0">
                            •
                          </span>
                          <input
                            value={sub}
                            onChange={(e) =>
                              updateSubItem(taskIndex, subIndex, e.target.value)
                            }
                            placeholder="Sub-item..."
                            className="flex-1 rounded border border-border bg-input px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <button
                            type="button"
                            onClick={() => removeSubItem(taskIndex, subIndex)}
                            className="text-xs text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 flex gap-3">
                    <button
                      type="button"
                      onClick={() => addSubItem(taskIndex)}
                      className="text-xs text-muted-foreground hover:text-primary transition-colors"
                    >
                      + Sub-item
                    </button>
                  </div>
                </div>

                {/* Delete task */}
                {tasks.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeTask(taskIndex)}
                    className="shrink-0 text-muted-foreground hover:text-destructive transition-colors mt-2"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addTask}
          className="mt-3 w-full rounded-lg border border-dashed border-border py-3 text-sm text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
        >
          + Add Task
        </button>
      </div>

      {/* Actions */}
      <div className="mt-8 flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {saving
            ? "Saving..."
            : isEditing
            ? "Save Changes"
            : "Create Template"}
        </button>
        <Link
          href="/checklists"
          className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
