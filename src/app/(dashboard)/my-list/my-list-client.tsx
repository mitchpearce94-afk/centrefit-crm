"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface PersonalTask {
  id: string;
  owner_id: string;
  title: string;
  notes: string | null;
  status: "open" | "done" | "snoozed" | "waiting";
  due_date: string | null;
  snoozed_until: string | null;
  source: string;
  source_ref: string | null;
  href: string | null;
  priority: "urgent" | "normal" | "low";
  first_seen_at: string;
  completed_at: string | null;
  created_at: string;
}

function localDateISO(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDateISO(d);
}

function nextMondayISO(): string {
  const d = new Date();
  const diff = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return localDateISO(d);
}

function daysOnList(t: PersonalTask): number {
  return Math.floor((Date.now() - new Date(t.first_seen_at).getTime()) / 86_400_000);
}

function formatShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

type Bucket = "overdue" | "today" | "inbox" | "upcoming" | "waiting" | "snoozed";

function bucketOf(t: PersonalTask, today: string): Bucket {
  if (t.status === "waiting") return "waiting";
  // Snoozes that have come due surface back into Today automatically.
  if (t.status === "snoozed") {
    return t.snoozed_until && t.snoozed_until <= today ? "today" : "snoozed";
  }
  if (!t.due_date) return "inbox";
  if (t.due_date < today) return "overdue";
  if (t.due_date === today) return "today";
  return "upcoming";
}

const SECTION_META: { key: Bucket; label: string; accent?: string }[] = [
  { key: "overdue", label: "Overdue", accent: "text-red-500" },
  { key: "today", label: "Today" },
  { key: "inbox", label: "No date" },
  { key: "upcoming", label: "Upcoming" },
  { key: "waiting", label: "Waiting on someone" },
  { key: "snoozed", label: "Snoozed" },
];

export function MyListClient({
  ownerId,
  initialOpen,
  initialDone,
}: {
  ownerId: string;
  initialOpen: PersonalTask[];
  initialDone: PersonalTask[];
}) {
  const [tasks, setTasks] = useState<PersonalTask[]>(initialOpen);
  const [done, setDone] = useState<PersonalTask[]>(initialDone);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const today = localDateISO();

  const buckets = useMemo(() => {
    const map: Record<Bucket, PersonalTask[]> = {
      overdue: [], today: [], inbox: [], upcoming: [], waiting: [], snoozed: [],
    };
    for (const t of tasks) map[bucketOf(t, today)].push(t);
    // Urgent first within each section, then existing due/created order.
    for (const key of Object.keys(map) as Bucket[]) {
      map[key].sort((a, b) => (a.priority === "urgent" ? 0 : 1) - (b.priority === "urgent" ? 0 : 1));
    }
    return map;
  }, [tasks, today]);

  async function patchTask(id: string, patch: Partial<PersonalTask>, opts?: { remove?: boolean }) {
    const prev = tasks;
    const prevDone = done;
    const target = tasks.find((t) => t.id === id) ?? done.find((t) => t.id === id);
    if (!target) return;
    const updated = { ...target, ...patch } as PersonalTask;

    // Optimistic move between the open list and the done list.
    if (opts?.remove) {
      setTasks((ts) => ts.filter((t) => t.id !== id));
      setDone((ds) => ds.filter((t) => t.id !== id));
    } else if (updated.status === "done") {
      setTasks((ts) => ts.filter((t) => t.id !== id));
      setDone((ds) => [updated, ...ds.filter((t) => t.id !== id)]);
    } else {
      setDone((ds) => ds.filter((t) => t.id !== id));
      setTasks((ts) => {
        const rest = ts.filter((t) => t.id !== id);
        return [...rest, updated];
      });
    }

    const supabase = createClient();
    const { error } = opts?.remove
      ? await supabase.from("personal_tasks").delete().eq("id", id)
      : await supabase
          .from("personal_tasks")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("id", id);
    if (error) {
      setTasks(prev);
      setDone(prevDone);
      alert(`Couldn't save: ${error.message}`);
    }
  }

  async function addTask() {
    const title = newTitle.trim();
    if (!title || adding) return;
    setAdding(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("personal_tasks")
      .insert({ owner_id: ownerId, title })
      .select("*")
      .single();
    setAdding(false);
    if (error || !data) {
      alert(`Couldn't add: ${error?.message ?? "unknown error"}`);
      return;
    }
    setTasks((ts) => [...ts, data as PersonalTask]);
    setNewTitle("");
  }

  const complete = (t: PersonalTask) =>
    patchTask(t.id, { status: "done", completed_at: new Date().toISOString() });
  const reopen = (t: PersonalTask) =>
    patchTask(t.id, { status: "open", completed_at: null });
  const snoozeTo = (t: PersonalTask, iso: string) =>
    patchTask(t.id, { status: "snoozed", snoozed_until: iso });

  return (
    <div className="mx-auto max-w-2xl">
      {/* Quick add — type, Enter, done. */}
      <div className="flex gap-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
          placeholder="Add something…"
          className="h-11 flex-1 rounded-xl border border-border bg-card px-4 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
        />
        <button
          onClick={addTask}
          disabled={!newTitle.trim() || adding}
          className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {tasks.length === 0 && (
        <p className="mt-10 text-center text-sm text-muted-foreground">
          Nothing on the list. Enjoy it while it lasts.
        </p>
      )}

      {SECTION_META.map(({ key, label, accent }) => {
        const items = buckets[key];
        if (items.length === 0) return null;
        return (
          <div key={key} className="mt-6">
            <h2 className={`text-xs font-semibold uppercase tracking-wider ${accent ?? "text-muted-foreground"}`}>
              {label} · {items.length}
            </h2>
            <ul className="mt-2 space-y-1.5">
              {items.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  bucket={key}
                  expanded={expanded === t.id}
                  onToggleExpand={() => setExpanded(expanded === t.id ? null : t.id)}
                  onComplete={() => complete(t)}
                  onSnooze={(iso) => snoozeTo(t, iso)}
                  onPatch={(patch) => patchTask(t.id, patch)}
                  onDelete={() => patchTask(t.id, {}, { remove: true })}
                />
              ))}
            </ul>
          </div>
        );
      })}

      {done.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowDone(!showDone)}
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Done recently · {done.length} {showDone ? "▾" : "▸"}
          </button>
          {showDone && (
            <ul className="mt-2 space-y-1.5">
              {done.map((t) => (
                <li key={t.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/50 px-3 py-2.5">
                  <button
                    onClick={() => reopen(t)}
                    title="Reopen"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary bg-primary text-primary-foreground"
                  >
                    <CheckIcon className="h-3 w-3" />
                  </button>
                  <span className="text-sm text-muted-foreground line-through">{t.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task,
  bucket,
  expanded,
  onToggleExpand,
  onComplete,
  onSnooze,
  onPatch,
  onDelete,
}: {
  task: PersonalTask;
  bucket: Bucket;
  expanded: boolean;
  onToggleExpand: () => void;
  onComplete: () => void;
  onSnooze: (iso: string) => void;
  onPatch: (patch: Partial<PersonalTask>) => void;
  onDelete: () => void;
}) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const age = daysOnList(task);

  return (
    <li className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          onClick={onComplete}
          title="Done"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/40 transition-colors hover:border-primary hover:bg-primary/10"
        >
          <CheckIcon className="h-3 w-3 opacity-0 transition-opacity hover:opacity-100" />
        </button>

        <button onClick={onToggleExpand} className="min-w-0 flex-1 text-left">
          <span className="flex items-center gap-2">
            {task.priority === "urgent" && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />}
            <span className="truncate text-sm">{task.title}</span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            {task.due_date && bucket !== "today" && <span>{formatShortDate(task.due_date)}</span>}
            {bucket === "snoozed" && task.snoozed_until && <span>until {formatShortDate(task.snoozed_until)}</span>}
            {task.source !== "manual" && <span className="rounded bg-accent px-1 py-px">auto</span>}
            {age >= 4 && <span className="text-amber-500">day {age}</span>}
          </span>
        </button>

        {task.href && (
          <a
            href={task.href}
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Open linked item"
          >
            <LinkIcon className="h-4 w-4" />
          </a>
        )}

        <div className="relative shrink-0">
          <button
            onClick={() => setSnoozeOpen(!snoozeOpen)}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Snooze"
          >
            <ClockIcon className="h-4 w-4" />
          </button>
          {snoozeOpen && (
            <div className="absolute right-0 top-9 z-20 w-36 rounded-xl border border-border bg-card p-1 shadow-lg">
              {[
                { label: "Tomorrow", iso: addDaysISO(1) },
                { label: "In 3 days", iso: addDaysISO(3) },
                { label: "Next Monday", iso: nextMondayISO() },
              ].map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => { setSnoozeOpen(false); onSnooze(opt.iso); }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-border/60 px-3 py-3">
          <textarea
            defaultValue={task.notes ?? ""}
            onBlur={(e) => e.target.value !== (task.notes ?? "") && onPatch({ notes: e.target.value || null })}
            placeholder="Notes…"
            rows={2}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input
              type="date"
              value={task.due_date ?? ""}
              onChange={(e) => onPatch({ due_date: e.target.value || null, status: "open" })}
              className="h-9 rounded-lg border border-border bg-background px-2 text-sm outline-none"
            />
            <button
              onClick={() => onPatch({ priority: task.priority === "urgent" ? "normal" : "urgent" })}
              className={`h-9 rounded-lg border px-3 text-sm ${task.priority === "urgent" ? "border-red-500/50 bg-red-500/10 text-red-500" : "border-border"}`}
            >
              Urgent
            </button>
            <button
              onClick={() => onPatch({ status: task.status === "waiting" ? "open" : "waiting" })}
              className={`h-9 rounded-lg border px-3 text-sm ${task.status === "waiting" ? "border-primary/50 bg-primary/10 text-primary" : "border-border"}`}
            >
              Waiting
            </button>
            <button
              onClick={() => confirm("Delete this task?") && onDelete()}
              className="ml-auto h-9 rounded-lg border border-border px-3 text-sm text-red-500 hover:bg-red-500/10"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
