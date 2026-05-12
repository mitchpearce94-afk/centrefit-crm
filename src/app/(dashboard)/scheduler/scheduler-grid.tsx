"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AssignJobModal } from "./assign-job-modal";

type EntryType = "job" | "event" | "reminder";
interface StaffMember { id: string; display_name: string; initials: string; colour: string; role: string; }
interface ScheduleEntry {
  id: string;
  job_id: string | null;
  staff_id: string;
  schedule_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  entry_type: EntryType;
  title: string | null;
  job?: { id: string; number: string; reference: string | null; customer?: { id: string; name: string }; site?: { id: string; name: string }; status?: { id: string; name: string; colour: string } } | null;
}
interface JobOption { id: string; number: string; reference: string | null; customer?: { id: string; name: string }; site?: { id: string; name: string }; status?: { id: string; name: string; colour: string }; }

const START_HOUR = 6;
const END_HOUR = 20;
const TOTAL_HOURS = END_HOUR - START_HOUR;
const HOUR_PX = 60;
const GRID_HEIGHT = TOTAL_HOURS * HOUR_PX;

function localISO(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function addDaysStr(d: string, n: number): string { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return localISO(x); }
function getMondayOf(d: string): string { const x = new Date(d + "T00:00:00"); const day = x.getDay(); x.setDate(x.getDate() - day + (day === 0 ? -6 : 1)); return localISO(x); }
function todayStr(): string { return localISO(new Date()); }
function isToday(d: string): boolean { return d === todayStr(); }
function timeMins(t: string): number { const [h, m] = t.split(":").map(Number); return h * 60 + m; }

// ── Lane layout for overlapping entries ────────────────────────────────────
// Given a set of timed entries in a single day column, assign each one a
// "lane" (column index) so overlapping entries render side-by-side rather
// than stacked. Returns each entry tagged with its lane and the total lane
// count of the cluster it belongs to (so render can compute width%).
//
// Algorithm: sort by start; walk through tracking a "current cluster" of
// entries whose extents still overlap. For each new entry, pick the lowest-
// index lane that's free in the cluster. When an entry's start is past the
// cluster's running max-end, flush the cluster (assign its lane count) and
// start a fresh one.
interface LaidOutEntry { entry: ScheduleEntry; lane: number; lanes: number; }
function layoutTimedEntries(entries: ScheduleEntry[]): LaidOutEntry[] {
  const sorted = [...entries]
    .filter((e) => e.start_time && e.end_time)
    .sort((a, b) => {
      const as = timeMins(a.start_time!);
      const bs = timeMins(b.start_time!);
      if (as !== bs) return as - bs;
      return timeMins(a.end_time!) - timeMins(b.end_time!);
    });

  const out: LaidOutEntry[] = [];
  let cluster: { entry: ScheduleEntry; lane: number }[] = [];
  let clusterEnd = -Infinity;

  function flush() {
    if (cluster.length === 0) return;
    const lanes = Math.max(...cluster.map((c) => c.lane)) + 1;
    for (const c of cluster) out.push({ entry: c.entry, lane: c.lane, lanes });
    cluster = [];
    clusterEnd = -Infinity;
  }

  for (const e of sorted) {
    const start = timeMins(e.start_time!);
    const end = timeMins(e.end_time!);
    if (cluster.length > 0 && start >= clusterEnd) flush();
    // Find the lowest free lane among entries in the cluster that are still active
    const used = new Set(
      cluster
        .filter((c) => timeMins(c.entry.end_time!) > start)
        .map((c) => c.lane),
    );
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ entry: e, lane });
    if (end > clusterEnd) clusterEnd = end;
  }
  flush();
  return out;
}
function fmtHour(h: number): string { if (h < 12) return `${h} AM`; if (h === 12) return "12 PM"; return `${h - 12} PM`; }
function fmtShort(d: string): string { return new Date(d + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" }); }
function fmtLong(d: string): string { return new Date(d + "T00:00:00").toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }

export function SchedulerView({ staff, entries, jobs, weekStart, currentUserId, isAdmin }: { staff: StaffMember[]; entries: ScheduleEntry[]; jobs: JobOption[]; weekStart: string; currentUserId: string; isAdmin: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [view, setView] = useState<"week" | "day">("week");
  const [selectedDay, setSelectedDay] = useState(todayStr());
  // Touch devices fall back to tap-to-open-modal because HTML5
  // draggable doesn't fire reliably on iOS/Android — a long-press
  // there triggers the OS text-selection menu, not a drag. Disabling
  // draggable on touch also stops the awkward iOS "drag preview"
  // ghost when you accidentally hold a block.
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Default to day view on phones — week view's 800px-wide grid forces
  // horizontal scroll and is unusable on a 375px viewport. Hydration-safe:
  // server + first client render are "week"; we flip after mount once we
  // can read the viewport. Brief frame of "week" on mobile is fine; what
  // we're avoiding is field techs having to manually toggle every time.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(max-width: 767px)").matches) setView("day");
    setIsTouchDevice(!window.matchMedia("(hover: hover)").matches);
  }, []);
  const [modal, setModal] = useState<{ staffId: string; date: string; startTime?: string; entry?: ScheduleEntry } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Drag-and-drop: move entry to new date/time
  async function handleDrop(entryId: string, newDate: string, newHour?: number) {
    if (!isAdmin) return;
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;

    const update: Record<string, unknown> = { schedule_date: newDate };
    if (newHour !== undefined && entry.start_time && entry.end_time) {
      const startMins = timeMins(entry.start_time);
      const endMins = timeMins(entry.end_time);
      const duration = endMins - startMins;
      const newStartMins = newHour * 60;
      const newEndMins = newStartMins + duration;
      update.start_time = `${String(Math.floor(newStartMins / 60)).padStart(2, "0")}:${String(newStartMins % 60).padStart(2, "0")}`;
      update.end_time = `${String(Math.floor(newEndMins / 60)).padStart(2, "0")}:${String(newEndMins % 60).padStart(2, "0")}`;
    }

    await supabase.from("schedule_entries").update(update).eq("id", entryId);
    setDraggingId(null);
    router.refresh();
  }

  const weekDates = useMemo(() => [0,1,2,3,4,5,6].map(i => addDaysStr(weekStart, i)), [weekStart]);
  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i);

  const { allDayByDate, timedByDate } = useMemo(() => {
    const allDay = new Map<string, ScheduleEntry[]>();
    const timed = new Map<string, ScheduleEntry[]>();
    for (const e of entries) {
      // Multi-day entries (end_date > schedule_date) render as all-day on
      // every date they span. Single-day entries with start/end times go on
      // the time grid; everything else lands in the all-day bar above.
      const isMultiDay = !!e.end_date && e.end_date > e.schedule_date;
      if (isMultiDay) {
        let cursor = e.schedule_date;
        while (cursor <= e.end_date!) {
          if (!allDay.has(cursor)) allDay.set(cursor, []);
          allDay.get(cursor)!.push(e);
          cursor = addDaysStr(cursor, 1);
        }
      } else if (e.start_time && e.end_time) {
        if (!timed.has(e.schedule_date)) timed.set(e.schedule_date, []);
        timed.get(e.schedule_date)!.push(e);
      } else {
        if (!allDay.has(e.schedule_date)) allDay.set(e.schedule_date, []);
        allDay.get(e.schedule_date)!.push(e);
      }
    }
    return { allDayByDate: allDay, timedByDate: timed };
  }, [entries]);

  const prevWeekHref = `/scheduler?week=${addDaysStr(weekStart, -7)}`;
  const nextWeekHref = `/scheduler?week=${addDaysStr(weekStart, 7)}`;
  const todayWeekHref = "/scheduler";

  function goDay(dir: "prev" | "next" | "today") {
    const target = dir === "today" ? todayStr() : addDaysStr(selectedDay, dir === "prev" ? -1 : 1);
    const mon = getMondayOf(target);
    if (mon !== weekStart) {
      window.location.href = `/scheduler?week=${mon}`;
      return;
    }
    setSelectedDay(target);
  }

  function switchToDay(date: string) {
    setSelectedDay(date);
    setView("day");
  }

  function switchToWeek() {
    setView("week");
  }

  function switchToDayView() {
    const today = todayStr();
    if (getMondayOf(today) !== weekStart) {
      window.location.href = "/scheduler";
      return;
    }
    setSelectedDay(today);
    setView("day");
  }

  function getStaff(e: ScheduleEntry) { return staff.find(s => s.id === e.staff_id); }
  function openAssign(date: string, hour?: number) {
    if (!isAdmin) return;
    setModal({ staffId: staff[0]?.id ?? "", date, startTime: hour !== undefined ? `${hour.toString().padStart(2,"0")}:00` : undefined });
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Heading + nav controls on a single row */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Scheduler</h1>
          <div className="flex rounded-md border border-border p-0.5">
            <button onClick={switchToWeek} className={`rounded px-3 py-1 text-xs font-medium transition-colors ${view === "week" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Week</button>
            <button onClick={switchToDayView} className={`rounded px-3 py-1 text-xs font-medium transition-colors ${view === "day" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Day</button>
          </div>
          {view === "week" ? (
            <div className="flex items-center gap-1">
              <a href={prevWeekHref} className="rounded-md border border-border px-2.5 py-1.5 text-muted-foreground hover:text-foreground transition-colors" aria-label="Previous week">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
              </a>
              <a href={todayWeekHref} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">Today</a>
              <a href={nextWeekHref} className="rounded-md border border-border px-2.5 py-1.5 text-muted-foreground hover:text-foreground transition-colors" aria-label="Next week">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
              </a>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={() => goDay("prev")} className="rounded-md border border-border px-2.5 py-1.5 text-muted-foreground hover:text-foreground transition-colors" aria-label="Previous day">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <button onClick={() => goDay("today")} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">Today</button>
              <button onClick={() => goDay("next")} className="rounded-md border border-border px-2.5 py-1.5 text-muted-foreground hover:text-foreground transition-colors" aria-label="Next day">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          )}
        </div>
        <span className="text-sm font-medium">{view === "week" ? `${fmtShort(weekDates[0])} — ${fmtShort(weekDates[6])}` : fmtLong(selectedDay)}</span>
      </div>

      {/* WEEK VIEW */}
      {view === "week" && (
        <div className="rounded-lg border border-border bg-card overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="overflow-x-auto flex-1 min-h-0 flex flex-col">
            <div className="min-w-[800px] flex-1 min-h-0 flex flex-col">
              {/* Day headers */}
              <div className="flex border-b border-border">
                <div className="w-16 shrink-0 border-r border-border bg-muted/50" />
                {weekDates.map(date => {
                  const d = new Date(date + "T00:00:00");
                  const today = isToday(date);
                  const allDay = allDayByDate.get(date) ?? [];
                  return (
                    <div key={date} className={`flex-1 border-r last:border-0 px-1.5 py-2 text-center min-w-[100px] cursor-pointer hover:bg-accent/30 ${today ? "bg-primary/10" : "bg-muted/50"}`} onClick={() => switchToDay(date)}>
                      <div className={`text-xs font-medium ${today ? "text-primary" : "text-muted-foreground"}`}>{d.toLocaleDateString("en-AU", { weekday: "short" })}</div>
                      <div className={`text-base font-bold ${today ? "text-primary" : ""}`}>{d.getDate()}</div>
                      {allDay.map(e => { const s = getStaff(e); const isJob = e.entry_type === "job"; return (
                        <button key={`${e.id}-${date}`} onClick={ev => { ev.stopPropagation(); setModal({ staffId: e.staff_id, date: e.schedule_date, entry: e }); }} className={`mt-1 w-full rounded px-1 py-0.5 text-[10px] font-medium text-white truncate text-left ${!isJob ? "border border-dashed border-white/40" : ""}`} style={{ backgroundColor: s?.colour ?? "#6b7280" }} title={isJob ? e.job?.number ?? "" : (e.title ?? "")}>
                          {isJob ? e.job?.number : (e.entry_type === "reminder" ? "⏰ " : "") + (e.title ?? "")}
                        </button>
                      ); })}
                    </div>
                  );
                })}
              </div>

              {/* Time grid */}
              <div className="overflow-y-auto flex-1 min-h-0">
                <div className="flex">
                  {/* Hour labels */}
                  <div className="w-16 shrink-0 border-r border-border" style={{ height: GRID_HEIGHT }}>
                    {hours.map(h => (
                      <div key={h} className="border-b border-border px-2 text-right" style={{ height: HOUR_PX }}>
                        <span className="text-[10px] text-muted-foreground">{fmtHour(h)}</span>
                      </div>
                    ))}
                  </div>

                  {/* Day columns with absolute-positioned entries */}
                  {weekDates.map(date => (
                    <DayCol key={date} date={date} hours={hours} entries={timedByDate.get(date) ?? []} getStaff={getStaff} isAdmin={isAdmin} isTouchDevice={isTouchDevice} onCellClick={openAssign} onEntryClick={e => setModal({ staffId: e.staff_id, date, entry: e })} onDrop={handleDrop} draggingId={draggingId} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DAY VIEW */}
      {view === "day" && (
        <div className="rounded-lg border border-border bg-card overflow-hidden flex-1 min-h-0 flex flex-col">
          {(allDayByDate.get(selectedDay) ?? []).length > 0 && (
            <div className="border-b border-border px-4 py-2 bg-muted/30">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">All Day</span>
              <div className="mt-1 space-y-1">
                {(allDayByDate.get(selectedDay) ?? []).map(e => { const s = getStaff(e); const isJob = e.entry_type === "job"; return (
                  <button key={`${e.id}-${selectedDay}`} onClick={() => setModal({ staffId: e.staff_id, date: e.schedule_date, entry: e })} className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-white ${!isJob ? "border border-dashed border-white/40" : ""}`} style={{ backgroundColor: s?.colour ?? "#6b7280" }}>
                    {s?.initials} · {isJob ? `${e.job?.number} — ${e.job?.customer?.name ?? ""}` : `${e.entry_type === "reminder" ? "⏰ " : ""}${e.title ?? ""}`}
                  </button>
                ); })}
              </div>
            </div>
          )}
          <div className="overflow-y-auto flex-1 min-h-0">
            <div className="flex">
              <div className="w-16 shrink-0 border-r border-border" style={{ height: GRID_HEIGHT }}>
                {hours.map(h => (
                  <div key={h} className="border-b border-border px-2 text-right" style={{ height: HOUR_PX }}>
                    <span className="text-xs text-muted-foreground">{fmtHour(h)}</span>
                  </div>
                ))}
              </div>
              <DayCol date={selectedDay} hours={hours} entries={timedByDate.get(selectedDay) ?? []} getStaff={getStaff} isAdmin={isAdmin} isTouchDevice={isTouchDevice} onCellClick={openAssign} onEntryClick={e => setModal({ staffId: e.staff_id, date: selectedDay, entry: e })} onDrop={handleDrop} draggingId={draggingId} />
            </div>
          </div>
          <button onClick={switchToWeek} className="w-full border-t border-border px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">← Back to week</button>
        </div>
      )}

      <p className="mt-2 text-[10px] text-muted-foreground">{entries.length} entries this week</p>

      {modal && (
        <AssignJobModal staffId={modal.staffId} date={modal.date} entry={modal.entry} jobs={jobs} staff={staff} staffName={staff.find(s => s.id === modal.staffId)?.display_name ?? ""} defaultStartTime={modal.startTime} onClose={() => setModal(null)} onSaved={() => { setModal(null); router.refresh(); }} />
      )}
    </div>
  );
}

/* Day column — explicit height, entries absolutely positioned to span full time range */
function DayCol({ date, hours, entries, getStaff, isAdmin, isTouchDevice, onCellClick, onEntryClick, onDrop, draggingId }: {
  date: string; hours: number[]; entries: ScheduleEntry[]; getStaff: (e: ScheduleEntry) => StaffMember | undefined;
  isAdmin: boolean; isTouchDevice: boolean; onCellClick: (date: string, hour: number) => void; onEntryClick: (e: ScheduleEntry) => void;
  onDrop?: (entryId: string, date: string, hour: number) => void; draggingId?: string | null;
}) {
  const today = isToday(date);

  return (
    <div
      className={`flex-1 border-r border-border last:border-0 min-w-[100px] ${today ? "bg-primary/[0.03]" : ""}`}
      style={{ position: "relative", height: GRID_HEIGHT }}
    >
      {/* Hour grid lines + click targets + drop zones */}
      {hours.map((h, i) => (
        <div
          key={h}
          className="border-b border-border cursor-pointer hover:bg-accent/20 transition-colors"
          style={{ position: "absolute", top: i * HOUR_PX, left: 0, right: 0, height: HOUR_PX }}
          onClick={() => onCellClick(date, h)}
          onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("bg-primary/10"); }}
          onDragLeave={e => { e.currentTarget.classList.remove("bg-primary/10"); }}
          onDrop={e => {
            e.preventDefault();
            e.currentTarget.classList.remove("bg-primary/10");
            const entryId = e.dataTransfer.getData("text/plain");
            if (entryId && onDrop) onDrop(entryId, date, h);
          }}
        />
      ))}

      {/* Entry blocks — laid out into side-by-side lanes for overlapping times */}
      {layoutTimedEntries(entries).map(({ entry, lane, lanes }) => {
        const startMin = timeMins(entry.start_time!) - START_HOUR * 60;
        const endMin = timeMins(entry.end_time!) - START_HOUR * 60;
        const top = Math.max(0, (startMin / 60) * HOUR_PX);
        const height = Math.max(((endMin - startMin) / 60) * HOUR_PX, 28);
        const s = getStaff(entry);
        const staffColour = s?.colour ?? "#6b7280";
        const isJob = entry.entry_type === "job";
        // Job entries get a status-coloured left border; events/reminders use
        // the staff colour with a dashed border so they're visually distinct
        // from real work.
        const leftBorderColour = isJob ? (entry.job?.status?.colour ?? "#6b7280") : staffColour;
        // Lane-based horizontal layout. When only one lane in the cluster
        // we keep the original 4px gutters; once it splits we use percent
        // widths and tighter gutters so initials + job # still fit.
        const gutter = lanes > 1 ? 2 : 4;
        const leftStyle =
          lanes > 1
            ? `calc(${(lane * 100) / lanes}% + ${gutter}px)`
            : `${gutter}px`;
        const widthStyle =
          lanes > 1
            ? `calc(${100 / lanes}% - ${gutter * 2}px)`
            : `calc(100% - ${gutter * 2}px)`;

        return (
          <div
            key={entry.id}
            draggable={isAdmin && !isTouchDevice}
            onDragStart={e => { e.dataTransfer.setData("text/plain", entry.id); e.dataTransfer.effectAllowed = "move"; }}
            onDragOver={e => { e.preventDefault(); }}
            onDrop={e => {
              e.preventDefault();
              e.stopPropagation();
              const eid = e.dataTransfer.getData("text/plain");
              const rect = e.currentTarget.parentElement!.getBoundingClientRect();
              const y = e.clientY - rect.top;
              const hour = Math.floor(y / HOUR_PX) + START_HOUR;
              if (eid && onDrop) onDrop(eid, date, hour);
            }}
            className={`rounded-md border overflow-hidden cursor-pointer hover:brightness-110 transition-all ${draggingId === entry.id ? "opacity-40" : ""} ${!isJob ? "border-dashed" : ""}`}
            style={{
              position: "absolute",
              top,
              height,
              left: leftStyle,
              width: widthStyle,
              zIndex: 10,
              backgroundColor: `${staffColour}18`,
              borderColor: `${staffColour}50`,
              borderLeftWidth: 3,
              borderLeftColor: leftBorderColour,
              borderLeftStyle: isJob ? "solid" : "dashed",
            }}
            onClick={e => { e.stopPropagation(); onEntryClick(entry); }}
          >
            <div className={`px-2 py-1 h-full flex flex-col ${lanes > 2 ? "px-1" : ""}`}>
              <div className="flex items-center gap-1.5">
                {s && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: staffColour }}>
                    {s.initials}
                  </span>
                )}
                <span className="text-xs font-semibold truncate">
                  {isJob
                    ? <span className="font-mono">{entry.job?.number}</span>
                    : <>{entry.entry_type === "reminder" ? "⏰ " : ""}{entry.title}</>}
                </span>
              </div>
              {height > 44 && isJob && lanes < 3 && (
                <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                  {entry.job?.customer?.name}{entry.job?.site ? ` · ${entry.job.site.name}` : ""}
                </p>
              )}
              {height > 64 && lanes < 3 && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {entry.start_time?.slice(0,5)} - {entry.end_time?.slice(0,5)}
                </p>
              )}
              {height > 100 && entry.notes && lanes === 1 && (
                <p className="text-[9px] text-muted-foreground mt-auto italic truncate">{entry.notes}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
