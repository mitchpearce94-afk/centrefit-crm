import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { listInboxMessagesSince, forwardMessage, setMessageCategories } from "@/lib/msgraph/messages";
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
 * First run per mailbox only sets the watermark — history is never swept.
 * Hard rails: Inbox-only reads, forward-to-Xero is the sole outbound email,
 * never to a customer. Auth: X-Cf-Cron-Secret matches CRON_SECRET.
 */

const MAILBOXES = [
  "mitchell@centrefit.com.au",
  "admin@centrefit.com.au",
  "accounts@centrefit.com.au",
];
const OWNER_EMAIL = "mitchell@centrefit.com.au";
const BATCH_PER_MAILBOX = 20;

const CATEGORY_BY_CLASS: Record<TriageVerdict["classification"], string> = {
  bill: "Assistant: Bill → Xero",
  action: "Assistant: Needs you",
  fyi: "Assistant: FYI",
  noise: "Assistant: Noise",
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

  const mode = process.env.TRIAGE_MODE === "live" ? "live" : "observe";
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

  for (const mailbox of MAILBOXES) {
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

      let actionTaken = "observed";
      let taskId: string | null = null;
      let actionError: string | null = null;

      if (mode === "live") {
        try {
          if (verdict.classification === "bill") {
            if (!xeroBillsEmail) throw new Error("XERO_BILLS_EMAIL not configured");
            await forwardMessage(
              mailbox,
              msg.id,
              xeroBillsEmail,
              `Auto-forwarded to Xero Bills by the Centrefit CRM assistant. Supplier: ${verdict.billSupplier ?? "unknown"}.`,
            );
            actionTaken = "forwarded_to_xero";
          } else if (verdict.classification === "action") {
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
          } else {
            actionTaken = "categorised";
          }
          await setMessageCategories(mailbox, msg.id, [CATEGORY_BY_CLASS[verdict.classification]]);
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
        classification: verdict.classification,
        reason: verdict.reason,
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

    results.push({ mailbox, fetched: messages.length, processed });
  }

  return NextResponse.json({ ok: true, mode, results });
}
