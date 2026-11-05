# Builder billing, mandate chasing, job progress — CONTEXT (locked 2026-11-05)

Mitchell, 5 Nov 2026: Sue sets up draft recurring plans with the builder entered
as the owner, so the recurring invoices would go to the builder. Keep the owner
on the recurring side, give the builder its own home, and tick a box when an
invoice is the builder's. Separately: a notification for mandates awaiting
signature, and a full go-to-whoa checklist per job so nothing is missed.

## Decisions

**D1 — The builder lives on the site, beside the owner, never as the owner.**
`customer_sites.builder_*` (name, ABN, contact, email, phone, address, Xero
contact, notes). The owner (backing `customers` row + primary contact) stays the
billing account that recurring plans, mandates and Xero repeating invoices key
off. Nothing in the recurring path reads the builder. Site page gets a
**Builder** tab shaped like the Owner card.

**D2 — Bill-to party is chosen per invoice, defaulting from the quote.**
`invoices.bill_to_party` ∈ `owner | builder` (default owner). The quote carries
`quotes.bill_to_party` too, set on the quote page in the Invoices block, so the
automatic PP1 on acceptance and the automatic PP2 on Ready to Invoice follow it
without a human. Manual creation (quote page buttons, job ad-hoc modal) shows a
"Bill the builder" tick box, pre-ticked from the quote, only enabled when the
site has a builder.

**D3 — Builder invoices go to the builder's own Xero contact.** Found or created
by builder name (ABN, email, phone, address from the site's builder fields),
cached on `customer_sites.builder_xero_contact_id`. The site's owner Xero
mapping is never touched by a builder invoice. The Xero reference is
"<site> - <quote ref>" so the builder can see which club it is (existing D4 of
billing-contact-CONTEXT).

**D4 — Mandates awaiting signature get their own notification.**
Type `recurring_plan.awaiting_signature` (Billing, high, bell + email by
default). The daily pending-mandate watchdog fires it instead of the generic
`billing.gap`: one summary per day listing every plan sent but unsigned (days
waiting, auto-reminders used, start date blown) and every draft never sent
(so Sue's drafts don't hide). Home Accountability board gets a "Mandates
awaiting signature" card linking to the pending tab.

**D5 — Job progress is one fixed lifecycle, derived from the data first.**
`src/lib/jobs/progress.ts` defines the steps. Each step is **auto** (state
computed from CRM rows: documents, plans, quotes, invoices, recurring plans,
sign requests, procurement, dates, checklist, work entries, status) or
**manual** (a tick with initials + date). Any step can be marked N/A or ticked
by hand; an auto step that the data later satisfies shows as done regardless.
Manual ticks live in `job_progress_items` (one row per job + step key).

**D6 — Two step sets.** Fitout jobs (is_new_build, or a linked quote/plan) get
the full list: builder plans on file → CFP plan drawn → plan to electrician →
electrician quote in → quote sent → accepted → deposit invoice sent (owner or
builder) → deposit paid → direct debits set up (draft / awaiting signature /
active) → procurement → dates booked → security paperwork signed → SWMS →
NBN (only NBN jobs) → rough-in done → fit-off done → install checklist →
write-up → handover docs → final invoice sent → paid → complete. Service jobs
get the short list: booked → write-up → invoice sent → paid → complete, plus
the install checklist when one is applied.

**D7 — Where it shows.** A **Progress** tab on the job (second tab) with
grouped steps, each with its state, who/when, a one-line detail and an "Open"
link to the place the step is done. The Job tab gets a one-line progress strip
(done/total + next step) that jumps to the tab.

**D8 — No new status machinery.** Progress reads the data; it never changes job
status, invoices or plans. The existing template checklist (install tasks)
stays as-is and becomes one step of the lifecycle.

## Not in scope
- A builder directory shared across sites (D2 of site-first: per-site
  duplication is correct).
- Builder as a party on recurring plans or mandates.
- A jobs-list progress column (ask again if wanted).

## As built
See migration `20261105090000_builder_billing_mandate_notify_job_progress.sql`,
`src/lib/jobs/progress.ts`, `src/app/(dashboard)/jobs/[id]/job-progress.tsx`,
`src/app/(dashboard)/sites/[id]/builder-card.tsx`,
`src/app/api/sites/[id]/builder/route.ts`, `src/app/api/invoices/create`,
`src/app/api/cron/pending-mandate-watchdog`.
