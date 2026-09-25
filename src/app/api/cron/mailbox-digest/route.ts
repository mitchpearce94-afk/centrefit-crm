import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { FROM_NO_REPLY } from "@/lib/emails/from-addresses";

/**
 * Weekday 7:00am AEST — Mark's mailbox summary (assistant-CONTEXT.md Phase 4,
 * 2026-09-25). Mark has no CRM access (Mitchell: "keep that part separate"),
 * so what the triage did with his inbox reaches him as one plain email:
 * leads/plans sent to Mitchell, bills sent to Xero, what needs him, noise filed.
 * While his mailbox is in observe mode (the shadow week) it says "would have".
 *
 * Silent when empty. Mondays cover the weekend. Only internal recipients.
 * Auth: X-Cf-Cron-Secret / Bearer matches CRON_SECRET.
 */

const DIGESTS = [{ mailbox: "mark@centrefit.com.au", to: "mark@centrefit.com.au", name: "Mark" }];

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function isLive(mailbox: string): boolean {
  const list = (v?: string) => (v ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (list(process.env.TRIAGE_SORT_MAILBOXES).includes(mailbox)) return false;   // shadow week
  if (process.env.TRIAGE_MODE === "live") return !list(process.env.TRIAGE_OBSERVE_MAILBOXES).includes(mailbox);
  return list(process.env.TRIAGE_LIVE_MAILBOXES).includes(mailbox);
}

type Row = {
  from_name: string | null; from_address: string | null; subject: string | null;
  classification: string; action_taken: string; reason: string | null; bill_supplier: string | null;
  graph_message_id: string; received_at: string;
};

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cf-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (provided !== secret) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const svc = createServiceRoleClient();
  const now = new Date();
  const weekday = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", weekday: "long" }).format(now);
  const since = new Date(now.getTime() - (weekday === "Monday" ? 72 : 24) * 3600_000).toISOString();
  const dateLabel = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", weekday: "long", day: "numeric", month: "long" }).format(now);
  const out: Array<Record<string, unknown>> = [];

  for (const d of DIGESTS) {
    const { data, error } = await svc
      .from("email_triage")
      .select("from_name, from_address, subject, classification, action_taken, reason, bill_supplier, graph_message_id, received_at")
      .eq("mailbox", d.mailbox)
      .gte("created_at", since)
      .order("received_at", { ascending: true });
    if (error) { out.push({ mailbox: d.mailbox, error: error.message }); continue; }
    const rows = (data ?? []) as Row[];
    if (!rows.length) { out.push({ mailbox: d.mailbox, sent: false, reason: "nothing to report" }); continue; }

    const live = isLive(d.mailbox);
    const sorting = (process.env.TRIAGE_SORT_MAILBOXES ?? "").toLowerCase().split(",").map((x) => x.trim()).includes(d.mailbox);
    const leads = rows.filter((r) => r.action_taken === "lead_forwarded" || r.action_taken === "observed_lead");
    const bills = rows.filter((r) => r.classification === "bill");
    const needs = rows.filter((r) => r.classification === "action" && !leads.includes(r));
    const fyi = rows.filter((r) => r.classification === "fyi").length;
    const noise = rows.filter((r) => r.classification === "noise").length;
    const errors = rows.filter((r) => r.action_taken === "error").length;
    const who = (r: Row) => esc(r.from_name || r.from_address || "Unknown sender");
    const open = (r: Row) => `https://outlook.office365.com/owa/?ItemID=${encodeURIComponent(r.graph_message_id)}&exvsurl=1&viewmodel=ReadMessageItem`;

    const section = (title: string, items: string[]) => items.length
      ? `<h2 style="font-size:22px;margin:28px 0 10px;color:#111">${title}</h2><ul style="padding-left:22px;margin:0">${items.join("")}</ul>` : "";
    const li = (html: string) => `<li style="margin:0 0 14px;font-size:19px;line-height:1.5;color:#111">${html}</li>`;

    const html = `<!doctype html><html><body style="margin:0;background:#ffffff">
<div style="max-width:640px;margin:0 auto;padding:24px 20px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111">
<p style="font-size:20px;margin:0 0 6px"><strong>Morning ${esc(d.name)}</strong> — your inbox, ${esc(dateLabel)}</p>
${live ? "" : `<p style="font-size:18px;background:#fff4d6;border-left:6px solid #d97706;padding:10px 14px;margin:14px 0">Practice week: nothing has been forwarded yet${sorting ? " (sorting and junk filing are on)" : ""}. This shows what the assistant <strong>would</strong> have sent. Tell Mitchell if anything looks wrong.</p>`}
${section(live ? `Sent to Mitchell — leads and plans (${leads.length})` : `Would send to Mitchell — leads and plans (${leads.length})`,
  leads.map((r) => li(`<strong>${who(r)}</strong> — ${esc(r.subject)}<br><span style="color:#333">${esc((r.reason ?? "").replace(/^LEAD:\s*/, ""))}</span>`)))}
${section(`Needs you (${needs.length})`, needs.map((r) => li(`<a href="${open(r)}" style="color:#0a4fd6"><strong>${who(r)}</strong> — ${esc(r.subject)}</a><br><span style="color:#333">${esc(r.reason)}</span>`)))}
${section(live ? `Bills sent to Xero (${bills.length})` : `Bills it would send to Xero (${bills.length})`,
  bills.map((r) => li(`<strong>${esc(r.bill_supplier || r.from_name || r.from_address)}</strong> — ${esc(r.subject)}`)))}
<p style="font-size:18px;margin:28px 0 0;color:#333">Also: ${fyi} for your info, ${noise} junk or marketing ${live || sorting ? "filed out of your inbox" : "(would be filed)"}.${errors ? ` ${errors} couldn't be handled — they're untouched in your inbox.` : ""}</p>
<p style="font-size:15px;margin:24px 0 0;color:#555">From the Centrefit assistant. Nothing is ever deleted, and it never emails customers or suppliers.</p>
</div></body></html>`;

    const resend = new Resend(process.env.RESEND_API_KEY);
    const subject = `Your inbox: ${leads.length} lead${leads.length === 1 ? "" : "s"}, ${needs.length} need${needs.length === 1 ? "s" : ""} you${live ? "" : " (practice week)"}`;
    const { error: sendErr } = await resend.emails.send({ from: FROM_NO_REPLY, to: d.to, subject, html });
    out.push({ mailbox: d.mailbox, sent: !sendErr, error: sendErr?.message, leads: leads.length, needs: needs.length, bills: bills.length });
  }
  return NextResponse.json({ ok: true, results: out });
}
