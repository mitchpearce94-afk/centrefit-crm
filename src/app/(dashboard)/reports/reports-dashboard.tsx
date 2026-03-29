"use client";

import { useMemo } from "react";

interface Job {
  id: string;
  number: string;
  created_at: string;
  updated_at: string;
  status?: { name: string; phase: string };
  category_1?: { name: string };
  category_2?: { name: string };
  job_staff?: { staff_id: string }[];
}

interface TimeEntry {
  id: string;
  job_id: string;
  staff_id: string;
  start_time: string;
  end_time: string | null;
  billable: boolean;
  staff?: { display_name: string; initials: string; colour: string };
}

interface Deal {
  id: string;
  stage: string;
  value: number | null;
  probability: number;
  created_at: string;
}

interface StaffMember {
  id: string;
  display_name: string;
  initials: string;
  colour: string;
}

interface Customer {
  id: string;
  name: string;
  is_active: boolean;
}

interface Quote {
  id: string;
  status: string;
  created_at: string;
  pricing_snapshot: any;
  expires_at: string | null;
}

function csvExport(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers.join(","), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsDashboard({
  jobs, timeEntries, deals, staff, customers, quotes,
}: {
  jobs: Job[];
  timeEntries: TimeEntry[];
  deals: Deal[];
  staff: StaffMember[];
  customers: Customer[];
  quotes: Quote[];
}) {
  // ── Job stats ──
  const jobsByPhase = useMemo(() => {
    const phases: Record<string, number> = {};
    for (const job of jobs) {
      const phase = job.status?.phase ?? "unknown";
      phases[phase] = (phases[phase] ?? 0) + 1;
    }
    return phases;
  }, [jobs]);

  const activeJobs = jobs.filter(j => j.status?.phase !== "completion").length;
  const completedJobs = jobs.filter(j => j.status?.name === "Complete").length;

  const jobsByCategory = useMemo(() => {
    const cats: Record<string, number> = {};
    for (const job of jobs) {
      const cat = job.category_2?.name ?? "Uncategorised";
      cats[cat] = (cats[cat] ?? 0) + 1;
    }
    return Object.entries(cats).sort((a, b) => b[1] - a[1]);
  }, [jobs]);

  // ── Time stats ──
  const totalMinutes = useMemo(() => timeEntries.reduce((acc, t) => {
    if (!t.end_time) return acc;
    return acc + (new Date(t.end_time).getTime() - new Date(t.start_time).getTime()) / 60000;
  }, 0), [timeEntries]);

  const billableMinutes = useMemo(() => timeEntries.reduce((acc, t) => {
    if (!t.end_time || !t.billable) return acc;
    return acc + (new Date(t.end_time).getTime() - new Date(t.start_time).getTime()) / 60000;
  }, 0), [timeEntries]);

  const utilisationPct = totalMinutes > 0 ? Math.round((billableMinutes / totalMinutes) * 100) : 0;

  // ── Staff utilisation ──
  const staffHours = useMemo(() => {
    const hours: Record<string, { name: string; initials: string; colour: string; totalMins: number; billableMins: number; entries: number }> = {};
    for (const entry of timeEntries) {
      if (!entry.end_time || !entry.staff) continue;
      const mins = (new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime()) / 60000;
      if (!hours[entry.staff_id]) {
        hours[entry.staff_id] = { name: entry.staff.display_name, initials: entry.staff.initials, colour: entry.staff.colour, totalMins: 0, billableMins: 0, entries: 0 };
      }
      hours[entry.staff_id].totalMins += mins;
      if (entry.billable) hours[entry.staff_id].billableMins += mins;
      hours[entry.staff_id].entries += 1;
    }
    return Object.values(hours).sort((a, b) => b.totalMins - a.totalMins);
  }, [timeEntries]);

  // ── Quote conversion ──
  const quoteSent = quotes.filter(q => q.status === "sent" || q.status === "accepted" || q.status === "declined").length;
  const quoteAccepted = quotes.filter(q => q.status === "accepted").length;
  const quoteDeclined = quotes.filter(q => q.status === "declined").length;
  const quoteDraft = quotes.filter(q => q.status === "draft").length;
  const quoteConversion = quoteSent > 0 ? Math.round((quoteAccepted / quoteSent) * 100) : 0;
  const quoteTotalValue = quotes.filter(q => q.status === "accepted" && q.pricing_snapshot).reduce((sum, q) => sum + (q.pricing_snapshot?.totalExGST ?? 0), 0);

  // ── Pipeline stats ──
  const activeDeals = deals.filter(d => d.stage !== "won" && d.stage !== "lost" && d.stage !== "accepted");
  const wonDeals = deals.filter(d => d.stage === "won" || d.stage === "accepted");

  // ── Jobs this month ──
  const thisMonth = new Date();
  thisMonth.setDate(1);
  const jobsThisMonth = jobs.filter(j => new Date(j.created_at) >= thisMonth).length;

  const phaseLabels: Record<string, string> = {
    pre_work: "Pre-Work", quoting: "Quoting", in_progress: "In Progress",
    tracking_hold: "On Hold", completion: "Completed",
  };

  // ── CSV Export helpers ──
  function exportJobs() {
    csvExport("centrefit-jobs.csv",
      ["Job #", "Status", "Phase", "Category", "BU", "Created"],
      jobs.map(j => [j.number, j.status?.name ?? "", j.status?.phase ?? "", j.category_1?.name ?? "", j.category_2?.name ?? "", j.created_at.split("T")[0]])
    );
  }
  function exportStaffHours() {
    csvExport("centrefit-staff-hours.csv",
      ["Staff", "Total Hours", "Billable Hours", "Utilisation %", "Entries"],
      staffHours.map(s => [s.name, (s.totalMins / 60).toFixed(1), (s.billableMins / 60).toFixed(1), s.totalMins > 0 ? Math.round((s.billableMins / s.totalMins) * 100).toString() : "0", s.entries.toString()])
    );
  }
  function exportQuotes() {
    csvExport("centrefit-quotes.csv",
      ["Status", "Count"],
      [["Draft", quoteDraft.toString()], ["Sent", (quoteSent - quoteAccepted - quoteDeclined).toString()], ["Accepted", quoteAccepted.toString()], ["Declined", quoteDeclined.toString()]]
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Overview Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Jobs" value={jobs.length.toString()} />
        <StatCard label="Active Jobs" value={activeJobs.toString()} />
        <StatCard label="Completed" value={completedJobs.toString()} />
        <StatCard label="This Month" value={jobsThisMonth.toString()} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Hours" value={`${Math.floor(totalMinutes / 60)}h ${Math.round(totalMinutes % 60)}m`} />
        <StatCard label="Billable Hours" value={`${Math.floor(billableMinutes / 60)}h ${Math.round(billableMinutes % 60)}m`} />
        <StatCard label="Utilisation" value={`${utilisationPct}%`} accent={utilisationPct >= 70 ? "text-emerald-400" : utilisationPct >= 40 ? "text-amber-400" : "text-red-400"} />
        <StatCard label="Quote Conversion" value={`${quoteConversion}%`} accent={quoteConversion >= 50 ? "text-emerald-400" : "text-amber-400"} />
      </div>

      {/* ── Quote Stats ── */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quote Performance</h2>
          <button onClick={exportQuotes} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">Export CSV</button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div><p className="text-2xl font-bold">{quotes.length}</p><p className="text-xs text-muted-foreground">Total Quotes</p></div>
          <div><p className="text-2xl font-bold text-muted-foreground">{quoteDraft}</p><p className="text-xs text-muted-foreground">Draft</p></div>
          <div><p className="text-2xl font-bold" style={{ color: "#3b82f6" }}>{quoteSent - quoteAccepted - quoteDeclined}</p><p className="text-xs text-muted-foreground">Awaiting Response</p></div>
          <div><p className="text-2xl font-bold text-emerald-400">{quoteAccepted}</p><p className="text-xs text-muted-foreground">Accepted</p></div>
          <div><p className="text-2xl font-bold text-red-400">{quoteDeclined}</p><p className="text-xs text-muted-foreground">Declined</p></div>
        </div>
        {quoteTotalValue > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Accepted Quote Value (ex GST)</span>
              <span className="font-bold font-mono text-emerald-400">${quoteTotalValue.toLocaleString("en-AU", { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Jobs by Phase ── */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Jobs by Phase</h2>
            <button onClick={exportJobs} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">Export CSV</button>
          </div>
          <div className="space-y-2">
            {Object.entries(jobsByPhase).sort((a, b) => b[1] - a[1]).map(([phase, count]) => {
              const pct = Math.round((count / jobs.length) * 100);
              return (
                <div key={phase}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span>{phaseLabels[phase] ?? phase}</span>
                    <span className="font-medium">{count} ({pct}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Jobs by Business Unit ── */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Jobs by Business Unit</h2>
          <div className="space-y-2">
            {jobsByCategory.slice(0, 8).map(([cat, count]) => {
              const pct = Math.round((count / jobs.length) * 100);
              return (
                <div key={cat}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span>{cat}</span>
                    <span className="font-medium">{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary/60 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Staff Utilisation ── */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Staff Utilisation</h2>
            <button onClick={exportStaffHours} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">Export CSV</button>
          </div>
          {staffHours.length > 0 ? (
            <div className="space-y-3">
              {staffHours.map(s => {
                const totalH = Math.floor(s.totalMins / 60);
                const totalM = Math.round(s.totalMins % 60);
                const billH = Math.floor(s.billableMins / 60);
                const billM = Math.round(s.billableMins % 60);
                const util = s.totalMins > 0 ? Math.round((s.billableMins / s.totalMins) * 100) : 0;
                const maxMins = staffHours[0]?.totalMins ?? 1;
                const pct = Math.round((s.totalMins / maxMins) * 100);
                return (
                  <div key={s.name}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-medium text-white" style={{ backgroundColor: s.colour }}>{s.initials}</span>
                        <span>{s.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{billH}h {billM}m billable</span>
                        <span className="font-medium">{totalH}h {totalM}m</span>
                        <span className={`text-xs font-bold ${util >= 70 ? "text-emerald-400" : util >= 40 ? "text-amber-400" : "text-red-400"}`}>{util}%</span>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">No time entries recorded yet.</p>
          )}
        </div>

        {/* ── Pipeline Summary ── */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Pipeline Summary</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><p className="text-2xl font-bold">{activeDeals.length}</p><p className="text-xs text-muted-foreground">Active Leads</p></div>
            <div><p className="text-2xl font-bold text-emerald-400">{wonDeals.length}</p><p className="text-xs text-muted-foreground">Converted to Jobs</p></div>
          </div>
          <div className="mt-4 pt-3 border-t border-border">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total Customers</span>
              <span className="font-medium">{customers.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-1">
              <span className="text-muted-foreground">Active Customers</span>
              <span className="font-medium">{customers.filter(c => c.is_active).length}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${accent ?? ""}`}>{value}</p>
    </div>
  );
}
