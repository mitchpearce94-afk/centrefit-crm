import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { BoardLive } from "./board-live";

// Always render fresh — this is a live board, never cache it.
export const dynamic = "force-dynamic";

interface BoardJob {
  id: string;
  number: string | null;
  reference: string | null;
  rough_in_date: string | null;
  fit_off_date: string | null;
  customer: { name: string } | { name: string }[] | null;
  site: { name: string } | { name: string }[] | null;
  status: { name: string; colour: string | null; phase: string | null; sort_order: number | null }
    | { name: string; colour: string | null; phase: string | null; sort_order: number | null }[]
    | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function todayISO(): string {
  // Brisbane local date (TZ set in instrumentation.ts). en-CA gives YYYY-MM-DD.
  return new Date().toLocaleDateString("en-CA");
}

function fmtDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// Returns { label, tone } describing a rough-in / fit-off date relative to today.
function relative(d: string | null): { label: string; tone: "none" | "today" | "soon" | "past" } | null {
  if (!d) return null;
  const today = new Date(todayISO() + "T00:00:00").getTime();
  const target = new Date(d + "T00:00:00").getTime();
  const days = Math.round((target - today) / 86_400_000);
  if (days === 0) return { label: "Today", tone: "today" };
  if (days === 1) return { label: "Tomorrow", tone: "soon" };
  if (days < 0) return { label: `${Math.abs(days)}d ago`, tone: "past" };
  return { label: `in ${days}d`, tone: "none" };
}

function DateChip({ heading, date }: { heading: string; date: string | null }) {
  const rel = relative(date);
  const toneClass =
    rel?.tone === "today"
      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
      : rel?.tone === "soon"
      ? "bg-amber-500/15 text-amber-300 ring-amber-500/30"
      : rel?.tone === "past"
      ? "bg-rose-500/15 text-rose-300 ring-rose-500/30"
      : "bg-white/5 text-white/70 ring-white/10";
  return (
    <div className="min-w-[150px]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/35">{heading}</div>
      {date ? (
        <div className="mt-1 flex items-center gap-2">
          <span className="text-xl font-medium text-white/90">{fmtDate(date)}</span>
          {rel && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${toneClass}`}>
              {rel.label}
            </span>
          )}
        </div>
      ) : (
        <div className="mt-1 text-xl font-medium text-white/25">—</div>
      )}
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
      "id, number, reference, rough_in_date, fit_off_date, customer:customers(name), site:customer_sites(name), status:statuses(name, colour, phase, sort_order)",
    )
    .eq("is_new_build", true);

  const jobs = ((data ?? []) as BoardJob[])
    .map((j) => ({
      ...j,
      _status: one(j.status),
      _site: one(j.site),
      _customer: one(j.customer),
    }))
    // Drop cancelled builds from the board.
    .filter((j) => j._status?.name !== "Cancelled")
    // Earlier pipeline stages first, completed builds drift to the bottom.
    .sort((a, b) => (a._status?.sort_order ?? 999) - (b._status?.sort_order ?? 999));

  const updated = new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#1e1b4b_0%,_#0b1020_45%,_#05070d_100%)] px-10 py-8 text-white">
      {/* Header */}
      <header className="flex items-end justify-between gap-6 border-b border-white/10 pb-6">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.3em] text-violet-300/80">
            Centrefit
          </div>
          <h1 className="mt-1 bg-gradient-to-r from-white via-white to-violet-300 bg-clip-text text-5xl font-bold tracking-tight text-transparent">
            New Build Status Board
          </h1>
          <p className="mt-2 text-sm text-white/40">
            {jobs.length} active build{jobs.length === 1 ? "" : "s"} · updated {updated}
          </p>
        </div>
        <BoardLive />
      </header>

      {/* Board */}
      {jobs.length === 0 ? (
        <div className="mt-24 text-center text-2xl font-medium text-white/30">
          No active new builds right now.
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {jobs.map((j) => {
            const colour = j._status?.colour ?? "#8b5cf6";
            const title = j._site?.name ?? j._customer?.name ?? j.reference ?? j.number ?? "—";
            const subtitle = j._site?.name ? j._customer?.name : j.reference;
            return (
              <div
                key={j.id}
                className="flex items-center gap-6 rounded-2xl border border-white/10 bg-white/[0.04] px-7 py-5 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset] backdrop-blur-sm"
              >
                {/* Status colour rail */}
                <span
                  className="h-12 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: colour }}
                />

                {/* Site / customer */}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-3xl font-bold tracking-tight text-white">{title}</div>
                  {subtitle && (
                    <div className="mt-0.5 truncate text-base text-white/45">{subtitle}</div>
                  )}
                </div>

                {/* Dates */}
                <DateChip heading="Rough In" date={j.rough_in_date} />
                <DateChip heading="Fit Off" date={j.fit_off_date} />

                {/* Status pill */}
                <div className="w-[230px] shrink-0 text-right">
                  <span
                    className="inline-flex items-center gap-2.5 rounded-full border px-5 py-2.5 text-xl font-semibold"
                    style={{
                      backgroundColor: `${colour}22`,
                      color: colour,
                      borderColor: `${colour}55`,
                    }}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colour }} />
                    {j._status?.name ?? "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
