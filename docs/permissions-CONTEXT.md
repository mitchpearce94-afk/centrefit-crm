# Centrefit CRM Permissions & Dashboard — CONTEXT

Locked design decisions for the role-based permission system and the
permission-aware dashboard. Same convention as `vault-CONTEXT.md`: every
build task references one of the D-numbered decisions below.

Last updated: 2026-05-18. Owner: Mitchell.

---

## Goal

Replace the current ad-hoc role checks (~30 files cross-referencing four
hardcoded roles) with a proper permission system:

- **Roles as templates** for sensible new-staff defaults.
- **Per-staff overrides** so one staff can be "mostly field + some
  invoicing" without inventing a new role.
- **Dashboard composes from widgets** the staff has permission to see —
  field techs don't see pipeline dollar totals; finance sees cash collected.
- **Admin is special** — Mark and Mitchell. Always all permissions, can't
  be overridden off.

The catalyst: today field staff can browse Quoting/Invoices/Pipeline
freely and see all dollar figures. Once customer data + the upcoming
vault credentials are on the CRM, that's not acceptable.

---

## Architectural decisions

### D1. Permission model: roles as templates + per-staff overrides
- Four roles stay as starting templates: `admin`, `finance_manager`,
  `project_manager`, `field_staff`. New staff = pick role = sensible
  defaults.
- Each role has a default set of permission flags (D4 lists them all).
- A `staff_permissions(staff_id, flag, granted)` table holds per-staff
  overrides — either `granted=true` (grant a flag the role doesn't have)
  or `granted=false` (revoke a flag the role does have).
- Resolution: `effective = role_defaults UNION grants MINUS revokes`.
- **Admin role is special.** Always has every flag. Cannot be revoked.
  The admin-management UI hides toggle controls for admins.

### D2. Granularity: both page-level and data-level
- **Page-level:** `quoting.view` controls whether the Quoting sidebar
  entry appears AND whether `/quoting/*` routes return data. Server-side
  route guards return 404 (not 403) so the existence of pages they can't
  see isn't leaked.
- **Data-level:** `quoting.view_amounts` controls whether $ totals render
  on quote lists/details. They can see the quote exists and what's in
  the scope of works, but dollar columns render as `—` or are omitted.
  Same pattern for invoices, pipeline, procurement costs.

### D3. Admin UI: inline expander on each /staff card
- Matches the existing notification-prefs inline editor pattern.
- Click a staff card → role dropdown at top, below it a collapsible
  "Permissions" section grouped by area (Customers, Sites, Jobs,
  Quoting, Invoices, Scheduler, Procurement, Plans, NBN, Suppliers,
  Reports, Settings, Vault).
- Each toggle shows three states: "On (role default)", "Off (role default)",
  "On (granted override)" / "Off (revoked override)". Resetting an
  override removes the row from `staff_permissions`.
- Only admins see the editor at all. Audit-logged.

### D4. Permission flag catalogue (v1)

**Customers**
- `customers.view` · `customers.edit_basic` · `customers.create`
- `customers.archive` · `customers.edit_billing_terms`

**Sites**
- `sites.view` · `sites.edit_basic` · `sites.manage_assets`
- `sites.manage_contacts` · `sites.edit_key_info`

**Jobs**
- `jobs.view` · `jobs.view_all` (vs only assigned)
- `jobs.update_status` · `jobs.manage` (create/edit/cancel)
- `jobs.assign_others` (assign teammates to jobs)

**Quoting**
- `quoting.view` · `quoting.view_amounts` ($) · `quoting.view_cost_prices`
- `quoting.create` · `quoting.send` · `quoting.accept_manually`

**Invoices**
- `invoices.view` · `invoices.view_amounts`
- `invoices.authorise` (Xero DRAFT → AUTHORISED, **gated tighter than
  send** — D5)
- `invoices.send` · `invoices.manage_recurring`

**Scheduler**
- `scheduler.view_all_team` (else: own entries only)
- `scheduler.manage` · `scheduler.assign_others`

**Procurement**
- `procurement.view` · `procurement.view_costs`
- `procurement.manage` (create/send POs) · `procurement.receive`

**Plans (plan-builder)**
- `plans.view` · `plans.manage` · `plans.send_to_electrician`

**NBN**
- `nbn.view` · `nbn.manage` · `nbn.view_recurring_revenue`

**Suppliers**
- `suppliers.view` · `suppliers.view_pricing` · `suppliers.manage`

**Reports**
- `reports.view_operational` · `reports.view_financial`

**Settings**
- `settings.basic` (own profile, notification prefs)
- `settings.staff` (admin only, hard-locked)
- `settings.integrations` (Xero, GoCardless, Stripe, Resend, Kinetix)
- `settings.business_units` · `settings.products` · `settings.electricians`
- `settings.asset_types`

**Vault**
- `vault.access` (does this staff have a vault account at all)
- Folder-level roles handled in vault_folder_members — orthogonal.

### D5. Invoice authorise is gated tighter than send
- PMs can create quotes, send invoices to customers, follow them up. But
  flipping a DRAFT invoice to AUTHORISED in Xero is a legal/commercial
  commitment that stays with admin + finance only.
- Rationale: separates "I produced this" from "this is now a binding
  commercial document." Limits blast radius of a PM mistake.

### D6. Field staff are full editors of on-site data
- They're the ones inputting site assets, router credentials, key info
  on site during installs.
- Field staff DO get: `sites.edit_basic`, `sites.manage_assets`,
  `sites.manage_contacts`, `sites.edit_key_info`, `customers.view`,
  `customers.edit_basic` (fix wrong addresses inline).
- Field staff DO NOT get: `customers.create` (sales/PM creates the
  customer first), `customers.archive` (admin only), `customers.edit_billing_terms`
  (finance only).

### D7. Field staff see all customers/sites view-side
- Not just those tied to their assigned jobs. Reason: troubleshooting
  call-outs need access to the site's router admin password and key info
  even if the tech isn't formally on the job.
- Job-level filtering only applies to `jobs.view` and `scheduler` (where
  "I see only my own" is the useful default).

### D8. Default role permission grants

#### `admin` — Mark + Mitchell only
ALL flags ON. Cannot be revoked. UI for admins shows the editor without
toggle controls — they see what permissions exist but can't modify their
own (or each other's) admin-level access. A non-admin can never be
upgraded to admin from the UI — that promotion is a manual SQL operation
to prevent accidental privilege escalation.

#### `finance_manager` — bookkeeper, future finance ops
- Customers: view, edit_basic, edit_billing_terms (NOT create/archive)
- Sites: view (read-only)
- Jobs: view, view_all (read-only — no edit)
- Quoting: view, view_amounts, view_cost_prices (read-only)
- Invoices: view, view_amounts, **authorise, send, manage_recurring**
- Scheduler: view_all_team (read-only)
- Procurement: view, view_costs (read-only)
- Plans: view
- NBN: view, view_recurring_revenue
- Suppliers: view, view_pricing
- Reports: view_operational, **view_financial**
- Settings: basic
- Vault: access

#### `project_manager` — Lily, future PMs
- Customers: view, edit_basic, create (NOT archive, NOT edit_billing_terms)
- Sites: view, edit_basic, manage_assets, manage_contacts, edit_key_info
- Jobs: view, view_all, update_status, manage, assign_others
- Quoting: view, view_amounts, create, send, accept_manually (NOT view_cost_prices)
- Invoices: view, view_amounts, send (NOT authorise — D5)
- Scheduler: view_all_team, manage, assign_others
- Procurement: view, manage, receive (NOT view_costs)
- Plans: view, manage, send_to_electrician
- NBN: view, manage
- Suppliers: view
- Reports: view_operational
- Settings: basic, electricians
- Vault: access

#### `field_staff` — Michael, future techs
- Customers: view, edit_basic (D6)
- Sites: view, edit_basic, manage_assets, manage_contacts, edit_key_info (D6)
- Jobs: view (own only — D7), update_status (mark complete, add work entries)
- Quoting: **none** (no $ visibility)
- Invoices: **none**
- Scheduler: own entries only (no view_all_team)
- Procurement: receive (mark items in when collecting stock)
- Plans: view
- NBN: view
- Suppliers: view
- Reports: **none**
- Settings: basic
- Vault: access

### D9. Dashboard composition rules
- Dashboard is composed from a fixed list of widget components. Each
  widget declares the permission flags it requires.
- Render only widgets the staff has permission for. Empty area → render
  a graceful empty state, not blank space.
- Mobile dashboard stays the "Today" view it is now (already
  permission-aware via job_staff filter); desktop changes.

| Widget | Requires |
|--------|----------|
| Today / My jobs (mobile) | always |
| Active Jobs count | `jobs.view` (count scoped to view_all vs own) |
| Overdue Jobs count | `jobs.view_all` |
| Customers count | `customers.view` |
| Pipeline Value $ | `quoting.view_amounts` |
| Outstanding Invoices $ | `invoices.view_amounts` |
| Cash collected this month $ | `reports.view_financial` |
| Recurring MRR $ | `invoices.manage_recurring` + `invoices.view_amounts` |
| Recent Jobs list | `jobs.view` (own when no view_all) |
| Today's full Schedule | `scheduler.view_all_team` |
| Outstanding quotes waiting on customer | `quoting.view` |
| Notifications bell | always |

### D10. Server-side enforcement, not client-side
- Permission checks happen in Server Components / Route Handlers /
  Server Actions. RLS policies on Supabase enforce the same checks at
  the DB layer (defense in depth).
- Client-side hides UI for things the staff can't do, but never relies
  on hiding alone — a malicious user can't get data by manipulating the
  client because the server returns 404 / 403.
- Hide vs 404 vs 403: hide nav entries and conditional UI. Return 404
  for routes the staff doesn't have permission to see (don't leak the
  feature exists). Return 403 only for actions they have read access to
  but not write access (e.g., they can see an invoice but can't authorise it).

### D11. Audit log
- Every permission grant/revoke writes to a `permission_audit_log` row:
  who changed it, who it affects, which flag, before/after, when.
- Mirrors the vault audit log pattern. Append-only via security-definer.
- Visible at `/settings/staff/audit` to admins.

### D12. Migration of existing role checks
- The ~30 files that check `staff.role === 'admin'` keep working during
  rollout (role still exists as a column, role defaults populate
  effective permissions).
- Build a `hasPermission(staff, flag)` helper. Migrate role checks one
  file at a time to permission checks. Old role checks remain as a
  fallback for unmigrated code.
- Migration is incremental — no big-bang.

### D13. Data model

```
permission_flags
  flag                text PK     e.g. 'quoting.view_amounts'
  area                text        e.g. 'Quoting' — for UI grouping
  label               text        human-readable for the editor
  description         text NULL
  sort_order          int

role_default_permissions
  role                text        'admin' | 'finance_manager' | 'project_manager' | 'field_staff'
  flag                text FK permission_flags.flag
  PRIMARY KEY (role, flag)

staff_permissions
  staff_id            uuid FK staff.id
  flag                text FK permission_flags.flag
  granted             boolean     true = grant override; false = revoke override
  granted_by          uuid FK staff.id
  granted_at          timestamptz
  PRIMARY KEY (staff_id, flag)

permission_audit_log
  id                  uuid PK
  changed_staff_id    uuid FK staff.id
  changed_by          uuid FK staff.id
  flag                text NULL   null when role itself changed
  action              text        'grant' | 'revoke' | 'reset' | 'role_change'
  before              text NULL
  after               text NULL
  created_at          timestamptz
```

- `permission_flags` is seeded from a migration; new flags ship via
  migration not via runtime UI (keeps catalogue intentional).
- `role_default_permissions` is also seeded — changes ship via migration.
- `staff_permissions` is the only runtime-mutable table.

### D14. What we are NOT building in v1
- Permission groups / custom role definitions (user creates "Senior PM"
  role). Stick with the four hard-coded role templates.
- Time-bound permissions ("grant until end of week"). Always permanent
  until revoked.
- Approval workflow on permission grants ("requires two admins"). Single
  admin can grant.
- Granular per-record permissions ("staff X can see this one customer
  but not that one"). Permissions are area-level, not record-level —
  record-level access stays with the existing job_staff / vault folder
  ACL patterns.

---

## Phased build

| Phase | Scope | Estimate | Status |
|------:|-------|----------|--------|
| **A** | `permission_flags` seed + `role_default_permissions` seed + `staff_permissions` table + `hasPermission()` helper + audit log table | 1 day | Not started |
| **B** | Admin UI: inline expander on /staff cards, role dropdown wired to defaults, per-flag toggles, audit-logged grants/revokes | 1–2 days | Not started |
| **C** | Migrate sidebar + dashboard widgets to permission-based rendering. Replace ~10 high-impact `staff.role === 'admin'` checks with `hasPermission()`. Add route-level 404 guards on Quoting/Invoices/Procurement/Reports for staff without view permission | 2 days | Not started |
| **D** | Iterative migration of remaining role checks (the long tail of ~30 files), one PR per area | rolling | Not started |
| **E** | RLS policies on customers/sites/jobs/etc. that mirror the same checks (defense in depth) | 1–2 days | Not started |

Total: ~5–6 focused days. Doesn't depend on vault build; can ship in parallel.

---

## Open questions

- **OQ1 (Phase A).** Should `permission_flags` be referenceable as a TS
  enum (compile-time safety, must rebuild to add a flag) or just a `text`
  PK (runtime flexibility, no compile-time check)? Recommendation:
  **both** — generate the TS enum from the seed migration at build time
  (existing pattern: `npx supabase gen types typescript`).
- **OQ2 (Phase C).** When migrating a route to 404-on-no-permission, what
  about staff who currently have bookmarks to those routes? Will they get
  a confusing "not found" message. Mitigation: 404 page shows a friendly
  "If you think you should see this, ask an admin" hint when the user IS
  authenticated.
- **OQ3 (Vault overlap) — RESOLVED 2026-05-19, NO MIGRATION.**
  `site_assets.admin_password` / `staff_password` / `wifi_ssids` stay in
  plaintext on Key Info, gated by `sites.manage_assets`. Mitchell
  explicitly decided not to migrate site creds into the vault: field
  techs need them in-context at the rack, and anyone with
  `sites.manage_assets` already has the right to see them, so bouncing
  through a separate vault unlock adds friction without changing the
  access-control surface. The vault is for **business-level** shared
  creds (Xero, Outlook, GoCardless, Stripe, AusPost) where only a subset
  of staff should have access. See vault-CONTEXT Goal section + D10.

---

## Reference

- Existing role usage scattered across ~30 files. The migration target
  is `lib/auth/has-permission.ts` once Phase A ships.
- `staff_permissions` table mirrors the existing `staff_notification_prefs`
  pattern — same admin-only-edit, same per-staff-per-flag granularity.
- Vault folder ACL (`vault_folder_members`) is the orthogonal record-level
  access pattern. Don't conflate the two systems.
