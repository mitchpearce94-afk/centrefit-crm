# Daily stats endpoint — `GET /api/stats/daily`

Read-only snapshot for Mark's Cortex morning briefing (approved by Mitchell,
27 Sep 2026). One pull a day.

## Auth
- `Authorization: Bearer <token>`, compared timing-safe against the
  `STATS_READONLY_TOKEN` env var (Vercel production). No session path.
- Env unset → `503`. Missing/wrong token → `401`. More than 10 calls a minute
  on one instance → `429`.
- Listed in `PUBLIC_PATH_PREFIXES` (`/api/stats/`) so middleware doesn't bounce
  it to `/login`; the token check in the route is the only gate.

## Rails
- SELECT only (Supabase service role) plus GoCardless `GET /payments`. No
  writes, no Xero, no emails.
- Sell values only. Every select names its columns; quote value is pulled as
  the single JSON path `pricing_snapshot->>totalExGST`, so the cost, margin and
  profit keys in the snapshot never leave the database. No procurement,
  supplier, finance-agent or vault tables are read.
- Code: `src/app/api/stats/daily/route.ts`, `src/lib/stats/daily.ts`.

## Dates and money
- Brisbane calendar throughout. `generated_at` is Brisbane wall-clock
  (`+10:00`). "This week" = Monday 00:00 Brisbane to now. "This month" = the
  1st to the last day of the current Brisbane month.
- AUD. Job and quote values are **ex GST**. MRR is **inc GST** (same as the
  Effective MRR tile on /invoices/recurring). GoCardless amounts are the
  amounts debited.

## Response shape
```jsonc
{
  "generated_at": "2026-09-28T06:00:02+10:00",
  "date": "2026-09-28",
  "timezone": "Australia/Brisbane",
  "periods": { "week_start": "2026-09-28", "month_start": "2026-09-01", "month_end": "2026-09-30" },
  "currency": "AUD",

  "awaiting_invoicing": {
    "count": 39,
    "value_ex_gst": 0,               // sum of known values only
    "count_without_value": 39,       // jobs with no accepted quote and no estimated_value
    "ready_to_invoice_count": 0,     // status "Ready to Invoice"
    "complete_no_invoice_count": 39, // status "Complete" with no non-void invoice linked (by job or its quotes)
    "oldest": { "number": "CFA05058", "customer": "…", "days_waiting": 117, "reason": "complete_no_invoice" },
    "by_customer": [
      { "customer": "…", "count": 4, "value_ex_gst": 0, "jobs": [
        { "number": "CFA05095", "reference": "WiFi", "customer": "…", "site": "…", "category": "IT Support",
          "reason": "ready_to_invoice | complete_no_invoice",
          "last_updated": "2026-07-03", "days_waiting": 86,
          "value_ex_gst": null,
          "value_source": "accepted_quote_less_invoiced | job_estimated_value | null",
          "site_has_active_recurring_plan": true }
      ] }
    ]
  },

  "jobs": {
    "open_count": 89,                              // every job not in a completion-phase status
    "open_by_status": { "Scheduled": 21, "…": 0 },
    "in_progress": { "count": 21, "by_status": { "In Progress": 14, "…": 0 } }, // statuses with phase in_progress
    "overdue": { "count": 0, "jobs": [ { "number": "…", "customer": "…", "site": "…", "status": "…", "due_date": "…", "days_overdue": 3 } ] },
    "waiting_to_schedule": { "count": 4, "jobs": [ { "number": "…", "customer": "…", "site": "…", "status": "Pending Schedule", "days_waiting": 5 } ] }
  },

  "quotes": {
    "active": { "count": 14, "value_ex_gst": 691602.06, "draft": 0, "sent": 14 },   // draft/sent, not expired
    "accepted_this_week": { "count": 0, "value_ex_gst": 0, "quotes": [ { "ref": "…", "customer": "…", "site": "…", "value_ex_gst": 0, "accepted_on": "…" } ] },
    "follow_ups_due": { "count": 8, "value_ex_gst": 555499.43, "quotes": [ { "ref": "…", "customer": "…", "site": "…", "value_ex_gst": 0, "days_since_sent": 12, "auto_followup_sent": true } ] },
    "expired_unresolved": { "count": 26, "value_ex_gst": 1006758.4 },             // past expires_at, still draft/sent
    "expired_this_week": { "count": 0, "value_ex_gst": 0, "quotes": [ { "ref": "…", "customer": "…", "site": "…", "value_ex_gst": 0, "expired_on": "…" } ] }
  },

  "recurring": {
    "mrr_inc_gst": 14597.56,                        // active plans; yearly ÷12, quarterly ÷3
    "active_plans": 77,
    "pending_mandate": { "count": 5, "mrr_inc_gst": 1020.45 },
    "plans_by_status": { "active": 77, "pending_mandate": 5, "draft": 2, "cancelled": 5 },
    "gocardless": {                                 // payments by charge_date in this month; { "error": "…" } if GC is down
      "collected": { "count": 112, "amount": 12525.85 },  // confirmed + paid_out
      "pending":   { "count": 3, "amount": 725.12 },      // pending_customer_approval / pending_submission / submitted
      "failed_or_cancelled": { "count": 0, "amount": 0, "payments": [
        { "customer": "…", "site": "…", "status": "failed | charged_back | cancelled | customer_approval_denied", "charge_date": "…", "amount": 0 }
      ] }
    }
  },

  "pipeline": {
    "total_value_ex_gst": 691602.06,               // open quotes + pipeline deals still at "lead"
    "open_quotes": { "count": 14, "value_ex_gst": 691602.06 },
    "deals": { "count": 1, "value": 0, "weighted_value": 0, "lead_stage_value": 0 } // pipeline_deals at lead / quote_sent
  }
}
```

## Definitions
- **Awaiting invoicing** — status `Ready to Invoice`, plus status `Complete`
  with no non-void invoice linked to the job or to any quote on the job.
  `days_waiting` counts from the job's `updated_at` (there's no status-change
  timestamp). Value = accepted quote total(s) less everything already
  invoiced ex GST, else `jobs.estimated_value`, else `null`.
  `site_has_active_recurring_plan` flags completed IT/NBN work that may be
  billed through a recurring plan rather than its own invoice.
- **Overdue** — open job with `due_date` before today (same rule as the home
  dashboard).
- **Follow-ups due** — quote `sent` 7+ days ago and not expired (the same
  7-day threshold as the quote-followups cron).
- **Pipeline** — deals at `quote_sent` are left out of the total on the
  assumption their quote is already counted under open quotes.

## Rotating the token
```
TOKEN=$(openssl rand -hex 32)
vercel env rm STATS_READONLY_TOKEN production
printf '%s' "$TOKEN" | vercel env add STATS_READONLY_TOKEN production
```
Redeploy (push + `vercel promote`), then update `CRM_STATS_TOKEN` in
`~/.cortex/env` on the Mac mini.
