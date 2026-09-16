# Billing contact on invoices — CONTEXT

**Trigger (2026-09-16):** Workspace 360 (Snap Fitness Austral / Beveridge /
Warralily) bounced two invoices because they were billed to the site names.
The fix was done by hand in Xero (re-point Contact + Reference on the
AUTHORISED invoices) and by SQL in the CRM (site + customer
`xero_contact_id`). Mitchell: "we need a preview invoice in crm and the
ability to link it to another xero contact."

## Decisions (locked 2026-09-16, Mitchell + Cortex)

- **D1 — The Xero contact is the billing identity, and it's visible.** Every
  invoice page shows *Billed to: <Xero contact name>, <address>* and the
  Authorise & Send confirmation repeats it next to the recipient email.
  Nobody authorises an invoice without seeing who it's billed to.
- **D2 — Preview is the real paper.** "Preview PDF" streams the Xero-rendered
  PDF for the invoice as it stands (drafts included). No CRM-side mock PDF.
- **D3 — Re-linking is a CRM action, not a Xero chore.** A Xero-contact picker
  (search by name; create from the billing name) lives on:
  - the **site Owner tab** → sets `customer_sites.xero_contact_id` (+ mirrors
    to the owning customer when it had none). This is what every future
    invoice for the site uses.
  - the **invoice page** → re-points the Xero invoice's Contact for DRAFT and
    AUTHORISED-unpaid invoices (proven safe 2026-09-16), keeps the number,
    refreshes the bill-to snapshot. Paid / voided invoices: read-only.
- **D4 — The site never disappears from the invoice.** When the bill-to
  contact name differs from the site name, the Xero Reference is
  `<Site name> - <existing reference>` (quote number / payment stage). Set at
  creation and on re-point.
- **D5 — Snapshot on the invoice row.** `invoices.xero_contact_id` +
  `invoices.bill_to_name` are written at creation, on re-point, and by
  Refresh (from Xero). The page reads the snapshot; no Xero call per view.
- **D6 — `invoice_name` keeps its meaning.** It's the name used when the CRM
  has to *create* a contact. A linked contact always wins over the name;
  the Owner tab makes that explicit ("Linked Xero contact: … / none — will
  create '<invoice_name>'").

## Not in scope
- Merging duplicate Xero contacts (API can't; Xero UI only).
- Changing the contact on PAID invoices.
- Statements / contact-level reporting.

## As built (2026-09-16)
- **Schema:** `invoices.xero_contact_id`, `invoices.bill_to_name` (+ partial
  index), migration `invoices_bill_to_snapshot` applied via Supabase MCP.
- **Lib:** `src/lib/xero/invoices.ts` — `billToReference()` (D4 rule,
  normalised compare, never stacks), `createXeroInvoice({ siteName })` now
  looks up the contact name, writes the D4 reference and returns
  `contactName` + `reference`; `updateXeroInvoiceContact()` (DRAFT /
  SUBMITTED / AUTHORISED-unpaid only, strips a previous site prefix before
  re-deriving); `fetchXeroInvoice()` returns `contactName` + `reference`.
  `src/lib/xero/contacts.ts` — `searchXeroContacts()` (Name.Contains with
  case variants, ACTIVE only) and `getXeroContact()` (follows merges).
- **API:** `GET /api/xero/contacts?q=|id=` (picker); `POST
  /api/invoices/[id]/contact { xeroContactId, linkSite }` (re-point +
  snapshot + optional site/customer re-link + `invoice.contact_changed`
  activity); `GET /api/invoices/[id]/pdf` (Xero-rendered PDF, drafts
  included); `PATCH /api/sites/[id]/owner` accepts `xeroContactId` (null
  unlinks; mirrors to the customer when it had none); Refresh writes the
  snapshot from Xero.
- **UI:** invoice page "Billed to <name> · Preview PDF · Change"
  (`bill-to.tsx`); Authorise & Send modal shows the bill-to + Preview PDF
  before the recipient field; Owner card "Invoices bill to: <linked Xero
  contact> (Change · Unlink / Link existing)" with the linked-contact-wins
  warning; shared `src/components/xero-contact-picker.tsx`; timeline label
  "Billed-to contact changed".
- **Creation paths** (quote PP1/full, auto PP2, ad-hoc) pass `siteName` and
  store the snapshot. Recurring/repeating paths rely on Refresh for the
  snapshot (not changed).
- **Proof:** `scripts/smoke-billing-contact.mts` — pure D4 cases + a live
  throwaway draft created, re-pointed twice, restored, deleted. Passed.
