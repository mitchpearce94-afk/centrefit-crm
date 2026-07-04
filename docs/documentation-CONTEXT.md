# Site Documentation — CONTEXT (locked 2026-07-05)

Decisions locked with Mitchell 2026-07-05 (late session, after digesting the three real
documents: SWMS "Snap Fitness Brisbane CBD" Rev 2.0, "Client Information and Security
Monitoring Response Instructions — COMMERCIAL CLIENTS" v17022026, "Handover Manuals"
Core Plus Benowa 01/07/2026). Supersedes nothing — new capability. The global password
vault (/vault) is UNTOUCHED; this replaces only the site page's Vault tab.

## Non-negotiables

- **Documents must be STUNNING.** Mitchell: "beautiful as all hell." One premium,
  branded design system across all three generated documents: proper cover pages,
  Centrefit logo + brand colours, clean modern typography, well-set tables, consistent
  headers/footers with version + page numbers. The current documents' bones are fine;
  the output must look dramatically better, not like a form filled by a robot.
- Site-first: everything hangs off the SITE (customer_sites), consistent with the D2/D3
  model. Documents can optionally link to a job.
- No duplicate data entry: everything the CRM already knows is pre-filled, always.

## The Documentation tab (Phase A)

Replaces the Vault tab on /sites/[id]. Headings (fixed list v1):
**Plans · Security Paperwork · SWMS · Handover Documentation · Compliance & Certificates · Other**

- Files stored in Supabase storage (new `site-documents` bucket), replacing the OneDrive
  habit. Drag/drop or tap upload, any file type, works on mobile.
- Each document row: heading, name, uploaded_by/at, optional job_id, status
  (`file` | `draft` | `sent` | `signed`), version.
- The **Plans** heading auto-surfaces the site's existing plan_files (CFP/PDF) alongside
  uploads — one place, both sources.
- Deletion admin-gated; everything else any active staff.

## Signing model (Phase B mechanics, used by all generated docs)

DocuSign-style, built on the quote response_token pattern:
- Tokenised public signing link per document + recipient; email send via accounts@.
- Sign-on-glass on a phone/tablet for on-site signatures.
- ONE e-signature replaces per-page initialling (Mitchell approved); the audit trail
  records every section viewed, signer name, timestamp, IP, and the document version.
- Audit block stamped into the final PDF; signed PDF stored under the heading, status
  → `signed`.

## Generated document 1 — Security Monitoring Response Instructions (Phase B)

Today: 9-page PDF the client prints, initials every page, fills PINs/call lists by hand.
Becomes: staff hit "Generate & send" on the site → customer receives a tokenised link to
a **fillable web form**, pre-filled with everything the CRM knows (client/entity name —
respecting invoice_name, ABN, facility name/address/phone, billing address, email).

- Customer types: alarm response call list (8 rows), iFob users (12 rows: full name +
  4-digit PIN + app access Y/N), opening-hours schedule, and picks the response options
  (L1–2, H1–3, P1–3, B1–3, A/B, C1–3, AC1–3, BF1–3, SIM supply) as radio groups with
  the fee consequences shown inline and a live monthly-total summary.
- **Fees pull from the recurring_services catalogue at generation time** — never
  hardcoded. Monitoring is $65.00 ex GST/mo ($71.50 inc) as of 2026-07-05 (scope-of-works
  engine updated same night). App $133.50/yr ex, VAV $35/mo ex, NBN $139/mo, SIM $22.50/mo ex.
- One signature at the end (name, position, signature, date) + audit trail.
- **Selections persist as structured data on the site** (monitoring response profile):
  the CRM knows "burglar = B2 (patrol)" etc.; call list and iFob users stored as rows
  (PINs stored masked — Mitchell approved storage). Re-issue = pre-filled form showing
  current values; the diff is recorded (the paper form's "only complete what changes").
- CF-use-only zone/area schedule pre-fills from the site's alarm assets where possible.

## Generated document 2 — SWMS (Phase C)

ONE master install template ("Installation & Commissioning of Security, Access Control
and CCTV Infrastructure") mirroring the Rev 2.0 content: 6 task groups (site setup /
rough-in / drilling & penetrations / fit-off / commissioning / pack-up) with hazards,
controls, LL/CL/residual risk; risk matrix; QLD legislation + codes list; competencies;
emergency arrangements; approval; sign-on; subbie table; equipment checklist.

- Auto-filled: client/PCBU (site owner — entity per invoice_name where set, ABN,
  address, key reps from site contacts), work site, dates (job rough-in → fit-off),
  permit number = job number, author/approver.
- Task groups toggleable off per generation (e.g. no EWP).
- **Staff signatures: select the staff on the job and their signatures auto-apply.**
  Each staff member draws their signature ONCE (stored on their staff profile); the
  sign-on register is populated from job_staff with stored signatures + generation date.
  No repeated signing (Mitchell's explicit call). Optional later hardening: one-tap
  acknowledge from each tech's phone before the signature applies — noted, not built.
- Sub-contractor rows: manual entry (name, company, licences) or on-glass signature.
- Nearest hospital auto-filled from the site address (lookup at generation).

## Generated document 3 — Handover Documentation (Phase D)

Auto-assembled per site:
- Cover (customer, facility, date) + branded design.
- **Datasheet pack keyed to the product/datasheet library, driven by the site's
  KEY INFORMATION assets only** — if a key product isn't in the site's key info, it
  does NOT appear in the handover (Mitchell's rule). Key product set = the current
  handover's list: HDMI/RF modulator (Electrocraft EPS-HDMI1001/M4), Bosch DS936 PIR,
  Bosch Solution 6000, Dahua camera (DH-IPC-HDW3667EM-S-IL-ANZ), Dahua NVR
  (DHI-NVR5432-16P-AI/ANZ), Ubiquiti U7 Pro WAP, USW-48-PoE / USW-Pro-Max-48-PoE switch,
  UCG-Fiber router, GSM/4G duress intercom (model TBC by Mitchell), Power Dynamics
  PRM240 amp + 100V ceiling/wall speakers, Kingray 8-way active tap.
- **Datasheet storage**: `datasheets` bucket + table keyed to product/model; datasheets
  sourced online once (agent hunt 2026-07-05) and stored; admin can upload/replace.
- Procedure blocks from a versioned library: Monthly Duress Testing Procedure (V2.1
  content) included only when the site has duress assets; CCTV playback guide; etc.
- Wi-Fi details from the site's Key Info Wi-Fi data (SSIDs + passwords — this document
  is FOR the owner, so credentials are included by design).
- Compliance statement — **canonical licence constants (Mitchell confirmed 2026-07-05:
  the security paperwork's set wins)**: Security Licence **4626412**, ASIAL Membership
  **64937**. The handover template's 64951/C12897 is stale — never use it. Store as
  app constants.
- Client acceptance signature (sign-on-glass or link) → signed handover stored.

## Phases

- **A** — Documentation tab: bucket, table, headings, uploads, plan_files surfacing,
  Vault tab removal. (No generators yet.)
- **B** — Signing infrastructure + Security Monitoring web form end-to-end.
- **C** — SWMS generator + staff signature profiles.
- **D** — Handover generator + datasheet library (+ datasheet ingest from agent hunt).

## Open items

- Duress intercom make/model — Mitchell to confirm (agents shortlisting candidates).
- PDF rendering approach decided at build time (server-side HTML→PDF; must satisfy the
  "stunning" bar — likely @react-pdf or headless Chromium via a render route).
