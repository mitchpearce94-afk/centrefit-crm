# Site-First Restructure — CONTEXT (locked 2026-07-02)

Decisions locked with Mitchell 2026-07-02 (vault: 05-DECISIONS/2026-07-02-crm-site-first-restructure.md).
Every task in the implementation plan must reference the decision it implements.

## Decisions

**D1 — Customers tab is removed.** Sites is the only directory. Global search matches site names first; searching an owner's name finds their site(s). Customer pages die; anything accounts-flavoured lives on the site or in Xero.

**D2 — Site = the billing account, 1:1.** Each site carries its own editable owner/billing fields: owner first name, last name, mobile, billing email, entity name/ABN, plus anything else pertinent to the owner. No shared owner records across sites and no write-through machinery — multi-site owners (e.g. Total Fusion) genuinely bill per-club with different billing details, so duplication across sites is correct, not a smell. The `customers` table remains as an invisible 1:1 backing store per site (preserves all FKs: invoices, quotes, jobs, recurring_plans, Xero contact id, GC links).

**D3 — Xero contact per site, display name = site name exactly.** "Snap Fitness Ormeau", NOT "Jessie Condello - Snap Fitness Ormeau". Entity name/ABN stay on the Xero contact record for tax-invoice compliance; the display name is the site. Recurring invoices, one-off invoices, statements all read as the site. Service jobs and quoted jobs are labelled by site name the same way.

**D4 — Change-owner flow replaces the transfer button.** The site page Owner card has two paths:
- *Edit details* (typo/phone/email change): mutates the current owner record in place.
- *Change owner* (club sold): creates a NEW backing customer record, re-points site.customer_id, history (invoices/quotes/jobs) stays attached to the old record so the CRM matches the Xero paper trail. For DD sites this flow MUST auto-trigger a fresh GoCardless mandate authorisation for the new owner (the old mandate is signed against the old owner's bank account and cannot be inherited) and swap the subscription on activation. Remove the existing transfer button.

**D5 — Site-first creation flow.** New site form captures site + owner details in one pass; the backing customer record is created invisibly. Quote/job/plan creation starts from picking a site; owner/billing auto-fills from it (no duplicate data entry — see feedback rule).

**D6 — Prospects live on the pipeline** (pipeline_deals, nbn_enquiries) until they have a site; converting a deal creates the site.

## Open questions (resolve before or during build)
- One-off residential/electrical customers: proposed auto-create a site from their address so the model stays uniform. Mitchell hasn't confirmed.
- Customer ID surfacing (needed by the CCTV/asset imports — see memory: centrefit-crm-asset-bulk-import): hidden everywhere except exports and the site's owner card.

## Migration (data first, UI second — read-only until Mitchell reviews)
1. Split the 28 multi-site customer records into per-site backing records; re-point invoices/quotes/jobs/recurring_plans rows via their existing site_id (populated: jobs 104/115, quotes 35/40, invoices 42/53, plans 63/64). Hand-sort the ~30 null-site rows with Mitchell.
2. Audit how Xero contacts map today for multi-site owners (one contact vs per-club) before splitting.
3. Rename Xero contacts to site names — Mitchell reviews the full rename list before it runs (customer-facing: future invoices print the new name).
4. plan_files: add site_id.

## UI phases (each ships independently)
- **A:** Site name leads on all high-traffic surfaces — jobs list/cards, scheduler, quotes list, invoices list, plans list. Owner name becomes fine print.
- **B:** Site detail page = the hub (Owner card, jobs/quotes/invoices/plans/assets tabs); site-first creation flows (D5); change-owner flow (D4).
- **C:** Nav flip — Customers tab removed (D1), Sites primary, site-first global search; backfills + prospect conversion flow (D6).
