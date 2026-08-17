import "server-only";
import { Resend } from "resend";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";
import { FROM_NO_REPLY } from "@/lib/emails/from-addresses";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export interface DigestTaskLine {
  title: string;
  daysOnList: number;
  overdue: boolean;
  href: string | null;
}

export interface DigestInvoiceLine {
  ref: string;
  customer: string;
  amountDue: number;
  daysOverdue: number;
}

export interface MorningDigestInput {
  to: string;
  dateLabel: string; // "Tuesday 29 July"
  tasks: DigestTaskLine[];
  overdueInvoices: { count: number; total: number; top: DigestInvoiceLine[] };
  unsentInvoices: { count: number; total: number };
  pendingMandates: { count: number; monthlyValue: number; oldestDays: number };
  /** Jobs worked yesterday (time entries / plan ticks) with no Work
   *  Completed entry for that day — Mitchell 2026-08-18. */
  unfilledWriteups: Array<{ number: string; where: string; techs: string; href: string }>;
  /** Email triage ledger over the last 24h — null until Phase 3 is live. */
  emailTriage: {
    mode: "observe" | "live";
    billsForwarded: number;
    flagged: number;
    fyi: number;
    noise: number;
    errors: number;
  } | null;
  appBaseUrl: string;
}

function fmt(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtShort(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`;
}

function section(title: string, inner: string): string {
  return `
    <tr><td style="padding:18px 32px 0">
      <p style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin:0 0 8px">${title}</p>
      ${inner}
    </td></tr>`;
}

function row(main: string, right: string, sub?: string): string {
  return `
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:8px">
      <tr>
        <td style="font-size:13px;color:#0f172a">${main}${sub ? `<br><span style="font-size:11px;color:#94a3b8">${sub}</span>` : ""}</td>
        <td align="right" style="font-size:13px;color:#475569;white-space:nowrap;vertical-align:top">${right}</td>
      </tr>
    </table>`;
}

/**
 * Build the subject up front so the numbers do the triage from the inbox list
 * view (assistant-CONTEXT.md D3). The caller must NOT send when everything is
 * empty — silence is the all-clear signal.
 */
export function digestSubject(input: MorningDigestInput): string {
  const bits: string[] = [];
  if (input.tasks.length > 0) bits.push(`${input.tasks.length} for you`);
  if (input.overdueInvoices.count > 0) bits.push(`${fmtShort(input.overdueInvoices.total)} overdue`);
  if (input.unsentInvoices.count > 0) bits.push(`${input.unsentInvoices.count} unsent`);
  if (input.pendingMandates.count > 0) bits.push(`${input.pendingMandates.count} unsigned`);
  if (input.unfilledWriteups.length > 0) bits.push(`${input.unfilledWriteups.length} unfilled`);
  return `Morning brief — ${bits.join(" · ")}`;
}

export async function sendMorningDigestEmail(
  input: MorningDigestInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const taskRows = input.tasks
    .map((t) => {
      const title = t.href
        ? `<a href="${t.href.startsWith("http") ? t.href : input.appBaseUrl + t.href}" style="color:#0f172a;text-decoration:none">${t.title}</a>`
        : t.title;
      const age =
        t.daysOnList >= 4
          ? `<span style="color:#d97706;font-weight:600">day ${t.daysOnList}</span>`
          : t.daysOnList >= 1
            ? `day ${t.daysOnList}`
            : "new";
      return row(`${t.overdue ? "🔴 " : ""}${title}`, age);
    })
    .join("");

  const invoiceRows = input.overdueInvoices.top
    .map((i) => row(`${i.ref} — ${i.customer}`, `$${fmt(i.amountDue)} · ${i.daysOverdue}d`))
    .join("");

  const moneyBits: string[] = [];
  if (input.overdueInvoices.count > 0) {
    moneyBits.push(
      row(
        `<strong>$${fmt(input.overdueInvoices.total)}</strong> overdue across ${input.overdueInvoices.count} invoice${input.overdueInvoices.count === 1 ? "" : "s"}`,
        `<a href="${input.appBaseUrl}/invoices?tab=overdue" style="color:#3b82f6;text-decoration:none">Open →</a>`,
      ) + invoiceRows,
    );
  }
  if (input.unsentInvoices.count > 0) {
    moneyBits.push(
      row(
        `<strong>${input.unsentInvoices.count}</strong> authorised but never emailed ($${fmt(input.unsentInvoices.total)})`,
        `<a href="${input.appBaseUrl}/invoices?tab=unsent" style="color:#3b82f6;text-decoration:none">Open →</a>`,
      ),
    );
  }

  const html = emailLayout(`
    ${emailHeader({ rightLabel: "Brief", rightValue: input.dateLabel })}
    <tr><td style="padding:28px 32px 0">
      <h1 style="font-size:19px;font-weight:600;color:#0f172a;margin:0;letter-spacing:-0.3px">Morning, Mitchell</h1>
    </td></tr>
    ${input.tasks.length ? section(`Your list · ${input.tasks.length}`, taskRows) : ""}
    ${
      input.unfilledWriteups.length
        ? section(
            `Unfilled write-ups · yesterday`,
            input.unfilledWriteups
              .map((j) =>
                row(
                  `<a href="${input.appBaseUrl}${j.href}" style="color:#0f172a;text-decoration:none"><strong>${j.number}</strong> — ${j.where}</a>`,
                  j.techs || "—",
                ),
              )
              .join(""),
          )
        : ""
    }
    ${moneyBits.length ? section("Money", moneyBits.join("")) : ""}
    ${
      input.pendingMandates.count
        ? section(
            "Billing safety",
            row(
              `<strong>${input.pendingMandates.count}</strong> unsigned mandate${input.pendingMandates.count === 1 ? "" : "s"} — $${fmt(input.pendingMandates.monthlyValue)}/mo not being collected`,
              `oldest ${input.pendingMandates.oldestDays}d · <a href="${input.appBaseUrl}/invoices/recurring?tab=pending" style="color:#3b82f6;text-decoration:none">Open →</a>`,
            ),
          )
        : ""
    }
    ${
      input.emailTriage && (input.emailTriage.billsForwarded || input.emailTriage.flagged || input.emailTriage.errors)
        ? section(
            `Email triage · last 24h${input.emailTriage.mode === "observe" ? " (observe mode — nothing touched)" : ""}`,
            row(
              [
                input.emailTriage.billsForwarded ? `<strong>${input.emailTriage.billsForwarded}</strong> bill${input.emailTriage.billsForwarded === 1 ? "" : "s"} ${input.emailTriage.mode === "live" ? "forwarded to Xero" : "spotted"}` : null,
                input.emailTriage.flagged ? `<strong>${input.emailTriage.flagged}</strong> flagged for you` : null,
                input.emailTriage.errors ? `<span style="color:#dc2626"><strong>${input.emailTriage.errors}</strong> error${input.emailTriage.errors === 1 ? "" : "s"}</span>` : null,
              ].filter(Boolean).join(" · "),
              `${input.emailTriage.fyi + input.emailTriage.noise} filed quietly`,
            ),
          )
        : ""
    }
    <tr><td align="center" style="padding:24px 32px 8px;text-align:center">
      <a href="${input.appBaseUrl}/my-list" style="display:inline-block;background:#3b82f6;color:#ffffff;padding:12px 26px;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none">Open My List</a>
    </td></tr>
    ${emailFooter("Sent weekday mornings — only when something actually needs you.")}
  `);

  try {
    const { error } = await getResend().emails.send({
      from: FROM_NO_REPLY,
      to: [input.to],
      subject: digestSubject(input),
      html,
      headers: { "X-Cf-Doc-Type": "morning-digest" },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
