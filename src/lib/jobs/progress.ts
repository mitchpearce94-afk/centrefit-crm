import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Job lifecycle progress — the go-to-whoa checklist (docs/job-lifecycle-
 * CONTEXT.md D5–D8). One fixed list of steps; each step's state is derived
 * from the CRM's own rows wherever the data exists (auto) and ticked by a
 * person otherwise (manual). Any step can be ticked by hand or marked N/A;
 * those marks live in job_progress_items. Nothing here writes anything.
 */

export type StepState = "done" | "pending" | "na";
export type StepGroup = "Design & quote" | "Money" | "Before install" | "Install" | "Handover & close";

export interface ProgressStep {
  key: ProgressStepKey;
  group: StepGroup;
  label: string;
  /** What "done" means, shown under the label when pending. */
  hint: string;
  source: "auto" | "manual";
  state: StepState;
  /** One line of evidence or what's missing. */
  detail: string | null;
  /** Where the step gets done. Internal tab ids are "tab:<id>" on the job page. */
  href: string | null;
  /** "SC 05/11/26" for manual marks, null when the data proved it. */
  by: string | null;
  /** The manual row, when one exists (so the UI can offer Undo). */
  manual: { state: "done" | "na"; by: string | null; at: string; note: string | null } | null;
}

export interface JobProgress {
  set: "fitout" | "service";
  steps: ProgressStep[];
  done: number;
  /** Steps that count — N/A steps are excluded. */
  total: number;
  next: ProgressStep | null;
}

const STEP_KEYS = [
  "builder_plans",
  "cfp_plan",
  "plan_to_electrician",
  "electrician_quote",
  "quote_sent",
  "quote_accepted",
  "deposit_invoice",
  "deposit_paid",
  "direct_debits",
  "procurement",
  "dates_booked",
  "security_paperwork",
  "swms",
  "nbn",
  "rough_in_done",
  "fit_off_done",
  "install_checklist",
  "writeup",
  "handover_docs",
  "final_invoice",
  "final_paid",
  "complete",
] as const;
export type ProgressStepKey = (typeof STEP_KEYS)[number];

export function isProgressStepKey(v: string): v is ProgressStepKey {
  return (STEP_KEYS as readonly string[]).includes(v);
}

type Def = { key: ProgressStepKey; group: StepGroup; label: string; hint: string; source: "auto" | "manual" };

const DEFS: Def[] = [
  { key: "builder_plans", group: "Design & quote", label: "Builder's plans on the site file", hint: "Architect / builder drawings uploaded under Documentation → Plans on the site", source: "auto" },
  { key: "cfp_plan", group: "Design & quote", label: "Centrefit plan drawn", hint: "A CFP plan linked to this job or site", source: "auto" },
  { key: "plan_to_electrician", group: "Design & quote", label: "Plan sent to the electrician", hint: "Sent from the plan's row on the Plans page", source: "auto" },
  { key: "electrician_quote", group: "Design & quote", label: "Electrician's quote received", hint: "Electrician cost entered on the quote", source: "auto" },
  { key: "quote_sent", group: "Design & quote", label: "Quote sent", hint: "A quote on this job has gone to the customer", source: "auto" },
  { key: "quote_accepted", group: "Design & quote", label: "Quote accepted", hint: "Customer accepted a quote on this job", source: "auto" },
  { key: "deposit_invoice", group: "Money", label: "Invoice sent (owner or builder)", hint: "PP1 or full invoice authorised and emailed", source: "auto" },
  { key: "deposit_paid", group: "Money", label: "Invoice paid", hint: "PP1 / full invoice paid in Xero", source: "auto" },
  { key: "direct_debits", group: "Money", label: "Direct debits set up", hint: "Recurring plan for the site active — mandate signed by the owner", source: "auto" },
  { key: "procurement", group: "Before install", label: "Procurement complete", hint: "Every procurement line received or allocated from stock", source: "auto" },
  { key: "dates_booked", group: "Before install", label: "Dates booked", hint: "Rough-in and fit-off dates set (or the job scheduled)", source: "auto" },
  { key: "security_paperwork", group: "Before install", label: "Security paperwork signed", hint: "Monitoring form signed, or security paperwork on the site file", source: "auto" },
  { key: "swms", group: "Before install", label: "SWMS on file", hint: "A SWMS generated or uploaded for the site", source: "auto" },
  { key: "nbn", group: "Before install", label: "NBN ordered and active", hint: "All NBN steps on the job complete", source: "auto" },
  { key: "rough_in_done", group: "Install", label: "Rough-in complete", hint: "Tick when the rough-in is finished", source: "manual" },
  { key: "fit_off_done", group: "Install", label: "Fit-off complete", hint: "Tick when the fit-off is finished", source: "manual" },
  { key: "install_checklist", group: "Install", label: "Install checklist complete", hint: "Every task on the job's checklist ticked", source: "auto" },
  { key: "writeup", group: "Install", label: "Work write-up done", hint: "At least one Work Completed entry on the job", source: "auto" },
  { key: "handover_docs", group: "Handover & close", label: "Handover documentation", hint: "Handover accepted, or handover docs on the site file", source: "auto" },
  { key: "final_invoice", group: "Handover & close", label: "Final invoice sent", hint: "PP2 authorised and emailed", source: "auto" },
  { key: "final_paid", group: "Handover & close", label: "Final invoice paid", hint: "PP2 paid in Xero", source: "auto" },
  { key: "complete", group: "Handover & close", label: "Job complete", hint: "Status moved to Complete", source: "auto" },
];

const SERVICE_KEYS: ProgressStepKey[] = ["dates_booked", "install_checklist", "writeup", "deposit_invoice", "deposit_paid", "complete"];

function dmy(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Brisbane" });
}

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

type Computed = { state: StepState; detail: string | null; href: string | null };

export async function loadJobProgress(supabase: SupabaseClient, jobId: string): Promise<JobProgress> {
  const { data: job } = await supabase
    .from("jobs")
    .select("id, site_id, is_new_build, rough_in_date, fit_off_date, dates_tbc, procurement_not_required, handover_date, status:statuses(name, phase), category_1:categories!category_1_id(name)")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) {
    return { set: "service", steps: [], done: 0, total: 0, next: null };
  }
  const siteId = (job.site_id as string | null) ?? null;
  const statusName = one(job.status as unknown as { name: string; phase: string | null } | null)?.name ?? null;
  const isNbnJob = (one(job.category_1 as unknown as { name: string } | null)?.name ?? "").includes("NBN");

  const planFilter = siteId ? `job_id.eq.${jobId},site_id.eq.${siteId}` : `job_id.eq.${jobId}`;
  const [docsRes, plansRes, quotesRes, invoicesRes, rpRes, signRes, procRes, checklistRes, workRes, nbnRes, schedRes, manualRes] = await Promise.all([
    siteId
      ? supabase.from("site_documents").select("category, name, created_at").eq("site_id", siteId).neq("status", "deleted")
      : Promise.resolve({ data: [] as { category: string; name: string; created_at: string }[] }),
    supabase.from("plan_files").select("id, name, revision, updated_at, sent_to_electrician_at, sent_to_electrician_email").or(planFilter).order("updated_at", { ascending: false }),
    supabase.from("quotes").select("id, ref, status, quote_type, electrician_cost, pp1_paid, pp2_paid, sent_at, accepted_at, bill_to_party").eq("job_id", jobId).order("created_at", { ascending: false }),
    supabase.from("invoices").select("id, invoice_type, status, sent_at, paid_at, bill_to_party, bill_to_name, xero_invoice_number, created_at").eq("job_id", jobId).neq("status", "void").order("created_at", { ascending: true }),
    siteId
      ? supabase.from("recurring_plans").select("id, status, signup_emailed_at, signup_reminder_count, created_at, updated_at").eq("site_id", siteId).neq("status", "cancelled").order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; status: string; signup_emailed_at: string | null; signup_reminder_count: number | null; created_at: string; updated_at: string }[] }),
    siteId
      ? supabase.from("document_sign_requests").select("document_type, status, signer_name, sent_at, signed_at").eq("site_id", siteId).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { document_type: string; status: string; signer_name: string | null; sent_at: string | null; signed_at: string | null }[] }),
    supabase.from("job_procurement_items").select("status, received_at, allocated_from_stock").eq("job_id", jobId),
    supabase.from("job_checklist_items").select("is_completed").eq("job_id", jobId),
    supabase.from("job_work_entries").select("work_date").eq("job_id", jobId).order("work_date", { ascending: false }),
    supabase.from("nbn_steps").select("status").eq("job_id", jobId),
    supabase.from("schedule_entries").select("schedule_date").eq("job_id", jobId).order("schedule_date", { ascending: false }).limit(1),
    supabase.from("job_progress_items").select("step_key, state, done_by_text, done_at, note").eq("job_id", jobId),
  ]);

  const docs = (docsRes.data ?? []) as { category: string; name: string; created_at: string }[];
  const plans = (plansRes.data ?? []) as { id: string; name: string; revision: string | null; updated_at: string; sent_to_electrician_at: string | null; sent_to_electrician_email: string | null }[];
  const quotes = (quotesRes.data ?? []) as { id: string; ref: string; status: string; quote_type: string | null; electrician_cost: number | null; pp1_paid: boolean | null; pp2_paid: boolean | null; sent_at: string | null; accepted_at: string | null; bill_to_party: string | null }[];
  const invoices = (invoicesRes.data ?? []) as { id: string; invoice_type: string; status: string; sent_at: string | null; paid_at: string | null; bill_to_party: string | null; bill_to_name: string | null; xero_invoice_number: string | null; created_at: string }[];
  const plansRp = (rpRes.data ?? []) as { id: string; status: string; signup_emailed_at: string | null; signup_reminder_count: number | null; created_at: string; updated_at: string }[];
  const signs = (signRes.data ?? []) as { document_type: string; status: string; signer_name: string | null; sent_at: string | null; signed_at: string | null }[];
  const proc = (procRes.data ?? []) as { status: string | null; received_at: string | null; allocated_from_stock: boolean | null }[];
  const checklist = (checklistRes.data ?? []) as { is_completed: boolean }[];
  const work = (workRes.data ?? []) as { work_date: string }[];
  const nbn = (nbnRes.data ?? []) as { status: string }[];
  const sched = (schedRes.data ?? []) as { schedule_date: string }[];
  const manual = new Map(
    ((manualRes.data ?? []) as { step_key: string; state: "done" | "na"; done_by_text: string | null; done_at: string; note: string | null }[]).map((m) => [m.step_key, m]),
  );

  const set: JobProgress["set"] = job.is_new_build || quotes.length > 0 || plans.length > 0 ? "fitout" : "service";
  const siteHref = siteId ? `/sites/${siteId}` : null;
  const hasProgressQuote = quotes.some((q) => q.quote_type === "progress");
  const acceptedQuote = quotes.find((q) => q.status === "accepted") ?? null;
  const sentQuote = quotes.find((q) => q.sent_at || ["sent", "accepted", "declined", "expired"].includes(q.status)) ?? null;
  const billedTo = (inv: { bill_to_party: string | null; bill_to_name: string | null }) =>
    inv.bill_to_party === "builder" ? `to builder ${inv.bill_to_name ?? ""}`.trim() : `to owner${inv.bill_to_name ? ` ${inv.bill_to_name}` : ""}`;
  const invoiceState = (inv: typeof invoices[number] | null, fallbackDetail: string): Computed => {
    if (!inv) return { state: "pending", detail: fallbackDetail, href: "tab:invoicing" };
    const num = inv.xero_invoice_number ?? "draft";
    if (inv.status === "draft") return { state: "pending", detail: `Draft ${num} in Xero — authorise and send`, href: `/invoices/${inv.id}` };
    if (inv.status === "paid" || inv.status === "authorised") {
      if (inv.sent_at) return { state: "done", detail: `${num} ${billedTo(inv)}, sent ${dmy(inv.sent_at)}`, href: `/invoices/${inv.id}` };
      return { state: "pending", detail: `${num} authorised ${billedTo(inv)} but not emailed yet`, href: `/invoices/${inv.id}` };
    }
    return { state: "pending", detail: `${num} is ${inv.status}`, href: `/invoices/${inv.id}` };
  };
  const paidState = (inv: typeof invoices[number] | null, quoteFlag: boolean, label: string): Computed => {
    if (inv?.status === "paid" || quoteFlag) {
      return { state: "done", detail: `Paid${inv?.paid_at ? ` ${dmy(inv.paid_at)}` : ""}`, href: inv ? `/invoices/${inv.id}` : "tab:invoicing" };
    }
    if (!inv) return { state: "pending", detail: `No ${label ? label + " " : ""}invoice yet`, href: "tab:invoicing" };
    return { state: "pending", detail: `${inv.xero_invoice_number ?? "Invoice"} not paid`, href: `/invoices/${inv.id}` };
  };

  const depositInv =
    invoices.find((i) => i.invoice_type === "progress_pp1") ??
    invoices.find((i) => i.invoice_type === "full") ??
    (set === "service" ? invoices.find((i) => i.invoice_type === "adhoc") ?? null : null);
  const pp2Inv = invoices.find((i) => i.invoice_type === "progress_pp2") ?? null;

  const compute: Record<ProgressStepKey, () => Computed> = {
    builder_plans: () => {
      const d = docs.filter((x) => x.category === "plans");
      return d.length > 0
        ? { state: "done", detail: `${d.length} file${d.length === 1 ? "" : "s"} on the site file, latest ${dmy(d[0].created_at)}`, href: siteHref }
        : { state: "pending", detail: siteId ? "Nothing under Documentation → Plans on the site" : "Job has no site", href: siteHref };
    },
    cfp_plan: () => {
      const p = plans[0];
      return p
        ? { state: "done", detail: `${p.name}${p.revision ? ` Rev ${p.revision}` : ""}, updated ${dmy(p.updated_at)}`, href: `/plans/${p.id}` }
        : { state: "pending", detail: "No CFP plan linked to this job or site", href: "/plans" };
    },
    plan_to_electrician: () => {
      const p = plans.find((x) => x.sent_to_electrician_at);
      return p
        ? { state: "done", detail: `Sent ${dmy(p.sent_to_electrician_at)}${p.sent_to_electrician_email ? ` to ${p.sent_to_electrician_email}` : ""}`, href: `/plans/${p.id}` }
        : { state: "pending", detail: plans.length ? "Plan drawn but not sent — use the plan's row on the Plans page" : "Needs the plan first", href: "/plans" };
    },
    electrician_quote: () => {
      const q = quotes.find((x) => Number(x.electrician_cost) > 0);
      if (q) return { state: "done", detail: `$${Number(q.electrician_cost).toLocaleString("en-AU")} on ${q.ref}`, href: `/quoting/${q.id}` };
      const latest = quotes[0];
      return { state: "pending", detail: latest ? `No electrician cost on ${latest.ref}` : "No quote on this job yet", href: latest ? `/quoting/${latest.id}` : "tab:quoting" };
    },
    quote_sent: () =>
      sentQuote
        ? { state: "done", detail: `${sentQuote.ref} sent ${dmy(sentQuote.sent_at) || "(status " + sentQuote.status + ")"}`, href: `/quoting/${sentQuote.id}` }
        : { state: "pending", detail: quotes[0] ? `${quotes[0].ref} is still ${quotes[0].status}` : "No quote on this job yet", href: quotes[0] ? `/quoting/${quotes[0].id}` : "tab:quoting" },
    quote_accepted: () =>
      acceptedQuote
        ? { state: "done", detail: `${acceptedQuote.ref} accepted ${dmy(acceptedQuote.accepted_at)}`, href: `/quoting/${acceptedQuote.id}` }
        : { state: "pending", detail: sentQuote ? `Waiting on the customer for ${sentQuote.ref}` : "Quote not sent yet", href: sentQuote ? `/quoting/${sentQuote.id}` : "tab:quoting" },
    deposit_invoice: () => invoiceState(depositInv, acceptedQuote ? `Generate the ${hasProgressQuote ? "PP1" : "full"} invoice on ${acceptedQuote.ref}` : "No invoice on this job yet"),
    deposit_paid: () => paidState(depositInv, !!acceptedQuote?.pp1_paid, hasProgressQuote ? "PP1" : ""),
    direct_debits: () => {
      const active = plansRp.find((p) => p.status === "active");
      if (active) return { state: "done", detail: `Recurring plan active since ${dmy(active.updated_at)}`, href: `/invoices/recurring/${active.id}` };
      const pending = plansRp.find((p) => p.status === "pending_mandate");
      if (pending) {
        const days = Math.floor((Date.now() - new Date(pending.signup_emailed_at ?? pending.created_at).getTime()) / 86_400_000);
        return { state: "pending", detail: `Mandate sent ${dmy(pending.signup_emailed_at ?? pending.created_at)}, unsigned for ${days}d (${pending.signup_reminder_count ?? 0} reminders)`, href: `/invoices/recurring/${pending.id}` };
      }
      const draft = plansRp.find((p) => p.status === "draft");
      if (draft) return { state: "pending", detail: "Plan drafted — signup email not sent yet", href: `/invoices/recurring/${draft.id}` };
      const other = plansRp[0];
      if (other) return { state: "pending", detail: `Recurring plan is ${other.status}`, href: `/invoices/recurring/${other.id}` };
      return { state: "pending", detail: "No recurring plan for this site", href: "/invoices/recurring/new" };
    },
    procurement: () => {
      if (job.procurement_not_required) return { state: "na", detail: "Marked not required", href: "tab:procurement" };
      if (proc.length === 0) return { state: "pending", detail: "No procurement lines on the job", href: "tab:procurement" };
      const got = proc.filter((p) => p.received_at || p.allocated_from_stock || p.status === "received").length;
      return got === proc.length
        ? { state: "done", detail: `${proc.length} line${proc.length === 1 ? "" : "s"} received`, href: "tab:procurement" }
        : { state: "pending", detail: `${got} of ${proc.length} lines received`, href: "tab:procurement" };
    },
    dates_booked: () => {
      if (job.is_new_build) {
        if (job.rough_in_date && job.fit_off_date) return { state: "done", detail: `Rough-in ${dmy(job.rough_in_date)}, fit-off ${dmy(job.fit_off_date)}`, href: null };
        if (job.dates_tbc) return { state: "pending", detail: "Dates marked TBC", href: null };
        return { state: "pending", detail: job.rough_in_date ? `Rough-in ${dmy(job.rough_in_date)}, fit-off not set` : "Rough-in and fit-off dates not set", href: null };
      }
      return sched[0]
        ? { state: "done", detail: `Scheduled ${dmy(sched[0].schedule_date)}`, href: "/scheduler" }
        : { state: "pending", detail: "Not on the scheduler", href: "/scheduler" };
    },
    security_paperwork: () => {
      const signed = signs.find((s) => s.document_type === "monitoring_form" && s.status === "signed");
      if (signed) return { state: "done", detail: `Monitoring form signed${signed.signer_name ? ` by ${signed.signer_name}` : ""} ${dmy(signed.signed_at)}`, href: siteHref };
      const onFile = docs.filter((d) => d.category === "security");
      if (onFile.length) return { state: "done", detail: `${onFile.length} file${onFile.length === 1 ? "" : "s"} under Security Paperwork`, href: siteHref };
      const sent = signs.find((s) => s.document_type === "monitoring_form" && (s.status === "sent" || s.status === "viewed"));
      if (sent) return { state: "pending", detail: `Monitoring form sent ${dmy(sent.sent_at)}, not signed`, href: siteHref };
      return { state: "pending", detail: "Monitoring form not sent", href: siteHref };
    },
    swms: () => {
      const s = docs.filter((d) => d.category === "swms");
      return s.length
        ? { state: "done", detail: `${s[0].name}`, href: siteHref }
        : { state: "pending", detail: "No SWMS on the site file", href: siteHref };
    },
    nbn: () => {
      if (!isNbnJob && nbn.length === 0) return { state: "na", detail: "Not an NBN job", href: null };
      const done = nbn.filter((s) => s.status === "complete" || s.status === "completed" || s.status === "done").length;
      return nbn.length > 0 && done === nbn.length
        ? { state: "done", detail: `${nbn.length} NBN steps complete`, href: "tab:nbn" }
        : { state: "pending", detail: nbn.length ? `${done} of ${nbn.length} NBN steps complete` : "No NBN steps yet", href: "tab:nbn" };
    },
    rough_in_done: () => ({ state: "pending", detail: null, href: null }),
    fit_off_done: () => ({ state: "pending", detail: null, href: null }),
    install_checklist: () => {
      if (checklist.length === 0) return { state: "pending", detail: "No checklist applied to the job", href: "tab:job" };
      const done = checklist.filter((c) => c.is_completed).length;
      return done === checklist.length
        ? { state: "done", detail: `${done}/${checklist.length} tasks`, href: "tab:job" }
        : { state: "pending", detail: `${done}/${checklist.length} tasks ticked`, href: "tab:job" };
    },
    writeup: () =>
      work.length
        ? { state: "done", detail: `${work.length} entr${work.length === 1 ? "y" : "ies"}, last ${dmy(work[0].work_date)}`, href: "tab:job" }
        : { state: "pending", detail: "No Work Completed entry", href: "tab:job" },
    handover_docs: () => {
      const signed = signs.find((s) => s.document_type === "handover" && s.status === "signed");
      if (signed) return { state: "done", detail: `Handover accepted ${dmy(signed.signed_at)}`, href: siteHref };
      const onFile = docs.filter((d) => d.category === "handover");
      if (onFile.length) return { state: "done", detail: `${onFile.length} handover file${onFile.length === 1 ? "" : "s"} on the site`, href: siteHref };
      const sent = signs.find((s) => s.document_type === "handover" && (s.status === "sent" || s.status === "viewed"));
      if (sent) return { state: "pending", detail: `Handover sent ${dmy(sent.sent_at)}, not accepted`, href: siteHref };
      return { state: "pending", detail: "Handover not sent", href: siteHref };
    },
    final_invoice: () => {
      if (!hasProgressQuote) return { state: "na", detail: quotes.length ? "Single-invoice quote" : "No progress quote", href: null };
      return invoiceState(pp2Inv, "PP2 generates when the job moves to Ready to Invoice");
    },
    final_paid: () => {
      if (!hasProgressQuote) return { state: "na", detail: quotes.length ? "Single-invoice quote" : "No progress quote", href: null };
      return paidState(pp2Inv, !!acceptedQuote?.pp2_paid, "PP2");
    },
    complete: () =>
      statusName === "Complete"
        ? { state: "done", detail: "Status Complete", href: null }
        : statusName === "No Charge" || statusName === "Cancelled"
          ? { state: "na", detail: `Status ${statusName}`, href: null }
          : { state: "pending", detail: statusName ? `Status ${statusName}` : null, href: null },
  };

  const keys = set === "fitout" ? DEFS.map((d) => d.key) : SERVICE_KEYS;
  const steps: ProgressStep[] = [];
  for (const key of keys) {
    const def = DEFS.find((d) => d.key === key)!;
    if (set === "service" && key === "install_checklist" && checklist.length === 0) continue;
    const auto = compute[key]();
    const m = manual.get(key) ?? null;
    let state = auto.state;
    let by: string | null = null;
    let detail = auto.detail;
    if (m) {
      if (m.state === "na") {
        state = "na";
        by = m.done_by_text;
        detail = m.note ? `N/A — ${m.note}` : "Marked N/A";
      } else if (auto.state !== "done") {
        state = "done";
        by = m.done_by_text;
        detail = m.note ? m.note : def.source === "auto" ? "Ticked by hand" : null;
      }
    }
    const label = set === "service" && key === "deposit_invoice" ? "Invoice sent" : set === "service" && key === "deposit_paid" ? "Invoice paid" : def.label;
    steps.push({
      key,
      group: def.group,
      label,
      hint: def.hint,
      source: def.source,
      state,
      detail,
      href: auto.href,
      by,
      manual: m ? { state: m.state, by: m.done_by_text, at: m.done_at, note: m.note } : null,
    });
  }

  const counted = steps.filter((s) => s.state !== "na");
  const done = counted.filter((s) => s.state === "done").length;
  return {
    set,
    steps,
    done,
    total: counted.length,
    next: steps.find((s) => s.state === "pending") ?? null,
  };
}
