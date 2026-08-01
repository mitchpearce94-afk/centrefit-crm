# Web Proposal — CONTEXT

> Locked 2026-08-01 with Mitchell. Interactive web version of the project
> proposal — the first thing a prospective customer sees. Companion to the
> proposal PDF (see proposal-pdf.tsx), not a replacement: the PDF remains the
> printable/attachment artefact; the web page is the primary experience.

## Decisions

**D1 — Route & access.** New public route `/proposal/[token]`, keyed by the
existing `quotes.response_token` (same token as `/quote-response/[token]` and
the by-token PDF). No login. The plain quote view stays where it is for
quote-only sends.

**D2 — One source of truth.** Server-rendered from the same quote row +
`generateScopeOfWorks()` output the PDF uses. Proposal copy (COMPANY stats,
DIFFERENTIATORS, SUPPORT_CARDS, NBN_PLANS, OFFERINGS, TESTIMONIALS) is
extracted from `proposal-pdf.tsx` into a shared module (`src/lib/proposal-content.ts`)
imported by BOTH the PDF and the web page — copy can never drift between the two.

**D3 — Send flow.** The "Full proposal" send option emails the web link as the
primary CTA with the proposal PDF attached as fallback. `sent_as_proposal`
column already exists and keeps gating which by-token PDF variant serves.

**D4 — Experience.** Dark slate palette matching the PDF (no new brand
colours). Scroll-driven: hero (client name, formatted site address, system
chips) → animated stat counters → differentiators → support → NBN plans →
testimonials → live scope + pricing. Animations are CSS +
IntersectionObserver only — no animation libraries. Mobile-first; must be
excellent on a phone.

**D5 — It closes, not just impresses.** The page ends on the real scope of
works and pricing with the existing Accept/Decline response flow (reuse the
`/quote-response` components/actions — same token, same server actions). The
proposal is a closing tool; Accept is the final scroll position.

**D6 — Photography.** Brand-neutral craft shots ONLY (racks, cable dressing,
camera/reader installs, control room — no gym signage or franchise branding in
frame). Rationale: naming brands in copy = track record; competitor-branded
imagery = allegiance, and reads wrong on cross-brand proposals (e.g. Total
Fusion receiving Snap-branded imagery). V1 ships with gradient/texture slots
where photography will drop in; Mitchell to supply shots later.

**D7 — Tracking.** Reuse `logDocumentActivity` view logging on the proposal
route (distinct activity type so proposal opens are distinguishable from quote
opens). Existing notification on first open carries over.

**D8 — Parked for v2** (do not build in v1): audience-aware testimonial
rotation (Snap proof for Snap, TF for TF, breadth for non-gym), section-level
engagement analytics, embedded video walkthrough, e-sign embedded in-page.

## Non-negotiables

- All four Mark-review fixes (name dedupe, formatted address, no Additional
  items, singular counts) apply — the web page renders the same corrected data.
- No customer-facing send of anything without Mitchell's explicit OK.
- Sub-second first paint on 4G. If a design choice fights load speed, load
  speed wins.
