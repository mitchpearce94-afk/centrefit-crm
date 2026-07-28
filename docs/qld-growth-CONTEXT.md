# QLD Growth (Non-Gym) — CONTEXT

> Locked 2026-07-28 with Mitchell. Strategy + automation build for growing
> Centrefit's QLD work outside the gym industry, targeting builders. Every
> task in the build plan references a decision below. Scope changes go
> through Mitchell — no silent trimming (GSD).

## Goal

Build a repeatable pipeline of commercial ELV work (data, CCTV, access
control, alarms, AV, NBN) from QLD builders, on top of the existing service
lines and team (Jake Larsen starting as trainee tech = delivery capacity).
Not replacing gym work — adding a second leg.

## Decisions

**D1 — No hire/rental equipment in phase 1.** Site-security hire (solar CCTV
towers etc.) is explicitly deferred ~12 months (revisit ≈ 2027-07). Focus is
selling what Centrefit already delivers. No "hire" product type in the CRM
yet.

**D2 — Phase 1 verticals: childcare centres + commercial fitout builders/
shopfitters.** Compliance-driven CCTV/access/duress needs, repeat-work
buyers, and every childcare fitout feeds the monitoring + NBN recurring
engine. Medical/dental/vet taken opportunistically, not targeted. Gym work
continues as-is.

**D3 — Positioning: one subbie for the whole ELV package.** Pitch = full
low-voltage scope under one sub who prices fast and hands over
professionally (e-sign handover packs, SWMS, monitoring forms are the
differentiators). Never compete as a single-trade cable puller.

**D4 — Channels, in priority order:**
  1. Electrician partnerships. **Primary partner: Dane @ DWP Electrical**
     (already sending regular work as of 2026-07). Arrangement (locked
     2026-07-28): reciprocal head/sub — whoever brings the job is head
     contractor and the other falls under them; each side margins the
     other's price at their own discretion (Mitchell: small margin on DWP's
     price depending on the job); **recurring/ongoing services always pass
     to Centrefit** (Dane has no interest in ongoings). This shape is the
     template for future sparky partners.
  2. DA-intel outreach — contact builders/architects at development-approval
     stage, before tender (see D5).
  3. EstimateOne — listed as a security/data subcontractor, respond to
     package invitations.

**D5 — DA scanner is the first automation build.** Nightly scan of SEQ
council development-application data filtered to phase-1 verticals
(childcare, medical, gym, commercial fitout), enriched with builder detail,
surfaced as leads in the CRM + a weekly Monday digest. Data-source design
per the feed research (research doc / findings appended when complete).

**D6 — Outreach is human-sent.** Automation researches and drafts
(referencing the specific DA/project); Mitchell (or delegate) reviews and
sends. No automated cold-email sequences — Spam Act risk and brand risk both
say no.

**D7 — Jake = delivery, not BD.** Jake + Michael absorb install load; the
automation does prospecting grunt work; Mitchell does relationship calls.

## Build plan (phase 1)

1. **DA lead scanner** (D5): scanner (cron) → `bd_leads` table → CRM leads
   page → notification + Monday digest. Ship the data collection first —
   longest lead time to value.
2. **Capability statement**: one polished PDF (reuse handover-pack/document
   pipeline), commercial page on the Centrefit website with cap-statement
   download as lead capture.
3. **Commercial quick-quote mode** (extends existing manual quote mode):
   per-point rate templates (data point / camera / door / AV drop) so
   tenders turn around same-day.
4. **Outreach drafting assist** (D6): per-lead drafted email referencing the
   DA, human review + send.

## Success metrics (PROPOSED — Mitchell to confirm numbers)

- 90 days: 3+ active fitout-builder/electrician relationships, first
  childcare or fitout package quoted.
- 180 days: first non-gym recurring plan (monitoring/NBN) live from this
  channel.

## D5 data sources (locked 2026-07-28, live-verified)

- Brisbane / Ipswich / Redland: Development.i `POST /Geo/GetApplicationFilterResults`
- Gold Coast: Development.i (newer build) `POST /Home/ApplicationFilterCSVPaged`
  — rows under `applications`, epoch-ms string dates, broken server-side date
  filter (sort desc + client-side cut)
- Logan: DevET `council-api-proxy.lcc.wspdigital.com/pdonline/applications`
  — `{pagination, data}` wrapper; richest feed (applicant + class)
- Moreton Bay: `api.moretonbay.qld.gov.au/mplu/da/search/advanced` — ignores
  date params, sorted newest-first, cut client-side
- **Sunshine Coast NOT polled** — robots.txt disallows all; PlanningAlerts API
  is the compliant substitute if wanted later
- Enrichment (phase 1.5, not built): QBCC contractor register via
  data.qld.gov.au CKAN datastore (resource 25608781-…) — applicant → licence/ABN
- First live run 2026-07-28: 19 leads incl. 2 childcare (Logan), 3 shopping
  centre fitout BWs, 2 indoor-rec MCUs (Redland)

## Open items

- [ ] Confirm success metric numbers with Mitchell
- [ ] EstimateOne registration (manual, Mitchell)
- [ ] DWP branding question — whose name on customer-facing handover/
      monitoring docs when Centrefit subs under DWP
- [ ] Further electrician partners beyond DWP (Mitchell to nominate)
