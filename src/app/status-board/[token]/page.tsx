import Image from "next/image";
import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { BoardLive } from "./board-live";
import { AutoScroll } from "./auto-scroll";

// Always render fresh — this is a live board, never cache it.
export const dynamic = "force-dynamic";

interface StaffLite {
  id: string;
  display_name: string;
  initials: string;
  colour: string | null;
}

interface BoardJob {
  id: string;
  number: string | null;
  reference: string | null;
  rough_in_date: string | null;
  rough_in_end_date: string | null;
  fit_off_date: string | null;
  fit_off_end_date: string | null;
  rough_in_staff_ids: string[] | null;
  fit_off_staff_ids: string[] | null;
  customer: { name: string } | { name: string }[] | null;
  site: { name: string } | { name: string }[] | null;
  status:
    | { name: string; colour: string | null; sort_order: number | null }
    | { name: string; colour: string | null; sort_order: number | null }[]
    | null;
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

function todayISO(): string {
  // Brisbane local date (TZ set in instrumentation.ts). en-CA → YYYY-MM-DD.
  return new Date().toLocaleDateString("en-CA");
}

function fmtShort(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function fmtRange(start: string, end: string | null): string {
  if (!end || end === start) return fmtShort(start);
  return `${fmtShort(start)} – ${fmtShort(end)}`;
}

// Tag for a phase's date range: Completed once the whole range has passed,
// In progress while we're inside it, otherwise a countdown to the start.
function phaseTag(
  start: string,
  end: string | null,
): { label: string; tone: "today" | "soon" | "none" | "done" } {
  const today = new Date(todayISO() + "T00:00:00").getTime();
  const startT = new Date(start + "T00:00:00").getTime();
  const endT = new Date((end || start) + "T00:00:00").getTime();
  if (today > endT) return { label: "Completed", tone: "done" };
  if (today >= startT) return { label: "In progress", tone: "today" };
  const days = Math.round((startT - today) / 86_400_000);
  if (days === 1) return { label: "Tomorrow", tone: "soon" };
  return { label: `in ${days}d`, tone: "none" };
}

// Date-driven lifecycle stage for a fit-out, computed from today vs the
// rough-in / fit-off ranges. Returns null when no dates are set yet (board
// then falls back to the job's real CRM status). `group` drives sort phase:
// 0 = rough-in world (sort by rough-in date), 1 = fit-off world (sort by
// fit-off date), 2 = completion.
interface Stage {
  label: string;
  colour: string;
  group: number;
  sortDate: string;
}
function deriveStage(
  j: { rough_in_date: string | null; rough_in_end_date: string | null; fit_off_date: string | null; fit_off_end_date: string | null },
  today: string,
): Stage | null {
  const riS = j.rough_in_date;
  const riE = j.rough_in_end_date || j.rough_in_date;
  const foS = j.fit_off_date;
  const foE = j.fit_off_end_date || j.fit_off_date;

  if (foE && today > foE) return { label: "Awaiting Job Completion", colour: "#84cc16", group: 2, sortDate: foE };
  if (foS && foE && today >= foS && today <= foE) return { label: "Fit Off", colour: "#8b5cf6", group: 1, sortDate: foS };
  if (riE && today > riE) return { label: "Awaiting Fit Off", colour: "#fb923c", group: 1, sortDate: foS || riE };
  if (riS && riE && today >= riS && today <= riE) return { label: "Rough In", colour: "#a855f7", group: 0, sortDate: riS };
  if (riS && today < riS) return { label: "Awaiting Rough In", colour: "#f59e0b", group: 0, sortDate: riS };
  if (foS && today < foS) return { label: "Awaiting Fit Off", colour: "#fb923c", group: 1, sortDate: foS };
  return null;
}

// Keep the status pill on a single line by shrinking the font for long labels.
function pillSize(label: string): string {
  if (label.length <= 11) return "text-xl";
  if (label.length <= 18) return "text-lg";
  return "text-base";
}

function CrewAvatars({ crew }: { crew: StaffLite[] }) {
  if (crew.length === 0) {
    return <span className="text-sm text-white/25">Unassigned</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {crew.map((s) => (
        <span
          key={s.id}
          title={s.display_name}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white ring-1 ring-white/15"
          style={{ backgroundColor: s.colour ?? "#3b82f6" }}
        >
          {s.initials}
        </span>
      ))}
    </div>
  );
}

function PhaseBlock({
  heading,
  start,
  end,
  crew,
}: {
  heading: string;
  start: string | null;
  end: string | null;
  crew: StaffLite[];
}) {
  const rel = start ? phaseTag(start, end) : null;
  const toneClass =
    rel?.tone === "today"
      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
      : rel?.tone === "soon"
      ? "bg-amber-500/15 text-amber-300 ring-amber-500/30"
      : rel?.tone === "done"
      ? "bg-white/5 text-white/40 ring-white/10"
      : "bg-white/5 text-white/70 ring-white/10";
  return (
    <div className="min-w-[200px]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/35">{heading}</div>
      {start ? (
        <div className="mt-1 flex items-center gap-2">
          <span className="text-xl font-medium text-white/90">{fmtRange(start, end)}</span>
          {rel && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${toneClass}`}>{rel.label}</span>
          )}
        </div>
      ) : (
        <div className="mt-1 text-xl font-medium text-white/25">—</div>
      )}
      <div className="mt-2">
        <CrewAvatars crew={crew} />
      </div>
    </div>
  );
}

export default async function StatusBoardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const expected = process.env.STATUS_BOARD_TOKEN;

  // Unguessable-link gate. Wrong/absent token → 404 (no hint the page exists).
  if (!expected || token !== expected) notFound();

  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("jobs")
    .select(
      "id, number, reference, rough_in_date, rough_in_end_date, fit_off_date, fit_off_end_date, rough_in_staff_ids, fit_off_staff_ids, customer:customers(name), site:customer_sites(name), status:statuses(name, colour, sort_order)",
    )
    .eq("is_new_build", true);

  const today = todayISO();
  const rows = ((data ?? []) as BoardJob[])
    .map((j) => {
      const _status = one(j.status);
      const stage = deriveStage(j, today);
      // One chronological timeline: rough-in and fit-off dates compete directly,
      // so jobs interleave by whichever milestone comes next (a sooner fit-off
      // can sit above a later rough-in). Finished-but-not-closed builds park at
      // the bottom; jobs with no dates yet fall back to their real CRM status,
      // last of all.
      const rank = !stage ? 2 : stage.label === "Awaiting Job Completion" ? 1 : 0;
      const sortDate = stage
        ? stage.sortDate
        : `9999-${String(_status?.sort_order ?? 999).padStart(4, "0")}`;
      return { ...j, _status, _site: one(j.site), _customer: one(j.customer), stage, rank, sortDate };
    })
    .filter((j) => j._status?.name !== "Cancelled")
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.sortDate.localeCompare(b.sortDate) ||
        (a._site?.name ?? a._customer?.name ?? "").localeCompare(b._site?.name ?? b._customer?.name ?? ""),
    );

  // Resolve every assigned crew member in one query, then map per phase.
  const staffIds = Array.from(
    new Set(rows.flatMap((j) => [...(j.rough_in_staff_ids ?? []), ...(j.fit_off_staff_ids ?? [])])),
  );
  const staffById = new Map<string, StaffLite>();
  if (staffIds.length > 0) {
    const { data: staff } = await supabase
      .from("staff")
      .select("id, display_name, initials, colour")
      .in("id", staffIds);
    for (const s of (staff ?? []) as StaffLite[]) staffById.set(s.id, s);
  }
  const crewOf = (idList: string[] | null): StaffLite[] =>
    (idList ?? []).map((id) => staffById.get(id)).filter((s): s is StaffLite => !!s);

  const updated = new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#1e1b4b_0%,_#0b1020_45%,_#05070d_100%)] px-10 py-8 text-white">
      {/* Header */}
      <header className="flex items-end justify-between gap-6 border-b border-white/10 pb-6">
        <div>
          <Image
            src="/centrefit-logo.png"
            alt="Centrefit Group"
            width={240}
            height={60}
            priority
            className="h-9 w-auto"
            style={{ filter: "brightness(0) invert(1)" }}
          />
          <h1 className="mt-3 bg-gradient-to-r from-white via-white to-violet-300 bg-clip-text text-5xl font-bold tracking-tight text-transparent">
            New Build Status Board
          </h1>
          <p className="mt-2 text-sm text-white/40">
            {rows.length} active build{rows.length === 1 ? "" : "s"} · updated {updated}
          </p>
        </div>
        <BoardLive />
      </header>

      {/* Board */}
      {rows.length === 0 ? (
        <div className="mt-24 text-center text-2xl font-medium text-white/30">No active new builds right now.</div>
      ) : (
        <AutoScroll>
          <div className="mt-6 space-y-3 pb-10">
            {rows.map((j) => {
              // Date-driven stage wins; otherwise show the real CRM status.
              const statusLabel = j.stage?.label ?? j._status?.name ?? "—";
              const colour = j.stage?.colour ?? j._status?.colour ?? "#8b5cf6";
              const title = j._site?.name ?? j._customer?.name ?? j.reference ?? j.number ?? "—";
              const subtitle = j._site?.name ? j._customer?.name : j.reference;
              return (
                <div
                  key={j.id}
                  className="flex items-center gap-6 rounded-2xl border border-white/10 bg-white/[0.04] px-7 py-5 backdrop-blur-sm"
                >
                  <span className="h-14 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: colour }} />

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-3xl font-bold tracking-tight text-white">{title}</div>
                    {subtitle && <div className="mt-0.5 truncate text-base text-white/45">{subtitle}</div>}
                  </div>

                  <PhaseBlock heading="Rough In" start={j.rough_in_date} end={j.rough_in_end_date} crew={crewOf(j.rough_in_staff_ids)} />
                  <PhaseBlock heading="Fit Off" start={j.fit_off_date} end={j.fit_off_end_date} crew={crewOf(j.fit_off_staff_ids)} />

                  <div className="shrink-0 text-right">
                    <span
                      className={`inline-flex items-center gap-2.5 whitespace-nowrap rounded-full border px-5 py-2.5 font-semibold ${pillSize(statusLabel)}`}
                      style={{ backgroundColor: `${colour}22`, color: colour, borderColor: `${colour}55` }}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colour }} />
                      {statusLabel}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </AutoScroll>
      )}
    </div>
  );
}
