"use client";

import { useState } from "react";

interface ActivityEvent {
  type: "status" | "note" | "time_start" | "time_end" | "work" | "checklist";
  description: string;
  staff: string | null;
  staffColour: string | null;
  staffInitials: string | null;
  timestamp: string;
}

export function ActivityLog({
  notes,
  timeEntries,
  workEntries,
  checklistItems,
}: {
  notes: any[];
  timeEntries: any[];
  workEntries: any[];
  checklistItems: any[];
}) {
  const [expanded, setExpanded] = useState(false);

  // Build unified activity feed from all data sources
  const events: ActivityEvent[] = [];

  // System notes = status changes & auto events
  for (const note of notes) {
    if (note.type === "system" || note.is_system) {
      events.push({
        type: "status",
        description: note.content,
        staff: note.staff?.display_name ?? null,
        staffColour: note.staff?.colour ?? null,
        staffInitials: note.staff?.initials ?? null,
        timestamp: note.created_at,
      });
    } else {
      events.push({
        type: "note",
        description: `Added note${note.title ? `: ${note.title}` : ""}`,
        staff: note.staff?.display_name ?? null,
        staffColour: note.staff?.colour ?? null,
        staffInitials: note.staff?.initials ?? null,
        timestamp: note.created_at,
      });
    }
  }

  // Time entries
  for (const entry of timeEntries) {
    events.push({
      type: "time_start",
      description: "Clocked in",
      staff: entry.staff?.display_name ?? null,
      staffColour: entry.staff?.colour ?? null,
      staffInitials: entry.staff?.initials ?? null,
      timestamp: entry.start_time,
    });
    if (entry.end_time) {
      const durationMs = new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime();
      const mins = Math.round(durationMs / 60000);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      events.push({
        type: "time_end",
        description: `Clocked out (${h}h ${m}m)`,
        staff: entry.staff?.display_name ?? null,
        staffColour: entry.staff?.colour ?? null,
        staffInitials: entry.staff?.initials ?? null,
        timestamp: entry.end_time,
      });
    }
  }

  // Work entries
  for (const entry of workEntries) {
    const lineCount = entry.content.split("\n").filter((l: string) => l.trim()).length;
    events.push({
      type: "work",
      description: `Added work entry (${lineCount} item${lineCount !== 1 ? "s" : ""})`,
      staff: entry.staff?.display_name ?? null,
      staffColour: entry.staff?.colour ?? null,
      staffInitials: entry.staff?.initials ?? null,
      timestamp: entry.created_at,
    });
  }

  // Checklist completions
  for (const item of checklistItems) {
    if (item.is_completed && item.completed_at) {
      events.push({
        type: "checklist",
        description: `Completed: ${item.title}`,
        staff: item.completed_by_text ?? null,
        staffColour: null,
        staffInitials: null,
        timestamp: item.completed_at,
      });
    }
  }

  // Sort newest first
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (events.length === 0) return null;

  const displayEvents = expanded ? events : events.slice(0, 8);

  const typeIcons: Record<string, { icon: string; colour: string }> = {
    status: { icon: "⟳", colour: "text-primary" },
    note: { icon: "✎", colour: "text-blue-400" },
    time_start: { icon: "▶", colour: "text-success" },
    time_end: { icon: "■", colour: "text-orange-400" },
    work: { icon: "✓", colour: "text-success" },
    checklist: { icon: "☑", colour: "text-success" },
  };

  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Activity
      </h2>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="divide-y divide-border">
          {displayEvents.map((event, i) => {
            const { colour } = typeIcons[event.type] ?? { colour: "text-muted-foreground" };
            const date = new Date(event.timestamp);

            return (
              <div key={i} className="flex items-start gap-3 px-4 py-2.5">
                {/* Staff avatar or type icon */}
                {event.staffInitials ? (
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-medium text-white"
                    style={{ backgroundColor: event.staffColour ?? "#6b7280" }}
                  >
                    {event.staffInitials}
                  </span>
                ) : (
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-xs ${colour}`}>
                    {typeIcons[event.type]?.icon ?? "·"}
                  </span>
                )}

                {/* Event description */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">
                    {event.staff && (
                      <span className="font-medium">{event.staff} </span>
                    )}
                    <span className="text-muted-foreground">{event.description}</span>
                  </p>
                </div>

                {/* Timestamp */}
                <span className="shrink-0 text-xs text-muted-foreground">
                  {date.toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}{" "}
                  {date.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            );
          })}
        </div>

        {events.length > 8 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full border-t border-border px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {expanded ? "Show less" : `Show all ${events.length} events`}
          </button>
        )}
      </div>
    </div>
  );
}
