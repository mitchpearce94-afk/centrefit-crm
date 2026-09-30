# Cortex CRM API — `/api/cortex/*`

For Mark's Cortex (Mitchell, 30 Sep 2026: "just give Mark access to whatever").
Read jobs, quotes, customers, sites and staff; create, schedule and update jobs.
Not available here, by standing rule: invoicing, pricing/cost data, deletes, the
Finance section, Xero, GoCardless. Nothing here emails anyone.

## Auth
`Authorization: Bearer <token>` — the same token Mark's Cortex already holds as
`CRM_STATS_TOKEN` (server side it is `CORTEX_API_TOKEN`, falling back to
`STATS_READONLY_TOKEN`). Unset → 503, wrong → 401, > 120 calls/min → 429.
Listed in `PUBLIC_PATH_PREFIXES` (`/api/cortex/`), so the token check in each
route is the only gate. Base URL `https://crm.centrefit.com.au`.

## Endpoints

| Method | Path | What |
|---|---|---|
| GET | `/api/cortex/jobs?q=&status=&staff=&from=&to=&limit=` | Search jobs. `q` matches a job number (`CFA05256`, `5256`), reference, description, customer or site/suburb. `status` = a status name (`Scheduled`, `Pending Schedule`, `Ready to Invoice` …). `from`/`to` (YYYY-MM-DD) keep jobs with a diary entry in that window. `staff` filters by assigned name. Newest first, max 50. |
| GET | `/api/cortex/jobs/CFA05256` | One job with its diary, staff, last 20 updates and notes, and linked quotes (sell total only). |
| POST | `/api/cortex/jobs` | Create a job. Body below. |
| POST | `/api/cortex/jobs/CFA05256/schedule` | Add a diary entry to an existing job. |
| POST | `/api/cortex/jobs/CFA05256/updates` | Add a job update (the running log on the job page) in Mark's name. |
| GET | `/api/cortex/search?q=` | Customers, sites and staff matching a name — resolve "PF Caboolture" before creating. |
| GET | `/api/cortex/quotes?q=&status=&limit=` | Quotes with sell totals (ex GST), status, sent/accepted/expiry dates, linked job. |
| GET | `/api/stats/daily` | The daily numbers (docs/stats-endpoint.md). |

### POST `/api/cortex/jobs`
```json
{
  "customer": "Planet Fitness",          // optional if the site is unambiguous
  "site": "Caboolture",                  // name, "Customer Site", suburb, or id — required
  "reference": "Front door card reader", // short title (defaults to the first 80 chars of description)
  "description": "Look at the front door card reader — intermittent reads",
  "category": "Access Control Service",  // optional job type (categories.type = job_type)
  "staff": ["Mark"],                     // names/emails; defaults to Mark
  "schedule": { "date": "2026-10-01", "start": "8", "end": "9", "notes": "site visit" },  // optional
  "due_date": "2026-10-03"               // optional
}
```
Creates the job (CFA number auto-generated), assigns the staff, writes one diary
entry per staff member, and sets the status to `Scheduled` (with a schedule),
`Assigned` (staff only) or `Unassigned`. Business unit defaults to `Services`.
Returns `201 { created: true, job }`. Ambiguous customer/site → `409` with
`candidates`; unknown → `404`. Times accept `8`, `8am`, `08:00`, `2pm`.

### POST `/api/cortex/jobs/CFA05256/schedule`
```json
{ "date": "2026-10-01", "end_date": null, "start": "08:00", "end": "09:00", "staff": ["Mark"], "notes": "front door reader" }
```
Adds the entry (never edits or removes existing ones), puts the staff on the job
if they aren't, and moves `Unassigned` / `Assigned` / `Pending Schedule` to
`Scheduled`.

### POST `/api/cortex/jobs/CFA05256/updates`
```json
{ "content": "Spoke to the club manager, reader replaced under warranty." }
```

## Rails
- Supabase service role, every select names its columns; quote money is the one
  JSON path `pricing_snapshot->>totalExGST`. No procurement, supplier, cost,
  finance-agent or vault tables are touched.
- Writes are inserts (jobs, job_staff, schedule_entries, job_updates) plus the
  one status bump to `Scheduled`. No updates to existing entries, no deletes.
- Code: `src/app/api/cortex/**`, `src/lib/cortex-api/*`.
