# Personal Ops Assistant — CONTEXT

> Locked 2026-07-29 with Mitchell. Task inbox + morning digest + Outlook triage.
> Every implementation task references a decision below. Scope changes get a new
> decision here first — no silent trimming (GSD).

## The problem

Mitchell is drowning in inputs: three Outlook mailboxes, CRM notifications,
watchdog emails, suggestion queues, mental notes. Action items have no single
home, so things fall through the cracks. Fix = ONE trusted list, everything
flows into it, one pass a day.

## Decisions

**D1 — "My List": personal task inbox in the CRM.**
Table `personal_tasks`, page `/my-list`. Owner-only RLS with **no is_admin()
escape hatch** — Mitchell explicitly wants this private to his account; other
admins must not see it. Nav links (desktop sidebar + mobile More sheet) render
only for `user.email === "mitchell@centrefit.com.au"`. The table itself is
generic per-owner in case it's ever opened up.

**D2 — Task model.**
status: open / done / snoozed / waiting. Manual tasks: 2-tap quick add.
Automated tasks carry (source, source_ref) with a partial unique index for
idempotent upserts — a re-run cron can never duplicate a task, and a task
Mitchell has ticked (even wrongly) is never resurrected for the same
occurrence. Live counts in the digest are the safety net for mis-ticks.

**D3 — Morning digest: 7:00am AEST weekdays, email to mitchell@.**
Sent directly via Resend (not the notifications fan-out — it's personal, not a
staff broadcast). Anti-stale rules (Mitchell: "I don't want it to go stale"):
- **Silent when empty.** No content = no email. An "all clear" email trains
  him to ignore it.
- Only items past actionable thresholds, each with a day-counter ("day 4") so
  lingering items visibly escalate rather than blending in.
- Live queries at send time — never a snapshot that can drift.
- Subject line carries the numbers ("3 for you · $12.4k overdue") so triage
  starts in the inbox list view.

**D4 — Digest content + auto-tasks (V1).**
Sections: Your list (overdue / due today / stale >7d open) · Money (overdue
invoices sum + top 5, authorised-but-unsent count) · Billing safety (unsigned
mandates with $/mo). Auto-created tasks: one per unsent authorised invoice
(`invoice-unsent:<id>`), one per stale pending mandate
(`mandate-pending:<plan_id>`). Overdue invoices do NOT become tasks — the
reminder cron already chases those; the digest just shows the money picture.

**D5 — Phase 3: Outlook triage via Microsoft Graph (biggest value, next session).**
Mailboxes: mitchell@, admin@, accounts@ (all centrefit.com.au, M365 — see
memory: M365 not Google). Entra app registration in the Centrefit tenant,
client-credentials flow, application permissions `Mail.Read` + `Mail.Send` +
`Mail.ReadWrite`, scoped to exactly those three mailboxes via an
ApplicationAccessPolicy. Secrets in Vercel env. Sweep cron every 30 min during
business hours; processed message-ids recorded so nothing is classified twice.

**D6 — Triage tiers.** (Revised 2026-07-29 during build.)
Claude classifies each new message on `claude-opus-5` at low effort —
classification quality gates auto-actions, so it gets the default model, not
haiku (ANTHROPIC_API_KEY already in Vercel from receipts). Ambiguity always
downgrades to FLAG, in the prompt AND every error path:
- **BILL (auto)** — supplier bills/invoices → forwarded to the Xero Bills
  inbox (`XERO_BILLS_EMAIL`) with attachments, categorised in the mailbox.
  The ONLY executing auto-action in V1.
- **FLAG** — needs Mitchell: becomes a My List task (source `email`) with the
  Outlook webLink as the deep link.
- **FYI / NOISE** — categorised in the mailbox, never deleted, no task.
Every decision lands in the `email_triage` ledger and rolls up into the
morning digest.

**D6b — Billing-email-change auto-apply: DEFERRED, not dropped.**
The original D6 had "billing email change → auto-update CRM + Xero contact".
V1 ships it as FLAG only — confidently matching a free-text email to the
right customer/site and writing to two systems deserves its own build with
its own confirmation UX. Explicit sub-phase (Phase 3b), not a silent trim.

**D6c — Rollout: observe first.**
`TRIAGE_MODE` env var, default `observe`: classify + ledger only, zero
side-effects. Mitchell reviews the ledger's judgement, then flips to `live`
in Vercel. First run per mailbox only stamps the watermark — the backlog is
never swept, only new mail.

**D7 — Hard safety rails on auto-actions (non-negotiable).**
No outbound email to a CUSTOMER is ever sent automatically (2026-05-11 rule).
Forwarding a supplier bill to the Xero Bills address is internal and allowed.
Anything ambiguous downgrades to FLAG. Auto-actions are additive/corrective
(forward, file, update a contact field) — never deletes, never payments,
never Xero sends.

**D8 — Blockers Mitchell must unblock for Phase 3.**
1. Entra app registration + admin consent (walk through together in browser).
2. The org's Xero Bills email address (Xero → Business → Bills to pay).
3. Confirm admin@ and accounts@ are accessible (shared mailboxes vs licensed).

## Explicitly out of scope (V1)

- Third-party task apps (Todoist/Planner/To Do) — another inbox to neglect.
- Calendar integration, delegation/assignment, task comments.
- Auto-replying to anyone.
