# Centrefit CRM — Mobile Foundation (Phase 1)

**Date:** 2026-05-12
**Owner:** Mitchell
**Status:** Approved for plan-writing
**Predecessor decisions:** [Mobile plan-builder is view-only](../../../../.claude/projects/C--Users-mitch-Projects/memory/project_centrefit_crm_mobile_plan_view_only.md) (memory note)

---

## Goal

First phase of a multi-phase rebuild that makes Centrefit CRM Mitchell's daily-driver from a phone. "Tradify-killer" polish: every feature reachable on mobile, touch ergonomics, Square/Uber-tier visual hierarchy. Phase 1 covers the foundation — navigation, layout shell, design-system polish, and the three pages every journey passes through (Today, Jobs list, Jobs detail). Later phases each get their own spec and plan.

## Why now

- Sidebar nav was historically gated to Today / Jobs / Scheduler on mobile because the original assumption was "techs in the field only." Mitchell now runs ops day-to-day from his phone and needs every route accessible.
- Existing pages have inconsistent mobile treatment: some have card fallbacks, some have `hidden md:block` desktop-only views with no mobile path, some have desktop tabs that disappear without replacement on `< sm`.
- Touch ergonomics, type scale, and modal patterns were never systemised for mobile.

## Out of scope (Phase 1)

Each item below has — or will have — its own spec in a later phase.

- Plan-builder canvas editing on touch (deferred indefinitely; view-only when it lands)
- Quote wizard / quote-response / quote-send polish (Phase 2)
- Field-tech execution surfaces — checklists, time entry, materials, photos, signatures (Phase 3)
- Invoices, procurement, recurring plans, suppliers (Phase 4)
- Settings, products catalogue, rules, electricians, scope-roles (Phase 5)

## Architecture & information architecture

### Navigation

Two nav surfaces based on viewport.

**Mobile (`< lg`)**: bottom-tab bar with five slots.

| Slot   | Destination | Rationale |
|--------|-------------|-----------|
| Today  | `/`         | Triage and overview — every journey starts here |
| Jobs   | `/jobs`     | Most-touched destination across roles |
| Schedule | `/scheduler` | What's-on, who's where |
| Quotes | `/quoting`  | Sales pipeline |
| More   | drawer      | Every other route + Settings sub-section |

The "More" tab opens a full-screen drawer listing the un-pinned routes (Customers, Sites, NBN, Suppliers, Invoices, Procurement, Plans, Reports, Staff) and a collapsible Settings section (Billing, Checklists, Electricians, Products, Recurring Services, Rules, Scope Roles, Integrations). Account / sign-out live in a user-row at the drawer's bottom.

**Desktop (`≥ lg`)**: existing left sidebar stays. No visual or behavioural change. The same `navigation` array drives both.

### Top app bar

Context-aware via a new `<PageHeader>` primitive every page renders.

```
<PageHeader
  title="Quotes"
  back={false}
  actions={[<SearchAction/>, <NewQuoteAction/>]}
/>
```

- Detail pages set `back={true}` — back arrow on the left.
- Pages own their 0–2 actions on the right (search, new, filter, menu).
- The hamburger trigger that lives in the top-bar today is *removed* — the drawer is reached via the "More" bottom-tab.

### Page chrome

- Safe-area-inset aware: `env(safe-area-inset-top)` for the top bar, `env(safe-area-inset-bottom)` for the bottom-tab bar.
- Sticky top bar, sticky bottom tabs, scrollable middle.
- Body content gets `pb-safe-bottom-tabs` padding so the last item isn't hidden behind the tab bar.

## Design system

Existing tokens stay (Tailwind v4 + Geist + dark default + the `surface-card` style). Polish, not redesign.

### Touch targets

Every interactive element gets a `≥ 44 × 44` hit area. Audit-and-patch across every page. Inline icon-buttons grow via padding rather than visual size.

### Type scale

| Token | Current | Mobile target | Desktop target |
|-------|---------|---------------|----------------|
| Body  | 13px    | **15px**      | 14px (unchanged) |
| Small | 11px    | **12px**      | 11px |
| H1    | 20px    | **22px**      | 20px |
| H2    | 16px    | **17px**      | 16px |

Implemented via Tailwind responsive prefixes on a small number of typography utility classes.

### Density

Card and list-row padding bumped from ~8/12px to **12/16px** on mobile. Generous breathing room beats dense info display for one-handed use.

### Modal pattern — bottom-sheet primitive

New `<Sheet>` component replaces the centred-modal-on-mobile pattern. On mobile, sheets slide up from the bottom, occupy whatever height they need (with `max-height: 90vh` + internal scroll), can be dismissed by swipe-down or backdrop-tap. On desktop, the same `<Sheet>` renders as a centred modal — same API, different transform.

Existing modals get migrated as we touch them, not all at once. Phase 1 migrates: status-transition modal on job detail.

### Sticky CTAs

Primary action on any form/flow gets a sticky bottom-of-viewport position on mobile. Above the bottom-tab bar. Prevents the most common "save buried below the fold" failure on long forms.

### Status pills

Keep existing colour mapping (status.colour driven). Pill shape, slightly larger (10px → 11px font, 8/2px → 10/3px padding).

### What we explicitly are NOT changing

- Primary blue or any colour values
- Geist font family
- Dark mode default
- The `surface-card` / `card` border treatment
- Any business logic

## Phase 1 pages

### Today (`src/app/(dashboard)/page.tsx`)

Restructure as a vertical card stack with one stats strip at the top.

```
┌──────────────────────────────────────┐
│  PageHeader: "Today"      [filter]   │
├──────────────────────────────────────┤
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐             │
│  │ 4 │ │ 7 │ │ 2 │ │$3k│  stats      │
│  │Jobs│Quote│Inv.│Week│   strip      │
│  └───┘ └───┘ └───┘ └───┘             │
│                                      │
│  ▼ Today's jobs (horizontal swipe)   │
│  ┌────────┐ ┌────────┐ ┌────────┐    │
│  │ CFA547 │ │ CFA544 │ │ CFA541 │ →  │
│  └────────┘ └────────┘ └────────┘    │
│                                      │
│  ▼ Quotes awaiting response          │
│  • Plus Fitness Albany — 3d          │
│  • Goodlife Aspley — 1d              │
│                                      │
│  ▼ Invoices overdue                  │
│  • Snap Warner — $4,200 — 12d        │
│                                      │
│  ▼ Notifications (last 5)            │
│  ...                                 │
└──────────────────────────────────────┘
```

The stats strip is read-only (no link-out). Each section ("Quotes awaiting response", "Invoices overdue") is a tappable row → drills into the relevant filtered list.

### Jobs list (`src/app/(dashboard)/jobs/page.tsx`)

The existing mobile card view (lines ~150-215) is fine — keep it. Three additions:

- Add **sticky filter chips** below the top bar: "Mine / All / Open / Done". Tapping a chip filters the list in place.
- Wire the **search** icon in the top bar (was nowhere). Tap → reveals an inline search input below the chips → filters by job number / customer / site / reference.
- The `hidden md:block surface-card` desktop table is preserved unchanged — `lg:` and up still see the full table. The mobile card view becomes the canonical view for `< md`.

### Jobs detail (`src/app/(dashboard)/jobs/[id]/*`)

Three changes.

1. **Tab strip** — the current `hidden sm:flex` tab row (`job-tabs.tsx:104`) becomes a **horizontally-scrolling tab strip on mobile**. Same tabs, just scrollable. No accordion (Tradify's accordion is exactly the UX we're trying to beat).
2. **Status transition** — current `hidden sm:block` dropdown becomes a **bottom-sheet picker** on mobile (`< sm`). Tap the status pill → sheet slides up listing target statuses with descriptions.
3. **Panels** (`time-panel.tsx`, `notes-panel.tsx`, possibly others) — drop the `hidden md:block` table view *only when there's already a mobile card list above it*. Audit each panel: if a mobile fallback exists, the desktop-table can stay `hidden md:block`. If no mobile fallback, the table needs to render on mobile via horizontal overflow scroll (and that's flagged for a proper redesign in Phase 3).

## Implementation strategy

Single bundled PR. File touches:

| File | Change |
|------|--------|
| `src/components/sidebar.tsx` | Split: keep `<Sidebar>` for desktop, factor out `<MobileNav>` (bottom tabs + More drawer) into a new file |
| `src/components/mobile-nav.tsx` | **NEW** — bottom-tab bar + More-drawer component |
| `src/app/(dashboard)/layout.tsx` | Conditionally render desktop sidebar OR mobile nav based on viewport; remove the `hidden lg:flex` top bar (its functionality moves into `<PageHeader>` and the More drawer) |
| `src/components/page-header.tsx` | **NEW** — `<PageHeader title back actions>` primitive |
| `src/components/sheet.tsx` | **NEW** — bottom-sheet on mobile / centred-modal on desktop |
| `src/app/(dashboard)/page.tsx` | Restructure to card-stack layout, stats strip, horizontal job swipe |
| `src/app/(dashboard)/jobs/page.tsx` | Sticky filter chips + wired search; preserve existing card-list + desktop table |
| `src/app/(dashboard)/jobs/[id]/job-tabs.tsx` | Horizontal-scrolling tab strip on mobile |
| `src/app/(dashboard)/jobs/[id]/status-transition.tsx` | Use new `<Sheet>` instead of dropdown on mobile |
| `src/app/(dashboard)/jobs/[id]/time-panel.tsx`, `notes-panel.tsx`, etc. | Audit and fix `hidden md:block` panels per the rule above |
| Each `(dashboard)/*/page.tsx` | Replace ad-hoc top-bar markup with `<PageHeader>` |
| `globals.css` | Add `pb-safe-bottom-tabs`, type-scale responsive utilities |

Estimated 1–2 working sessions. Phases 2–5 each get their own spec/plan/implement cycle.

## Testing

- Manual: walk every nav destination on a phone viewport (Chrome devtools iPhone 14 Pro, Safari iOS), confirm reachable + readable + tap-friendly.
- Manual: confirm desktop layout unchanged at `≥ lg`.
- Visual smoke: every page renders without horizontal scroll on a 390px-wide viewport.
- No automated test suite for layout — the test is "Mitchell uses it for a week without complaint."

## Risk and mitigation

- **Layout shell rewrite affects every page.** Mitigation: ship behind a single PR that's locally verified across every top-level route before push. No staged rollout — Phase 1 either lands or it doesn't.
- **`<Sheet>` primitive interferes with existing modal libraries.** Mitigation: no external modal lib in use; ad-hoc divs only. New `<Sheet>` is the canonical primitive going forward, existing modals migrate as we touch them.
- **`pb-safe-bottom-tabs` on every page is easy to forget.** Mitigation: bake it into the `(dashboard)/layout.tsx` body wrapper so it's automatic.

## Success criteria

- Every nav route reachable on a 390px-wide viewport in two taps or less.
- No tap target smaller than 44×44.
- No horizontal scroll on any Phase 1 page at 390px.
- Today / Jobs list / Jobs detail pass a "would I show this to Mitch and not wince" eyeball test.
- Mitchell can complete a job-triage session (open Today, drill into a job, change its status, leave a note) from his phone without reaching for the desktop.
