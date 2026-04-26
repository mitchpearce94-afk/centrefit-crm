# Centrefit CRM — User Acceptance Testing Checklist

**Purpose:** walk through every flow the team will actually use. Each item has a steps block, an expected outcome, and a pass/fail box. Run the full sheet end-to-end before any major release. Clone this file per release and keep it in the repo — it's a regression suite that happens to be written in English.

**Before you start:**
- [ ] Swap Xero OAuth to **Demo Company** first (Settings → Integrations → Xero → reconnect to demo) so accounting entries don't hit real books. Swap back when UAT passes.
- [ ] Have a second browser window open with the Xero demo tab so you can verify sync in real time.
- [ ] Note the date + build SHA you're testing against (top of Vercel dashboard).

Legend: `[ ]` not run · `[x]` passed · `[!]` failed (note issue inline)

---

## 1. Auth & Navigation

| # | Flow | Steps | Expected | Result |
|---|---|---|---|---|
| 1.1 | Login — happy path | Open `crm.centrefit.com.au` → log in with staff email | Lands on dashboard, sidebar visible, username in top-right | `[ ]` |
| 1.2 | Login — bad password | Enter wrong password | Clear error message, no session created | `[ ]` |
| 1.3 | Logout | Click logout from user menu | Redirected to `/login`, dashboard inaccessible after | `[ ]` |
| 1.4 | Session persistence | Refresh the page after login | Still logged in, no flash of login screen | `[ ]` |
| 1.5 | Direct URL without login | Paste `crm.centrefit.com.au/quoting` into a private window | Redirected to login, then back to quoting after auth | `[ ]` |
| 1.6 | Middleware — API auth | `curl https://crm.centrefit.com.au/api/invoices/create -X POST` (no session) | 401 or redirect, never a 500 | `[ ]` |

---

## 2. Customers

| # | Flow | Steps | Expected | Result |
|---|---|---|---|---|
| 2.1 | Create customer — residential | Customers → New → enter name, address, primary contact email/phone → Save | Customer appears in list with correct data | `[ ]` |
| 2.2 | Create customer — business w/ ABN | Same, tick "business", enter ABN | ABN stored, displayed on customer detail page | `[ ]` |
| 2.3 | Missing required field | Leave name blank → Save | Inline validation error, no DB row created | `[ ]` |
| 2.4 | Duplicate customer name | Create two customers with exact same name | Both save (intentional — names aren't unique) OR warning (check current behaviour) | `[ ]` |
| 2.5 | Edit customer | Open customer → edit name → Save | Update persists, reflected across related quotes/invoices | `[ ]` |
| 2.6 | Xero contact sync on first invoice | Create customer with NO `xero_contact_id` → create invoice (§7) | Xero contact auto-created, `xero_contact_id` populated on CRM customer row | `[ ]` |
| 2.7 | Primary contact logic | Customer with 3 contacts, one marked primary → generate quote | Quote uses primary contact's email + phone, not another contact's | `[ ]` |

---

## 3. Sites

| # | Flow | Steps | Expected | Result |
|---|---|---|---|---|
| 3.1 | Add site to customer | Customer detail → Add site → enter address + site details | Site appears under customer, can be selected on quotes | `[ ]` |
| 3.2 | Multiple sites per customer | Add 3 sites to one customer | All listed, each selectable on quote creation | `[ ]` |
| 3.3 | Edit site | Update site address | Change reflects on all future quotes/jobs tied to that site | `[ ]` |

---

## 4. Quoting

| # | Flow | Steps | Expected | Result |
|---|---|---|---|---|
| 4.1 | Draft quote — full install | Quoting → New → pick customer + site → set device counts + site dimensions → Save draft | Quote saved in `quote_draft` status, pricing snapshot populated | `[ ]` |
| 4.2 | Quote pricing math | Check subtotal + GST + total on draft | GST = 10% of subtotal, total = subtotal × 1.1 (to the cent) | `[ ]` |
| 4.3 | Progress quote (PP1/PP2) | Create quote with `quote_type=progress` → set PP split | PP1 + PP2 totals sum to full total, each has its own subtotal | `[ ]` |
| 4.4 | Scope of Works — section toggles | Open scope editor → uncheck a clause → save | Unchecked clause absent from customer-facing PDF + invoice description | `[ ]` |
| 4.5 | Send quote to customer | Open draft → Send → enter email → Send | Customer receives email from `quotes@centrefit.com.au`, status becomes `quote_sent` | `[ ]` |
| 4.6 | Customer accepts quote | From the email, click Accept → respond form | Status → `accepted`, invoice auto-created (§7.1) | `[ ]` |
| 4.7 | Customer declines quote | Click Decline on respond form | Status → `declined`, no invoice created | `[ ]` |
| 4.8 | Edit quote after send | Try to edit a `quote_sent` quote | Either blocked or creates a new revision (check behaviour) | `[ ]` |
| 4.9 | Duplicate quote | Quote detail → Duplicate | New draft created with copied line items + scope overrides | `[ ]` |
| 4.10 | Expired quote | Set quote expiry date to past → reload | Status shows `quote_expired`, respond form blocks acceptance | `[ ]` |

---

## 5. Procurement (BOM → PO → Receive)

| # | Flow | Steps | Expected | Result |
|---|---|---|---|---|
| 5.1 | BOM auto-populated from quote | Open accepted quote → Procurement tab | BOM lines match device counts × part lists | `[ ]` |
| 5.2 | ORDER toggle — single line | Toggle one BOM line to ORDER → Save | Line flagged for PO creation; IN STOCK lines skipped | `[ ]` |
| 5.3 | ORDER toggle — all lines | Bulk ORDER all lines | All flagged, supplier grouping visible below | `[ ]` |
| 5.4 | Generate Xero draft POs | Click "Create draft POs in Xero" | One draft PO per supplier created, visible in Xero Bills → Draft, contains expected line items | `[ ]` |
| 5.5 | PO contains correct prices | Check draft PO line prices vs BOM | Matches cost price from products table (not sell price) | `[ ]` |
| 5.6 | Receive stock | Procurement → mark line received + enter `received_by` + `received_at` | Fields persist, line shows as received with timestamp + user | `[ ]` |
| 5.7 | Partial receive | Receive only some of the ordered lines | Others remain open, PO status accurate | `[ ]` |
| 5.8 | PO with zero-dollar RFQ line | Line where supplier price not yet confirmed | PO creates with $0 line OR blocks (check current behaviour — this is a known design gap) | `[ ]` |
| 5.9 | Supplier missing from Xero | Add a supplier in CRM only, then create PO | Xero contact auto-created OR clear error with next step | `[ ]` |

---

## 6. Jobs

| # | Flow | Steps | Expected | Result |
|---|---|---|---|---|
| 6.1 | Job from accepted quote | Quote accepted → Jobs list | Job auto-created in `Lead / Unassigned` or configured initial status | `[ ]` |
| 6.2 | Status transitions | Job detail → change status via allowed transition (e.g., Assigned → Scheduled) | Transition succeeds, audit log updates | `[ ]` |
| 6.3 | Invalid status transition | Try to skip from `Lead` to `Invoiced` directly | Blocked with clear error per `job-status-transitions.ts` rules | `[ ]` |
| 6.4 | Assign staff | Assign a technician to a job | Staff name appears on job, their scheduler shows it | `[ ]` |
| 6.5 | Scheduler view | Scheduler page → drag a job to a date/time | Persists, job status updates to `Scheduled` if configured | `[ ]` |
| 6.6 | Checklists | Add a checklist template to a job → tick items | State persists across reloads, per-item timestamps captured | `[ ]` |

---

## 7. Invoicing & Xero (critical — test twice)

| # | Flow | Steps | Expected | Result |
|---|---|---|---|---|
| 7.1 | Auto-invoice on quote accept | Accept a quote (§4.6) | Invoice created in CRM + Xero as **DRAFT**, no pay-now link yet, accounting books unchanged | `[ ]` |
| 7.2 | Authorise button — happy path | Open draft invoice → click Authorise → confirm | Xero invoice → AUTHORISED, pay-now link populated, CRM status = `authorised` | `[ ]` |
| 7.3 | Authorise — Xero down / auth expired | Disconnect Xero OAuth in settings → click Authorise | Clear error, CRM remains `draft`, error stored in `xero_last_error` | `[ ]` |
| 7.4 | Copy pay-now link | Authorised invoice → Copy pay link button | Clipboard contains Xero online invoice URL, toast confirms | `[ ]` |
| 7.5 | Refresh from Xero — paid | In Xero demo, mark invoice paid → back in CRM, click Refresh | CRM status → `paid`, `paid_at` timestamp, `amount_paid` matches total | `[ ]` |
| 7.6 | Refresh from Xero — voided | Void invoice in Xero → click Refresh in CRM | Status → `void` in CRM | `[ ]` |
| 7.7 | Progress invoice PP1 | From progress-type accepted quote, create `progress_pp1` invoice | Created with PP1 amount only, description notes "On Acceptance" | `[ ]` |
| 7.8 | Progress invoice PP2 | After PP1, create `progress_pp2` | Created with PP2 amount, description notes "On Completion" | `[ ]` |
| 7.9 | Duplicate PP invoice blocked | Try to create PP1 twice for same quote | 409 error, no second invoice | `[ ]` |
| 7.10 | Ad-hoc invoice | Customer → New ad-hoc invoice → enter line items + description | Description prepended as $0 header line, priced lines after | `[ ]` |
| 7.11 | Zero line items | Try to create an invoice with no lines | Blocked with clear error, nothing hits Xero | `[ ]` |
| 7.12 | Invoice total = Xero total | Compare CRM invoice `total` to Xero INV-#### total | Match to the cent — GST calculated consistently | `[ ]` |

---

## 8. Suppliers & RFQ

| # | Flow | Steps | Expected | Result |
|---|---|---|---|---|
| 8.1 | Create supplier | Suppliers → New → name + contact details | Supplier appears in list, selectable on procurement | `[ ]` |
| 8.2 | Send RFQ | Procurement → RFQ → select supplier → send | Supplier receives email from `procurement@centrefit.com.au`, reply-to is `accounts@centrefit.com.au` | `[ ]` |
| 8.3 | RFQ link works | Open RFQ link in email | Supplier can view request items + enter prices without login | `[ ]` |
| 8.4 | Supplier submits quote | Submit prices on RFQ form | CRM shows quoted prices, flagged for Mitchell review | `[ ]` |

---

## 9. NBN Enquiries (from centrefit.com.au)

| # | Flow | Steps | Expected | Result |
|---|---|---|---|---|
| 9.1 | Website NBN order lands in CRM | Submit order on `centrefit.com.au/checkout` | Row appears in CRM → NBN, `raw_payload` contains DD + acknowledgments + router choice | `[ ]` |
| 9.2 | Notification email | Same | `support@centrefit.com.au` receives order summary email (masked account number) | `[ ]` |
| 9.3 | Contact form | Submit `centrefit.com.au/#contact` | Email lands at `support@centrefit.com.au`, from `noreply@centrefit.com.au` | `[ ]` |
| 9.4 | CRM enquiry detail | Open the NBN enquiry row | All fields render, DD masked in UI, acceptance timestamps visible | `[ ]` |

---

## 10. Reports

| # | Flow | Steps | Expected | Result |
|---|---|---|---|---|
| 10.1 | Revenue report | Reports → Revenue → pick date range | Totals match sum of authorised/paid invoices in range | `[ ]` |
| 10.2 | Job status breakdown | Reports → Jobs | Counts match actual job list filters | `[ ]` |
| 10.3 | Procurement cost report | Reports → Procurement | Total committed spend = sum of PO line costs | `[ ]` |

---

## 11. Settings & Integrations

| # | Flow | Steps | Expected | Result |
|---|---|---|---|---|
| 11.1 | Xero OAuth reconnect | Settings → Integrations → Xero → Reconnect | Redirect to Xero, authorise, redirect back — new token stored, old invalidated | `[ ]` |
| 11.2 | Xero product sync preview | Settings → Products → Sync from Xero → Preview | Shows added/changed/removed — no changes written yet | `[ ]` |
| 11.3 | Xero product sync apply | Apply preview | Changes persist, prices reflect in new quotes | `[ ]` |
| 11.4 | Rules editor | Settings → Rules → edit a pricing rule | Saved, affects next quote | `[ ]` |
| 11.5 | Checklist templates | Settings → Checklists → create template | Template available when adding to a job | `[ ]` |

---

## 12. Edge Cases & Negative Paths

| # | Flow | Steps | Expected | Result |
|---|---|---|---|---|
| 12.1 | Xero token expired mid-action | Wait for token to expire → click Authorise | Auto-refreshes OR prompts reconnect — no silent failure | `[ ]` |
| 12.2 | Supabase offline | Simulate by changing Supabase URL env var temporarily | Graceful 500 with error boundary, not a white screen | `[ ]` |
| 12.3 | Concurrent edits | Two users edit the same quote at once | Last-write-wins OR conflict detection (document which) | `[ ]` |
| 12.4 | Very long inputs | Scope description of 5000 chars on invoice | Truncated to 4000 per Xero limit, no error | `[ ]` |
| 12.5 | Special chars in customer name | `O'Brien & Sons Pty Ltd (Trading as "The Place")` | Renders correctly on PDF, email, Xero | `[ ]` |
| 12.6 | Mobile layout | Open all major pages on phone | Sidebar collapses, tables scroll, buttons reachable with thumb | `[ ]` |
| 12.7 | Browser back button | Deep link → navigate → back button | Returns to previous state, no blank page, form state preserved where expected | `[ ]` |
| 12.8 | Slow network | Chrome DevTools → throttle to "Slow 3G" → create quote | Loading states visible, no double-submit, no crashes | `[ ]` |

---

## 13. Post-Rollout Monitoring (install during UAT, observe after)

- [ ] Sentry installed on CRM (capture prod stack traces)
- [ ] Sentry installed on website (capture prod stack traces)
- [ ] Vercel alerts configured for deploy failures
- [ ] Weekly review of Sentry errors with the team (Monday morning, 15 min)
- [ ] Xero connection health check: alert if `xero_last_error` is non-null for >1 hour
- [ ] Resend webhook for bounces → notify `support@centrefit.com.au` if customer email fails

---

## Sign-off

| Tested by | Date | Build SHA | Pass count | Fail count | Notes |
|---|---|---|---|---|---|
|   |   |   |   |   |   |

**Rule:** don't roll out to the team until every `[ ]` is `[x]` or explicitly waived with a reason in Notes.
