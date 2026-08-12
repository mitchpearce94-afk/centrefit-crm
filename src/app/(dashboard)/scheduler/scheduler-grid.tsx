"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
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
  recurrence_group_id: string | null;
  recurrence_pattern: "weekly" | "fortnightly" | "monthly" | null;
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
interface LaidOutEntry { entry: ScheduleEntry; lane: number; lanes: number; cluster: number; }
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
  let clusterIdx = 0;

  function flush() {
    if (cluster.length === 0) return;
    const lanes = Math.max(...cluster.map((c) => c.lane)) + 1;
    for (const c of cluster) out.push({ entry: c.entry, lane: c.lane, lanes, cluster: clusterIdx });
    clusterIdx++;
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
  const searchParams = useSearchParams();
  // Seed `view` from the URL so the week-nav arrows (which do a full
  // navigation) preserve the user's choice. Without this, switching to
  // Week on mobile then clicking "next week" landed back in Day view
  // because the mobile-default-to-day mount effect re-fired.
  const urlView = searchParams.get("view");
  const initialView: "week" | "day" = urlView === "day" || urlView === "week" ? urlView : "week";
  const [view, setView] = useState<"week" | "day">(initialView);
  // ?day= carries the target day across week-boundary navigations (swiping/
  // clicking from Sunday into Monday does a full nav) — without it the day
  // view always landed back on "today", which could be a different week
  // entirely.
  const urlDay = searchParams.get("day");
  const [selectedDay, setSelectedDay] = useState(
    urlDay && /^\d{4}-\d{2}-\d{2}$/.test(urlDay) ? urlDay : todayStr(),
  );
  // Touch devices fall back to tap-to-open-modal because HTML5
  // draggable doesn't fire reliably on iOS/Android — a long-press
  // there triggers the OS text-selection menu, not a drag. Disabling
  // draggable on touch also stops the awkward iOS "drag preview"
  // ghost when you accidentally hold a block.
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Default to day view on phones — week view's 800px-wide grid forces
  // horizontal scroll and is unusable on a 375px viewport. Hydration-safe:
  // server + first client render are "week"; we flip after mount once we
  // can read the viewport. Only force "day" when the URL doesn't already
  // specify a view — otherwise a user who explicitly picked Week on mobile
  // would get bounced back to Day every time the week arrows navigate.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!urlView && window.matchMedia("(max-width: 767px)").matches) setView("day");
    setIsTouchDevice(!window.matchMedia("(hover: hover)").matches);
    // urlView is captured at mount — re-running on URL change would
    // override the user's in-session toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [modal, setModal] = useState<{ staffId: string; date: string; startTime?: string; entry?: ScheduleEntry; siblings?: ScheduleEntry[]; defaultJobId?: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Open an entry with its whole "tile group" — every row for the same job
  // (or same event title+times) on the same date. The modal edits the group:
  // untick a person to remove just their tile, no "primary" anywhere.
  function openEntry(e: ScheduleEntry) {
    const siblings = entries.filter((x) =>
      x.schedule_date === e.schedule_date &&
      x.entry_type === e.entry_type &&
      (e.entry_type === "job"
        ? x.job_id === e.job_id
        : x.title === e.title && x.start_time === e.start_time && x.end_time === e.end_time),
    );
    setModal({ staffId: e.staff_id, date: e.schedule_date, entry: e, siblings });
  }

  const weekDates = useMemo(() => [0,1,2,3,4,5,6].map(i => addDaysStr(weekStart, i)), [weekStart]);

  // Day-view pager: the 7 days render side-by-side in a snap-scroll strip,
  // so swiping through days is native smooth scrolling with momentum, not a
  // jump per swipe. selectedDay follows the settled panel; button nav
  // smooth-scrolls the strip to the target day.
  const pagerRef = useRef<HTMLDivElement>(null);
  const pagerSettleTimer = useRef<number | null>(null);

  useEffect(() => {
    if (view !== "day") return;
    const el = pagerRef.current;
    if (!el) return;
    const idx = weekDates.indexOf(selectedDay);
    // selectedDay outside the visible week (stale URL, deep link) — clamp to
    // Monday so the banner and the visible panel always agree.
    if (idx < 0) { setSelectedDay(weekDates[0]); return; }
    const target = idx * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) < 4) return;
    // Long hops (initial mount, Today from far away) jump instantly;
    // single-day moves glide.
    const behavior: ScrollBehavior =
      Math.abs(el.scrollLeft - target) > el.clientWidth * 1.5 ? "auto" : "smooth";
    el.scrollTo({ left: target, behavior });
  }, [view, selectedDay, weekDates]);

  function onPagerScroll() {
    if (pagerSettleTimer.current) window.clearTimeout(pagerSettleTimer.current);
    pagerSettleTimer.current = window.setTimeout(() => {
      const el = pagerRef.current;
      if (!el || el.clientWidth === 0) return;
      const idx = Math.max(0, Math.min(6, Math.round(el.scrollLeft / el.clientWidth)));
      const d = weekDates[idx];
      if (d && d !== selectedDay) setSelectedDay(d);
    }, 120);
  }

  // Auto-open the assign modal when arriving from a job detail page with
  // ?jobId=… so the user lands ready to pick date/staff/time. Runs once on
  // mount; we strip the param off the URL afterwards so a refresh doesn't
  // re-trigger and so back-nav lands cleanly.
  useEffect(() => {
    const jobId = searchParams.get("jobId");
    if (!jobId) return;
    if (!isAdmin) return;
    // Only auto-open if the job exists in the list — otherwise the dropdown
    // can't pre-select it. Stale URLs just fall through to the normal grid.
    if (!jobs.some((j) => j.id === jobId)) return;
    setModal({
      staffId: "",
      date: todayStr(),
      defaultJobId: jobId,
    });
    const url = new URL(window.location.href);
    url.searchParams.delete("jobId");
    window.history.replaceState({}, "", url.toString());
    // Intentionally empty deps — this is a mount-only effect that reads the
    // initial URL. searchParams object reference changes on every render but
    // we don't want to re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i);

  const { untimedByDate, timedByDate } = useMemo(() => {
    // Two pools per day (2026-08-12 rework, Mitchell's call): entries with
    // real times sit on the time axis; entries WITHOUT times stack as
    // full-width chips under the day header instead of masquerading as
    // 6am–4pm blocks. The old normalisation made every untimed job overlap
    // every other one, so a busy day lane-split the column into unreadable
    // slivers. Multi-day entries repeat on each day of their span.
    const untimed = new Map<string, ScheduleEntry[]>();
    const timed = new Map<string, ScheduleEntry[]>();
    for (const e of entries) {
      const isMultiDay = !!e.end_date && e.end_date > e.schedule_date;
      const pool = e.start_time && e.end_time ? timed : untimed;
      let cursor = e.schedule_date;
      const lastDay = isMultiDay ? e.end_date! : e.schedule_date;
      while (cursor <= lastDay) {
        if (!pool.has(cursor)) pool.set(cursor, []);
        pool.get(cursor)!.push(e);
        cursor = addDaysStr(cursor, 1);
      }
    }
    // Stable chip order: group by staff (roster order), then job number, so
    // the same tech's work reads top-to-bottom in one colour block.
    const staffOrder = new Map(staff.map((s, i) => [s.id, i]));
    for (const list of untimed.values()) {
      list.sort((a, b) => {
        const so = (staffOrder.get(a.staff_id) ?? 99) - (staffOrder.get(b.staff_id) ?? 99);
        if (so !== 0) return so;
        return (a.job?.number ?? a.title ?? "").localeCompare(b.job?.number ?? b.title ?? "");
      });
    }
    return { untimedByDate: untimed, timedByDate: timed };
  }, [entries, staff]);

  // Keep `view` in the URL so a full navigation (next-week arrow, cross-week
  // day-nav) doesn't drop the user's view choice.
  const viewQuery = `view=${view}`;
  const prevWeekHref = `/scheduler?week=${addDaysStr(weekStart, -7)}&${viewQuery}`;
  const nextWeekHref = `/scheduler?week=${addDaysStr(weekStart, 7)}&${viewQuery}`;
  const todayWeekHref = `/scheduler?${viewQuery}`;

  function updateViewParam(next: "week" | "day") {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState({}, "", url.toString());
  }

  function goDay(dir: "prev" | "next" | "today") {
    const target = dir === "today" ? todayStr() : addDaysStr(selectedDay, dir === "prev" ? -1 : 1);
    const mon = getMondayOf(target);
    if (mon !== weekStart) {
      window.location.href = `/scheduler?week=${mon}&${viewQuery}&day=${target}`;
      return;
    }
    setSelectedDay(target);
  }

  function switchToDay(date: string) {
    setSelectedDay(date);
    setView("day");
    updateViewParam("day");
  }

  function switchToWeek() {
    setView("week");
    updateViewParam("week");
  }

  function switchToDayView() {
    const today = todayStr();
    if (getMondayOf(today) !== weekStart) {
      window.location.href = `/scheduler?view=day`;
      return;
    }
    setSelectedDay(today);
    setView("day");
    updateViewParam("day");
  }

  function getStaff(e: ScheduleEntry) { return staff.find(s => s.id === e.staff_id); }
  function openAssign(date: string, hour?: number) {
    if (!isAdmin) return;
    // No preselected staff — the old staff[0] default silently made whoever
    // sorted first the "primary" on every new entry.
    setModal({ staffId: "", date, startTime: hour !== undefined ? `${hour.toString().padStart(2,"0")}:00` : undefined });
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
            // Day nav buttons are desktop-only — on mobile, swiping moves
            // days and the floating pill jumps to today, so the header stays
            // one clean row.
            <div className="hidden lg:flex items-center gap-1">
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
        {/* One date, one place: desktop shows it here; mobile day view has
            the banner, mobile agenda has per-day headers. */}
        <span className="hidden lg:inline text-sm font-medium">{view === "week" ? `${fmtShort(weekDates[0])} — ${fmtShort(weekDates[6])}` : fmtLong(selectedDay)}</span>
      </div>

      {/* WEEK VIEW — desktop: time grid. Mobile: agenda list (below); the
          800px grid was unreadable slivers on a phone. */}
      {view === "week" && (
        <div className="rounded-lg border border-border bg-card overflow-hidden flex-1 min-h-0 hidden lg:flex flex-col">
          <div className="overflow-x-auto flex-1 min-h-0 flex flex-col">
            <div className="min-w-[800px] flex-1 min-h-0 flex flex-col">
              {/* Day headers + stacked untimed chips. The chips live up here
                  (full column width, one per row) so they never lane-split —
                  that's what makes a full week readable. */}
              <div className="flex border-b border-border">
                <div className="w-16 shrink-0 border-r border-border bg-muted/50" />
                {weekDates.map(date => {
                  const d = new Date(date + "T00:00:00");
                  const today = isToday(date);
                  const dayUntimed = untimedByDate.get(date) ?? [];
                  return (
                    <div key={date} className={`flex-1 border-r last:border-0 px-1 py-2 text-center min-w-[100px] cursor-pointer hover:bg-accent/30 ${today ? "bg-primary/10" : "bg-muted/50"}`} onClick={() => switchToDay(date)}>
                      <div className={`text-xs font-medium ${today ? "text-primary" : "text-muted-foreground"}`}>{d.toLocaleDateString("en-AU", { weekday: "short" })}</div>
                      <div className={`text-base font-bold ${today ? "text-primary" : ""}`}>
                        {d.getDate()}{" "}
                        <span className={`text-[10px] font-semibold ${today ? "text-primary/80" : "text-muted-foreground"}`}>
                          {d.toLocaleDateString("en-AU", { month: "short" })}
                        </span>
                      </div>
                      {dayUntimed.map(e => {
                        const s = getStaff(e);
                        const isJob = e.entry_type === "job";
                        const label = isJob
                          ? (e.job?.site?.name ?? e.job?.customer?.name ?? e.job?.number ?? "")
                          : (e.entry_type === "reminder" ? "⏰ " : "") + (e.title ?? "");
                        return (
                          <button
                            key={`${e.id}-${date}`}
                            onClick={ev => { ev.stopPropagation(); openEntry(e); }}
                            className={`mt-1 flex w-full items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-white text-left ${!isJob ? "border border-dashed border-white/40" : ""}`}
                            style={{ backgroundColor: s?.colour ?? "#6b7280" }}
                            title={`${s?.display_name ?? ""} — ${isJob ? `${e.job?.number ?? ""} ${label}` : label}`}
                          >
                            <span className="shrink-0 font-bold opacity-90">{s?.initials}</span>
                            <span className="truncate">{label}</span>
                          </button>
                        );
                      })}
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
                    <DayCol key={date} date={date} hours={hours} entries={timedByDate.get(date) ?? []} getStaff={getStaff} isAdmin={isAdmin} isTouchDevice={isTouchDevice} onCellClick={openAssign} onEntryClick={openEntry} onDrop={handleDrop} draggingId={draggingId} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* WEEK VIEW — mobile agenda: seven stacked day sections, full-width
          cards, nothing truncated to slivers. Tap a day header for day view,
          tap a card to edit its tile group. */}
      {view === "week" && (
        <div className="lg:hidden rounded-lg border border-border bg-card overflow-y-auto flex-1 min-h-0">
          {weekDates.map(date => {
            const d = new Date(date + "T00:00:00");
            const today = isToday(date);
            const dayUntimed = untimedByDate.get(date) ?? [];
            const dayTimed = (timedByDate.get(date) ?? []).slice().sort((a, b) => timeMins(a.start_time!) - timeMins(b.start_time!));
            const items = [...dayUntimed, ...dayTimed];
            return (
              <div key={date}>
                <button
                  onClick={() => switchToDay(date)}
                  className={`sticky top-0 z-10 flex w-full items-baseline gap-2 border-b border-l-2 border-b-border px-3 py-2 text-left ${today ? "border-l-primary bg-primary/25" : "border-l-primary/60 bg-primary/10"}`}
                >
                  <span className="text-sm font-bold text-primary">{d.toLocaleDateString("en-AU", { weekday: "long" })}</span>
                  <span className="text-xs font-semibold text-primary/70">
                    {d.getDate()} {d.toLocaleDateString("en-AU", { month: "short" })}
                  </span>
                  {today && <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold text-primary-foreground">TODAY</span>}
                </button>
                {items.length === 0 ? (
                  <p className="px-3 py-2.5 text-xs text-muted-foreground/50">Nothing scheduled</p>
                ) : (
                  items.map(e => {
                    const s = getStaff(e);
                    const isJob = e.entry_type === "job";
                    const primary = isJob
                      ? (e.job?.site?.name ?? e.job?.customer?.name ?? e.job?.number ?? "")
                      : (e.entry_type === "reminder" ? "⏰ " : "") + (e.title ?? "");
                    const timeLabel = e.start_time && e.end_time
                      ? `${e.start_time.slice(0, 5)}–${e.end_time.slice(0, 5)}`
                      : "All day";
                    return (
                      <button
                        key={`${e.id}-${date}`}
                        onClick={() => openEntry(e)}
                        className="flex w-full items-center gap-2.5 border-b border-border/60 px-3 py-2.5 text-left active:bg-accent"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: s?.colour ?? "#6b7280" }}>
                          {s?.initials}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{primary}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {isJob && <span className="font-mono">{e.job?.number}</span>}
                            {isJob ? " · " : ""}{timeLabel}
                            {e.recurrence_group_id ? " · ↻" : ""}
                          </span>
                        </span>
                        {isJob && e.job?.status && (
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: e.job.status.colour }} />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* DAY VIEW — days render as a snap-scroll pager: swipe glides
          between them with native momentum. */}
      {view === "day" && (
        <div className="rounded-lg border border-border bg-card overflow-hidden flex-1 min-h-0 flex flex-col">
          {/* Date banner (mobile only — desktop shows the date in the page
              header). Updates as the pager settles on a day. */}
          <div className={`lg:hidden border-b border-border px-4 py-1.5 text-xs font-semibold ${isToday(selectedDay) ? "bg-primary/10 text-primary" : "bg-muted/40"}`}>
            {fmtLong(selectedDay)}
          </div>
          {(untimedByDate.get(selectedDay) ?? []).length > 0 && (
            <div className="border-b border-border px-4 py-2 bg-muted/30">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">All Day</span>
              <div className="mt-1 space-y-1">
                {(untimedByDate.get(selectedDay) ?? []).map(e => { const s = getStaff(e); const isJob = e.entry_type === "job"; return (
                  <button key={`${e.id}-${selectedDay}`} onClick={() => openEntry(e)} className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-white ${!isJob ? "border border-dashed border-white/40" : ""}`} style={{ backgroundColor: s?.colour ?? "#6b7280" }}>
                    <span className="font-bold">{s?.initials}</span>
                    <span className="truncate">
                      {isJob ? `${e.job?.site?.name ?? e.job?.customer?.name ?? ""} — ${e.job?.number ?? ""}` : `${e.entry_type === "reminder" ? "⏰ " : ""}${e.title ?? ""}`}
                    </span>
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
              {/* Snap pager: hour labels stay put on the left; the seven day
                  panels scroll horizontally beside them with snap points. */}
              <div
                ref={pagerRef}
                onScroll={onPagerScroll}
                className="flex-1 min-w-0 flex overflow-x-auto snap-x snap-mandatory overscroll-x-contain [&::-webkit-scrollbar]:hidden"
                style={{ scrollbarWidth: "none" }}
              >
                {weekDates.map(date => (
                  <div key={date} className="w-full min-w-full snap-center flex">
                    <DayCol date={date} hours={hours} entries={timedByDate.get(date) ?? []} getStaff={getStaff} isAdmin={isAdmin} isTouchDevice={isTouchDevice} onCellClick={openAssign} onEntryClick={openEntry} onDrop={handleDrop} draggingId={draggingId} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <button onClick={switchToWeek} className="w-full border-t border-border px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">← Back to week</button>

          {/* Floating "Today" pill (mobile) — thumb-reachable jump back. */}
          {selectedDay !== todayStr() && (
            <button
              onClick={() => goDay("today")}
              className="lg:hidden fixed bottom-24 left-1/2 -translate-x-1/2 z-40 rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-xl active:scale-95 transition-transform"
            >
              Today
            </button>
          )}
        </div>
      )}

      <p className="mt-2 text-[10px] text-muted-foreground">{entries.length} entries this week</p>

      {modal && (
        <AssignJobModal staffId={modal.staffId} date={modal.date} entry={modal.entry} siblings={modal.siblings} jobs={jobs} staff={staff} defaultStartTime={modal.startTime} defaultJobId={modal.defaultJobId} onClose={() => setModal(null)} onSaved={() => { setModal(null); router.refresh(); }} />
      )}
    </div>
  );
}

/* Day column — explicit height, entries absolutely positioned to span full time range.
   Every entry always renders (Mitchell's call 2026-08-13: no "+N more"
   collapse — hidden tiles are how jobs get missed). Genuine time overlaps
   share the column width; the hover popover carries full detail on slim
   tiles. */
function DayCol({ date, hours, entries, getStaff, isAdmin, isTouchDevice, onCellClick, onEntryClick, onDrop, draggingId }: {
  date: string; hours: number[]; entries: ScheduleEntry[]; getStaff: (e: ScheduleEntry) => StaffMember | undefined;
  isAdmin: boolean; isTouchDevice: boolean;
  onCellClick: (date: string, hour: number) => void; onEntryClick: (e: ScheduleEntry) => void;
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

      {/* Entry blocks — side-by-side lanes for overlapping times; every
          entry renders, nothing collapses out of sight */}
      {layoutTimedEntries(entries).map(({ entry, lane, lanes }) => (
        <TimedEntryBlock
          key={entry.id}
          entry={entry}
          lane={lane}
          lanes={lanes}
          date={date}
          staff={getStaff(entry)}
          isAdmin={isAdmin}
          isTouchDevice={isTouchDevice}
          draggingId={draggingId}
          onEntryClick={onEntryClick}
          onDrop={onDrop}
        />
      ))}
    </div>
  );
}

/* Standalone timed-entry pill — owns its own hover-popover state so we can
   render the popover via React portal at document.body. The previous inline
   group-hover popover inherited the parent pill's CSS filter
   (hover:brightness-110) and translucent backgroundColor, which composited
   through to the popover and looked like transparency to Sue. Portal escapes
   all parent stacking influence. */
function TimedEntryBlock({
  entry, lane, lanes, date, staff, isAdmin, isTouchDevice, draggingId, onEntryClick, onDrop,
}: {
  entry: ScheduleEntry;
  lane: number;
  lanes: number;
  date: string;
  staff: StaffMember | undefined;
  isAdmin: boolean;
  isTouchDevice: boolean;
  draggingId?: string | null;
  onEntryClick: (e: ScheduleEntry) => void;
  onDrop?: (entryId: string, date: string, hour: number) => void;
}) {
  void date;
  void onDrop;
  const triggerRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  function showPopover() {
    if (isTouchDevice) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Right of the pill by default; flip to left if not enough room.
    const POPOVER_WIDTH = 256;
    const margin = 8;
    const wantRight = rect.right + margin + POPOVER_WIDTH < window.innerWidth;
    setPopoverPos({
      top: rect.top,
      left: wantRight ? rect.right + margin : rect.left - POPOVER_WIDTH - margin,
    });
  }
  function hidePopover() {
    setPopoverPos(null);
  }

  const startMin = timeMins(entry.start_time!) - START_HOUR * 60;
  const endMin = timeMins(entry.end_time!) - START_HOUR * 60;
  const topPx = Math.max(0, (startMin / 60) * HOUR_PX);
  const height = Math.max(((endMin - startMin) / 60) * HOUR_PX, 28);
  const s = staff;
  const staffColour = s?.colour ?? "#6b7280";
  const isJob = entry.entry_type === "job";
  const leftBorderColour = isJob ? (entry.job?.status?.colour ?? "#6b7280") : staffColour;
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
    <>
      <div
        ref={triggerRef}
        draggable={isAdmin && !isTouchDevice}
        onDragStart={e => { e.dataTransfer.setData("text/plain", entry.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragOver={e => { e.preventDefault(); }}
        onMouseEnter={showPopover}
        onMouseLeave={hidePopover}
        className={`rounded-md border cursor-pointer hover:brightness-110 transition-all ${draggingId === entry.id ? "opacity-40" : ""} ${!isJob ? "border-dashed" : ""}`}
        style={{
          position: "absolute",
          top: topPx,
          height,
          left: leftStyle,
          width: widthStyle,
          zIndex: 10,
          backgroundColor: `${staffColour}2E`,
          borderColor: `${staffColour}70`,
          borderLeftWidth: 3,
          borderLeftColor: leftBorderColour,
          borderLeftStyle: isJob ? "solid" : "dashed",
        }}
        onClick={e => { e.stopPropagation(); onEntryClick(entry); }}
      >
        <div className={`px-2 py-1 h-full flex flex-col overflow-hidden rounded-md ${lanes > 2 ? "px-1" : ""}`}>
          <div className="flex items-center gap-1.5">
            {s && (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: staffColour }}>
                {s.initials}
              </span>
            )}
            {/* Site/customer first — that's what identifies the job at a
                glance; the number is detail, not identity. */}
            <span className="text-xs font-semibold truncate">
              {isJob
                ? (entry.job?.site?.name ?? entry.job?.customer?.name ?? entry.job?.number)
                : <>{entry.entry_type === "reminder" ? "⏰ " : ""}{entry.title}</>}
            </span>
            {entry.recurrence_group_id && (
              <span
                className="text-[10px] opacity-70"
                title={`Recurring — ${entry.recurrence_pattern ?? "series"}`}
              >
                ↻
              </span>
            )}
          </div>
          {height > 44 && isJob && lanes < 3 && (
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">
              <span className="font-mono">{entry.job?.number}</span>
              {height <= 64 && entry.start_time ? ` · ${entry.start_time.slice(0,5)}–${entry.end_time?.slice(0,5)}` : ""}
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

      {/* Portal'd hover popover — escapes the parent pill's stacking
          context (CSS filter + translucent bg) so it renders genuinely
          opaque against the page, not composited with the entry. */}
      {mounted && popoverPos && createPortal(
        <div
          className="fixed pointer-events-none w-64 rounded-lg border-2 border-primary/70 px-3 py-2.5 shadow-2xl"
          style={{
            top: popoverPos.top,
            left: popoverPos.left,
            zIndex: 9999,
            backgroundColor: "#1c1c2a",
            color: "#f4f4f8",
            opacity: 1,
          }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            {s && (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: staffColour }}>
                {s.initials}
              </span>
            )}
            <span className="text-xs font-medium opacity-70 truncate">
              {s?.display_name ?? "—"}
            </span>
          </div>
          {isJob ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-sm font-semibold">{entry.job?.number}</span>
                {entry.job?.status && (
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                    style={{ backgroundColor: `${entry.job.status.colour}30`, color: entry.job.status.colour }}
                  >
                    {entry.job.status.name}
                  </span>
                )}
              </div>
              {entry.job?.reference && (
                <p className="mt-0.5 text-xs opacity-70 truncate">{entry.job.reference}</p>
              )}
              <div className="mt-1.5 space-y-0.5 text-xs">
                <p className="font-medium truncate">{entry.job?.site?.name ?? entry.job?.customer?.name ?? "—"}</p>
              </div>
            </>
          ) : (
            <p className="text-sm font-semibold">
              {entry.entry_type === "reminder" ? "⏰ " : ""}{entry.title ?? "Untitled"}
            </p>
          )}
          {(entry.start_time || entry.end_time) && (
            <p className="mt-1.5 text-[11px] opacity-70">
              {entry.start_time?.slice(0, 5)}{entry.end_time ? ` – ${entry.end_time.slice(0, 5)}` : ""}
            </p>
          )}
          {entry.recurrence_group_id && entry.recurrence_pattern && (
            <p className="mt-1.5 text-[11px] text-primary">
              ↻ Recurring {entry.recurrence_pattern}
            </p>
          )}
          {entry.notes && (
            <p className="mt-1.5 border-t border-white/10 pt-1.5 text-[11px] italic opacity-70 line-clamp-3">
              {entry.notes}
            </p>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
