import "server-only";
import { Resend } from "resend";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";
import { FROM_NO_REPLY } from "@/lib/emails/from-addresses";
import type { WorkStatusReport, ReportItem, Section, StaffBucket } from "@/lib/work-status/report";

/**
 * Work status report email (Mark, 14 Oct 2026). Big text, one line per job,
 * a CRM link on every line, grouped by section then by person. Health per
 * section = (checked − flagged) / checked: green ≥ 90, amber 70–89, red < 70.
 */

export const SECTION_META: Record<Section, { title: string; blurb: string }> = {
  not_written_up:      { title: "Worked on, not written up",      blurb: "The visit has finished and Work Completed is still empty." },
  no_diary:            { title: "Being worked, nothing in the diary", blurb: "Scheduled / In Progress with no diary entry at all." },
  not_sent_to_invoice: { title: "Written up, not sent to invoice", blurb: "Last visit 2+ days ago, nothing booked, still sitting in a work status." },
  sent_no_writeup:     { title: "Sent to invoice with no write-up", blurb: "Ready to Invoice / Complete and Work Completed is empty — fix before Accounts touches it." },
  awaiting_invoicing:  { title: "Waiting to be invoiced",          blurb: "Ready to Invoice, or Complete with no invoice. This is the money." },
  no_status:           { title: "No status",                       blurb: "Jobs with no status at all." },
};
const ORDER: Section[] = ["not_written_up", "no_diary", "not_sent_to_invoice", "sent_no_writeup", "awaiting_invoicing", "no_status"];

const money = (n: number) => "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const esc = (s: string | null | undefined) => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function health(checked: number, flagged: number): { pct: number; colour: string; word: string } {
  const pct = checked > 0 ? Math.max(0, Math.round(((checked - flagged) / checked) * 100)) : 100;
  return pct >= 90 ? { pct, colour: "#16a34a", word: "Healthy" } : pct >= 70 ? { pct, colour: "#d97706", word: "Watch" } : { pct, colour: "#dc2626", word: "Fix" };
}

function line(it: ReportItem, showStaff?: string): string {
  const age = it.day_on_list >= 5 ? `<span style="color:#dc2626;font-weight:700">day ${it.day_on_list}</span>` : it.day_on_list > 1 ? `day ${it.day_on_list}` : "new";
  const value = it.value_ex_gst != null ? ` · <strong>${money(it.value_ex_gst)}</strong>` : it.section === "awaiting_invoicing" ? ` · <span style="color:#94a3b8">no value recorded</span>` : "";
  const where = [it.customer, it.site].filter(Boolean).map(esc).join(" — ");
  return `
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 10px">
      <tr>
        <td style="font-size:15px;line-height:1.4;color:#0f172a">
          <a href="${it.url}" style="color:#0f172a;text-decoration:none"><strong>${esc(it.number)}</strong>${it.reference ? ` — ${esc(it.reference)}` : ""}</a>
          <br><span style="font-size:13px;color:#475569">${where}${showStaff ? ` · ${esc(showStaff)}` : ""}</span>
          <br><span style="font-size:13px;color:#64748b">${esc(it.detail)}${value}</span>
        </td>
        <td align="right" valign="top" style="font-size:13px;color:#475569;white-space:nowrap;padding-left:12px">${age}</td>
      </tr>
    </table>`;
}

function sectionBlock(sec: Section, items: ReportItem[], checked: number, byStaff: boolean, staffName: (id: string) => string): string {
  const h = health(checked, new Set(items.map((i) => i.job_id)).size);
  const meta = SECTION_META[sec];
  let body = "";
  if (!items.length) {
    body = `<p style="font-size:14px;color:#16a34a;margin:0">Nothing here. ✔</p>`;
  } else if (byStaff) {
    const groups = new Map<string, ReportItem[]>();
    for (const it of items) for (const sid of it.staff_ids.length ? it.staff_ids : ["—"]) { const l = groups.get(sid) ?? []; l.push(it); groups.set(sid, l); }
    body = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([sid, list]) => `
        <p style="font-size:13px;font-weight:700;color:#334155;margin:12px 0 6px">${esc(sid === "—" ? "Unassigned" : staffName(sid))} · ${list.length}</p>
        ${list.map((it) => line(it)).join("")}`)
      .join("");
  } else {
    body = items.map((it) => line(it)).join("");
  }
  return `
    <tr><td style="padding:22px 32px 0">
      <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td style="font-size:17px;font-weight:700;color:#0f172a">${meta.title} <span style="color:#64748b;font-weight:500">· ${items.length}</span></td>
          <td align="right" style="white-space:nowrap">
            <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${h.colour};color:#fff;font-size:12px;font-weight:700">${h.pct}% · ${h.word}</span>
          </td>
        </tr>
      </table>
      <p style="font-size:12px;color:#94a3b8;margin:2px 0 10px">${meta.blurb}${checked ? ` Checked ${checked}.` : ""}</p>
      ${body}
    </td></tr>`;
}

export interface WorkStatusEmailInput {
  report: WorkStatusReport;
  /** Whole report (Mark / admins) or one person's slice. */
  scope: { kind: "all" } | { kind: "staff"; bucket: StaffBucket };
  to: string;
  greetingName: string;
  dateLabel: string;
}

export function renderWorkStatusEmail(input: WorkStatusEmailInput): { subject: string; html: string; itemCount: number } {
  const { report, scope } = input;
  const items = scope.kind === "all" ? report.items : scope.bucket.items;
  const staffName = (id: string) => report.staff.find((s) => s.id === id)?.name ?? "—";
  const checkedFor: Record<Section, number> = {
    not_written_up: report.checked.visits, no_diary: report.checked.worked_jobs, not_sent_to_invoice: report.checked.worked_jobs,
    sent_no_writeup: report.checked.sent_to_invoice, awaiting_invoicing: report.checked.sent_to_invoice, no_status: report.checked.jobs,
  };
  const awaitingValue = items.filter((i) => i.section === "awaiting_invoicing").reduce((s, i) => s + (i.value_ex_gst ?? 0), 0);
  const oldest = items.filter((i) => i.section === "awaiting_invoicing").sort((a, b) => b.days - a.days)[0];
  const overall = health(ORDER.reduce((s, k) => s + checkedFor[k], 0), new Set(items.filter((i) => i.section !== "awaiting_invoicing").map((i) => i.job_id)).size);

  const bits: string[] = [];
  const c = (s: Section) => items.filter((i) => i.section === s).length;
  if (c("not_written_up")) bits.push(`${c("not_written_up")} not written up`);
  if (c("sent_no_writeup")) bits.push(`${c("sent_no_writeup")} sent blank`);
  if (c("awaiting_invoicing")) bits.push(`${c("awaiting_invoicing")} to invoice${awaitingValue ? ` (${money(awaitingValue)})` : ""}`);
  if (c("no_status")) bits.push(`${c("no_status")} no status`);
  const subject = `Work status report — ${input.dateLabel}${bits.length ? ` — ${bits.join(" · ")}` : " — all clear"}`;

  const cleared = scope.kind === "all" ? report.cleared_since_last : [];
  const html = emailLayout(`
    ${emailHeader({ rightLabel: "Work status", rightValue: input.dateLabel })}
    <tr><td style="padding:28px 32px 0">
      <h1 style="font-size:21px;font-weight:700;color:#0f172a;margin:0 0 6px;letter-spacing:-0.3px">${scope.kind === "all" ? "Work status report" : `Your work status, ${esc(input.greetingName)}`}</h1>
      <p style="font-size:14px;color:#475569;margin:0">
        ${items.length ? `<strong>${items.length}</strong> item${items.length === 1 ? "" : "s"} on the list` : "Nothing on the list"}${oldest ? ` · oldest waiting <strong>${oldest.days} days</strong> (${esc(oldest.number)})` : ""}.
        <span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;background:${overall.colour};color:#fff;font-size:11px;font-weight:700">${overall.pct}% · ${overall.word}</span>
      </p>
      <p style="font-size:12px;color:#94a3b8;margin:6px 0 0">A job stays on this list until it is written up <em>and</em> sent to invoice. If we don't finish the job it can't be invoiced, and if it isn't invoiced we don't get paid.</p>
    </td></tr>
    ${ORDER.map((sec) => sectionBlock(sec, items.filter((i) => i.section === sec), checkedFor[sec], scope.kind === "all", staffName)).join("")}
    ${cleared.length && scope.kind === "all" ? `
    <tr><td style="padding:22px 32px 0">
      <p style="font-size:13px;font-weight:700;color:#16a34a;margin:0 0 6px">Cleared since the last report · ${cleared.length}</p>
      <p style="font-size:13px;color:#475569;margin:0">${cleared.map((cl) => `<strong>${esc(cl.number)}</strong>${cl.reference ? ` — ${esc(cl.reference)}` : ""} <span style="color:#94a3b8">(${SECTION_META[cl.section].title.toLowerCase()})</span>`).join("<br>")}</p>
    </td></tr>` : ""}
    <tr><td style="padding:24px 32px 0"><p style="font-size:12px;color:#94a3b8;margin:0">Weekdays at 4pm from the CRM. Mute it under Settings → Notifications → "Work status report (4pm)".</p></td></tr>
    ${emailFooter()}
  `);
  return { subject, html, itemCount: items.length };
}

export async function sendWorkStatusEmail(input: WorkStatusEmailInput): Promise<{ ok: true; subject: string } | { ok: false; error: string }> {
  const { subject, html } = renderWorkStatusEmail(input);
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({ from: FROM_NO_REPLY, to: input.to, subject, html });
    if (error) return { ok: false, error: error.message };
    return { ok: true, subject };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
