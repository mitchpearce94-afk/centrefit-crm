# Finance agent — CONTEXT

Locked 2026-09-23 (Mitchell, in chat, evening). Companion: vault `18-INBOX/2026-09-23-finance-agent-instead-of-hire.md` (the why), memory `centrefit-finance-agent-2026-09-23`. Every task below references a D-number.

## Brief (Mitchell)

> Build the finance in the CRM for me now. The finance tab only viewable by my login right now; I'll choose if anyone else sees it later. GoCardless payouts: look at the payout, reconcile against who paid in the batch, put the GoCardless fee to 446 merchant fees. Stripe payouts come up green already — check they're right, I don't. Draft bills: I allocate and approve them daily. We need the invoiced customer in Xero matching exactly the customer in GoCardless; I know who every customer is.

## Decisions

**D1 — Mitchell-only, then an allowlist.** The Finance section is visible to `mitchell@centrefit.com.au` and to staff ids in `finance_settings.viewer_staff_ids` (empty today). Enforced three times: sidebar/mobile nav (hide), route layout (404 — don't leak it exists, same as My List), and RLS + an explicit check on every API route. Admin role is NOT enough — Mark is admin.

**D2 — Prepare, never release.** The agent creates invoice payments and a fee spend-money in Xero. It never touches bank/payment release, never edits reconciled transactions, never deletes. The final "OK" on a bank statement line stays a human click in Xero (the API can't reconcile statement lines, and the BankStatement report scope doesn't exist for this app generation).

**D3 — No clearing account.** GoCardless payouts land NET in 602 CENTREFIT GROUP. Per payout the agent posts: one payment per matched invoice at gross, dated the payout arrival date, into 602, reference `GC payout <id>`; one SPEND bank transaction from 602 to `fee_account_code` (446) for the deducted fees, tax type `fee_tax_type` (INPUT — GoCardless AU fees carry GST; Mitchell to confirm on a GC tax invoice). Gross − fee = net = the feed line, so Find & Match is one action.

**D4 — Modes per job: off / dry_run / live, plus Pause.** `finance_settings` holds one row. Every job starts in `dry_run`: it ingests, matches and writes a *plan* (exactly what it would post) and nothing reaches Xero. Live is a flip in Settings → Finance. `paused` stops every job.

**D5 — Match by ID, names for humans.** A GoCardless payment resolves customer → Xero contact through `finance_gc_customers` (Mitchell's decisions), then `recurring_plan_gc_subscriptions` / `recurring_plans.gc_customer_id` → site → `customer_sites.xero_contact_id`, then an exact non-junk name match in the local Xero mirror as a last resort. Canonical display name = the site/trading name as Mitchell says it ("Snap Fitness Mt Druitt"), the same in Xero and GoCardless; the CRM stores the Xero contact id. Renaming in Xero/GoCardless is an explicit "apply names" action, never automatic.

**D6 — The Xero contact that carries the invoices wins.** Exact name matching alone is unsafe ("Snap Fitness Meadowbank" exists and holds nothing; the invoices are under "Gladesville Fitness Pty Ltd - SF Meadowbank"). Candidate contacts are scored by invoices carried since 20 Jun 2026; ties/none → review queue.

**D7 — Never guess.** A payment that can't be matched to exactly one unpaid invoice (no contact, no invoice, several candidates, amount combos that don't reconcile) goes to `finance_review_items` with the evidence. Resolving an item teaches the mapping (writes `finance_gc_customers` / `customer_sites.xero_contact_id` / a manual invoice link) and re-matches.

**D8 — Amount combos are matched both ways.** One payment = one invoice (Total == amount). One payment = several unpaid invoices on the same contact whose totals sum to it (Arana Hills 85.25 = 60.50 + 24.75). Several same-day payments on the same contact = one invoice (Wantirna 85.25 + 12.10 = 97.35). Window = `match_window_days` (21) around the charge date. Already-PAID invoices are reported as "already paid", never paid twice.

**D9 — Local Xero mirror, bulk-synced.** Xero's daily limit (5,000 calls/tenant/day) is shared with prod and was exhausted on 23 Sep by per-contact lookups. `finance_xero_contacts` + `finance_xero_invoices` are refreshed by paged bulk pulls (Contacts incl. archived; ACCREC invoices modified since the last sync) — ~25 calls a day — and every match runs against the mirror. Writes to Xero are the only per-payout calls. `xero-rest.ts` records `x-daylimit-remaining` on every call and refuses bulk work below a floor (1,500).

**D10 — Reconciled = Xero says so.** After posting, the agent polls its own payments' `IsReconciled`; the payout row goes `posted → reconciled` when every payment is reconciled. Before posting, a historical payout whose matched invoices are all PAID is recorded as `reconciled` (Mitchell already did it by hand).

**D11 — Everything is auditable.** `finance_agent_actions` gets a row for every decision and every Xero write (before/after, rule). The Audit tab is the accountant's trail. A daily note (`finance_daily_notes`) summarises: posted, waiting on OK, exceptions, quota left.

**D12 — Phases.** Phase 1 (this build): foundation, gating, Xero mirror, GoCardless payouts end-to-end (dry run → live), review queue, contact worksheet with decisions, audit, settings, cron. Phase 2: Stripe payout verification (needs a read-only Stripe key — none in the CRM env today). Phase 3: draft bills — code from the CRM PO match, approve, leave payment to Mark's ABA.

## Schedule

`/api/cron/finance-agent` daily 20:30 UTC (06:30 AEST): mirror sync → ingest payouts since 2026-07-01 → match → plan → (live) post → refresh reconciled → daily note. "Run now" in Settings runs the same cycle on demand.

## Not in scope

Bank rec of anything but GC/Stripe payouts; payroll; BAS; bills payment; any customer-facing email. Nothing here emails or charges anyone.
