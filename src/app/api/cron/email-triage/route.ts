import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  listInboxMessagesSince,
  forwardMessage,
  setMessageCategories,
  markMessageRead,
  getAssistantFolderId,
  moveMessage,
} from "@/lib/msgraph/messages";
import { classifyEmail, type TriageVerdict } from "@/lib/triage/classify";

/**
 * Email triage sweep — every 30 minutes (assistant-CONTEXT.md D5–D7).
 *
 * For each of the three mailboxes: pull Inbox mail newer than the stored
 * watermark, classify with Claude, then act by tier:
 *   bill   → forward to the Xero Bills inbox + categorise (LIVE mode only)
 *   action → create a My List task for Mitchell with the Outlook deep link
 *   fyi/noise → categorise only
 *
 * TRIAGE_MODE env var: "observe" (default) classifies and logs to the
 * email_triage ledger but touches NOTHING — no forwards, no categories, no
 * tasks. Flip to "live" once Mitchell has reviewed the ledger's judgement.
 *
 * Phase 4 (2026-09-25, Mitchell): Mark's mailbox joins. Per mailbox:
 *   - `tasks`: action/lead become My List tasks for Mitchell (his mailboxes)
 *   - `leadsTo`: a "lead" (new enquiry, tender, plans/drawings to price) is
 *     forwarded there with a 3-line summary (Mark's mailbox → Mitchell)
 *   Mark gets no CRM access — his "needs you" items stay in his inbox with a
 *   category, and /api/cron/mailbox-digest emails him a morning summary.
 *   Mode is per mailbox: TRIAGE_MODE=live turns everything live except
 *   TRIAGE_OBSERVE_MAILBOXES; TRIAGE_LIVE_MAILBOXES turns single mailboxes live
 *   while the rest observe. TRIAGE_SORT_MAILBOXES = the shadow week: sorting
 *   (categories, junk filed) is live, forwards/tasks are only reported.
 *   The ledger's classification column predates "lead", so a lead is stored as
 *   classification "action" with action_taken lead_forwarded / observed_lead.
 *
 * First run per mailbox only sets the watermark — history is never swept.
 * Hard rails: Inbox-only reads; the only outbound emails are internal
 * forwards (Xero Bills inbox, Mitchell) — never to a customer or supplier. Auth: X-Cf-Cron-Secret matches CRON_SECRET.
 */

const OWNER_EMAIL = "mitchell@centrefit.com.au";
type MailboxRule = { mailbox: string; tasks: boolean; leadsTo: string | null };
const MAILBOXES: MailboxRule[] = [
  { mailbox: "mitchell@centrefit.com.au", tasks: true, leadsTo: null },
  { mailbox: "admin@centrefit.com.au", tasks: true, leadsTo: null },
  { mailbox: "accounts@centrefit.com.au", tasks: true, leadsTo: null },
  { mailbox: "mark@centrefit.com.au", tasks: false, leadsTo: OWNER_EMAIL },
];
const list = (v: string | undefined) => (v ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
function modeFor(mailbox: string): "live" | "sort" | "observe" {
  const m = mailbox.toLowerCase();
  // "sort" = the shadow week (Mitchell, 25 Sep): categories + junk filing live,
  // forwards and tasks only reported. Checked first so it can't be skipped.
  if (list(process.env.TRIAGE_SORT_MAILBOXES).includes(m)) return "sort";
  if (process.env.TRIAGE_MODE === "live") return list(process.env.TRIAGE_OBSERVE_MAILBOXES).includes(m) ? "observe" : "live";
  return list(process.env.TRIAGE_LIVE_MAILBOXES).includes(m) ? "live" : "observe";
}
const BATCH_PER_MAILBOX = 20;

const CATEGORY_BY_CLASS: Record<TriageVerdict["classification"], string> = {
  bill: "Assistant: Bill → Xero",
  action: "Assistant: Needs you",
  fyi: "Assistant: FYI",
  noise: "Assistant: Noise",
  lead: "Assistant: Lead",
};

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided =
    req.headers.get("x-cf-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const xeroBillsEmail = process.env.XERO_BILLS_EMAIL ?? "";
  const svc = createServiceRoleClient();

  const { data: owner } = await svc
    .from("staff")
    .select("id")
    .eq("email", OWNER_EMAIL)
    .single();
  if (!owner) {
    return NextResponse.json({ error: `No staff row for ${OWNER_EMAIL}` }, { status: 500 });
  }

  const results: Array<Record<string, unknown>> = [];

  for (const rule of MAILBOXES) {
    const { mailbox } = rule;
    const mode = modeFor(mailbox);
    const { data: state } = await svc
      .from("email_triage_state")
      .select("last_swept_at")
      .eq("mailbox", mailbox)
      .single();

    // First sighting of a mailbox: stamp the watermark and move on. Only
    // mail that arrives from now on is triaged — never the backlog.
    if (!state) {
      await svc.from("email_triage_state").insert({ mailbox, last_swept_at: new Date().toISOString() });
      results.push({ mailbox, initialised: true });
      continue;
    }

    let messages;
    try {
      messages = await listInboxMessagesSince(mailbox, state.last_swept_at, BATCH_PER_MAILBOX);
    } catch (err) {
      results.push({ mailbox, error: `graph list failed: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }

    let processed = 0;
    for (const msg of messages) {
      // Watermark can lag behind processed mail after a partial failure —
      // the ledger's unique index is the real dedupe.
      const { data: seen } = await svc
        .from("email_triage")
        .select("id")
        .eq("mailbox", mailbox)
        .eq("graph_message_id", msg.id)
        .maybeSingle();
      if (seen) {
        await svc
          .from("email_triage_state")
          .update({ last_swept_at: msg.receivedDateTime, updated_at: new Date().toISOString() })
          .eq("mailbox", mailbox);
        continue;
      }

      const verdict = await classifyEmail({
        mailbox,
        fromName: msg.from?.emailAddress?.name ?? null,
        fromAddress: msg.from?.emailAddress?.address ?? null,
        subject: msg.subject,
        bodyText: msg.body?.content ?? msg.bodyPreview ?? "",
        hasAttachments: msg.hasAttachments,
      });

      // A lead in a mailbox with nowhere to send it is just an action.
      const isLead = verdict.classification === "lead";
      let actionTaken = isLead ? "observed_lead" : "observed";
      let taskId: string | null = null;
      let actionError: string | null = null;

      if (mode !== "observe") {
        try {
          if (mode === "sort") {
            // Shadow week: sort only — categories + junk filed, nothing forwarded, no tasks.
            if (!isLead) actionTaken = "categorised";
          } else if (verdict.classification === "bill") {
            if (!xeroBillsEmail) throw new Error("XERO_BILLS_EMAIL not configured");
            await forwardMessage(
              mailbox,
              msg.id,
              xeroBillsEmail,
              `Auto-forwarded to Xero Bills by the Centrefit CRM assistant. Supplier: ${verdict.billSupplier ?? "unknown"}.`,
            );
            actionTaken = "forwarded_to_xero";
          } else if (isLead && rule.leadsTo) {
            await forwardMessage(
              mailbox,
              msg.id,
              rule.leadsTo,
              `New lead or plans from ${mailbox.split("@")[0]}'s inbox, auto-forwarded by the Centrefit assistant.\n\n${verdict.leadSummary ?? verdict.reason}`,
            );
            actionTaken = "lead_forwarded";
          } else if ((verdict.classification === "action" || isLead) && rule.tasks) {
            const { data: task, error: taskErr } = await svc
              .from("personal_tasks")
              .upsert(
                {
                  owner_id: owner.id,
                  title: verdict.actionSummary ?? `Review email: ${(msg.subject ?? "").slice(0, 70)}`,
                  notes: `${msg.from?.emailAddress?.name ?? ""} <${msg.from?.emailAddress?.address ?? ""}> — ${verdict.reason}`,
                  source: "email",
                  source_ref: `${mailbox}:${msg.id}`,
                  href: msg.webLink,
                },
                { onConflict: "owner_id,source,source_ref", ignoreDuplicates: true },
              )
              .select("id")
              .maybeSingle();
            if (taskErr) throw taskErr;
            taskId = task?.id ?? null;
            actionTaken = "task_created";
          } else if (verdict.classification === "action") {
            actionTaken = "categorised";   // no CRM tasks for this mailbox — it's in the morning digest
          } else {
            actionTaken = "categorised";
          }
          // Category first — a move re-issues the message id (Graph quirk).
          await setMessageCategories(mailbox, msg.id, [CATEGORY_BY_CLASS[verdict.classification]]);
          // Noise: tag + mark read + file to the Assistant folder (Mitchell,
          // 2026-07-29). FYI stays visible and unread in the inbox.
          if (verdict.classification === "noise") {
            await markMessageRead(mailbox, msg.id);
            await moveMessage(mailbox, msg.id, await getAssistantFolderId(mailbox));
            actionTaken = "filed_as_noise";
          }
        } catch (err) {
          actionTaken = "error";
          actionError = err instanceof Error ? err.message : String(err);
        }
      }

      const { error: ledgerErr } = await svc.from("email_triage").insert({
        mailbox,
        graph_message_id: msg.id,
        internet_message_id: msg.internetMessageId,
        received_at: msg.receivedDateTime,
        from_address: msg.from?.emailAddress?.address ?? null,
        from_name: msg.from?.emailAddress?.name ?? null,
        subject: msg.subject,
        classification: isLead ? "action" : verdict.classification,
        reason: isLead ? `LEAD: ${verdict.leadSummary ?? verdict.reason}`.slice(0, 1000) : verdict.reason,
        bill_supplier: verdict.billSupplier,
        action_taken: actionTaken,
        task_id: taskId,
        error: actionError,
      });
      if (ledgerErr) {
        // Without a ledger row the message would be reclassified forever —
        // stop this mailbox and leave the watermark where it is.
        results.push({ mailbox, error: `ledger insert failed: ${ledgerErr.message}` });
        break;
      }

      await svc
        .from("email_triage_state")
        .update({ last_swept_at: msg.receivedDateTime, updated_at: new Date().toISOString() })
        .eq("mailbox", mailbox);
      processed += 1;
    }

    results.push({ mailbox, mode, fetched: messages.length, processed });
  }

  return NextResponse.json({ ok: true, results });
}
