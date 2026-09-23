# Quoting v2 — CONTEXT (diagnosis + proposed design)

Drafted 2026-09-23 by Cortex; **decisions 1–4 locked by Mitchell the same evening** (see *Locked answers*). D9's design direction is still open. Every build task references a D-number.

## Brief (Mitchell, 23 Sep 2026)

> Not 100% happy with quotes. Stuff being missed all over the place, because I'm over-confident the rules are correct. There needs to be kits — pick an alarm panel and every component comes with it so you don't have to think. A quote with no plan should ask questions and generate the quote from the answers, then add the extra little things individually. Anyone should be able to do it without knowing the specifics. It doesn't feel premium.

## Diagnosis — what the data and the code say

Evidence: 73 quotes since 1 Mar 2026; 34 accepted quotes with jobs; 843 procurement items on those jobs; the quote engine (`src/lib/quote-engine/*`, 2,900 lines) and the wizard (`quoting/new/quote-wizard.tsx`, 3,100 lines).

1. **Half of all quotes get no engine.** 44 plan quotes: 2,072 lines, 75% auto-added by rules. 29 manual quotes: 163 lines, **0 auto-added, no template, no rules, no checks** — every line typed from memory. Manual mode skips the Rules step entirely (`quote-wizard.tsx:157-167`).
2. **Kit knowledge is filed under the franchise, not the product.** Snap template 81 active rules; Planet Fitness 23; Inner Range 10; Total Fusion 2; manual 0. The items missed on PF and no-template jobs (armature plate, door loop, PSU, connector board, relays, plugs, ETHM-A, SIMs, switch, monitor) all HAVE a rule — in the Snap template only. A mag lock on a PF job never brings its armature plate.
3. **Some parts have no rule anywhere:** PF break glass (5 jobs), NVR hard drives (6 jobs; sized by cameras × retention), PIR wall mounts, patch leads, AV taps/splitters, MW730B enclosure.
4. **The cost:** 125 of 843 procured items (15%) were added after the quote, on 12 of 34 jobs (35%). Unquoted parts are bought at cost with no margin and no customer approval.
5. **Whole device families are invisible to the BOM.** `DEVICE_TYPES` (28 entries, `constants.ts`) drives the device→product step. Plans emit `card_reader`, `alarm_keypad`, `data_point`, `integration_cable`, `coax_point`, `intercom_master/slave` — **none are in the constant and no product carries them as a device_type.** Verified: every plan quote since March with card readers drawn (12 quotes, 1–6 readers each) has **zero reader hardware lines**; 37 quotes count keypads the same way. Labour is charged for them; the part never lands. **DECIDE: are readers/keypads supplied by Centrefit (then they've never been quoted) or by the customer (then the plan shouldn't count them)?**
6. **Site info is hand-typed and usually zero.** 11 blank number boxes on step 0, never filled from the plan. On plan quotes since March: site_sqm zero on 20/44, tv_count zero on 25/44. At zero the whole AV family (splitters, taps, fly leads, mounts), concrete mounts and 4-way plugs compute qty 0 and are silently skipped (`dependency-engine.ts:383`).
7. **Rules fail silently.** A rule whose product is deactivated, renamed or missing → `continue`, no trace. A rule with a null template and no universal flag can never fire (1 live today). Two paths to the same product take the **max**, not the sum (`dependency-engine.ts:403`, `bom-engine.ts:172`).
8. **Zero-dollar lines ship.** 45 lines with $0 sell across 21 quotes; `[No product set for …]` lines are quoted free, excluded from procurement, invisible on the PDF.
9. **The customer never sees the parts.** The PDF renders the narrative scope only. Roles the scope generator doesn't handle (`hdd`, `ups`, `fibre`, `patch_panel`, `emergency_door_release`, `video_intercom`, `volume_control`, `miscellaneous`, and every product with no scope_role) are dropped from the document — the "Additional items" catch-all was deleted. The wizard's banner tells the operator the opposite.
10. **Nothing blocks a send.** The only save gate is a labour warning that can never fire (no section is ever `mandatory`). Editing a draft never regenerates (template/site/device changes don't recalc). Confirming a supplier price updates the line but not the quote total.
11. **Rules are seeded from code and edited in the DB.** A re-seed once wiped hand-built Inner Range rules. Two sources of truth.
12. **Pricing quirks to fix while we're in there:** `fixedCosts` is always empty so PP1 callout/incidentals/admin resolve to 0; the discount % magnitude is never used (5% uplift trick); callout/incidentals/admin and extras carry zero margin.

Root cause in one sentence: **completeness depends on a person remembering, because the system encodes knowledge in the wrong place (templates, code constants, hand-typed boxes) and never checks its own output.**

## Design principle

**A quote cannot be wrong by omission.** Knowledge lives on products (kits), inputs come from questions or the plan (never blank boxes), and the finished BOM is checked against rules before anyone can send it. Templates only choose *which* product fills a role, never *whether* something is included.

## Proposed decisions

**D1 — Kits live on products, additively.** `product_kit_components` (new; the existing `quote_product_kit_contents` "contains / net-off" stays for the K6000-includes-enclosure case, renamed in the UI to *Ships with*). A kit component row = product, quantity rule (`fixed` per unit · `per_n` units · `per_device_type` on the quote · `formula` e.g. HDD by cameras×retention), `required | optional | ask`. Kits compose (NVR kit → HDD kit). Applies to every quote mode and every template. Examples to seed:
- Bosch K6000 panel → CFLGE2022 connector board, CM444B ×3, 4W/2W/3W/6W plugs (per detector count), ETHM-A, MY368AU 4G modem, SIM + monitoring sub, 5-port switch, MP3560 PSU, Finder relays ×2 + mounts; *ships with* MW730B.
- Mag lock → armature plate (glass vs standard: **ask**), door loop, 12 V PSU, break glass (product chosen by template default).
- NVR → HDD (formula: cameras × retention days), monitor (optional), patch leads (cameras + 2), UPS (ask).
- PIR wall → wall mount. Camera → mount by surface (plaster/concrete from site info).
- Card reader (PF template only) → Veyla reader + controller per N doors, REX, door loop. Snap: reader is customer-supplied → no hardware, labour + cabling only (device type flagged `customer_supplied` per template).

**D2 — Migrate the Snap rules into kits, once.** A script reads every "when X > 0 add Y" rule and proposes a kit component on X's product; Mitchell/Sue approve in a Kit editor on the product page (Settings → Products → Kit tab). What survives as a *dependency rule* is only what genuinely depends on the site (sqm → cable rolls, interstate → freight, concrete → mounts) — and those become universal. Code seeding is removed; the DB is the only source; a "Rules & kits" export/import replaces re-seed.

**D3 — Device coverage is enforced, not assumed.** `DEVICE_TYPES` becomes data (`quote_device_types`: code, legend, default scope_role, labour_code) so a plan symbol can't exist without a quotable device type; every device type must map to ≥1 active product with that `device_type` or a kit. A nightly check lists device types with no product and products with no scope_role/labour_code (the "coverage report", also shown in Settings).

**D4 — Guided quote for no-plan jobs ("interview").** Manual mode is replaced by a question flow that fills the same `device_counts` + site fields the plan produces, then runs the same engine. Question set is data-driven (`quote_questions`: prompt, answer type, maps to device type / site field / kit option, shown when …). First pass: *What are we quoting?* (Alarm · CCTV · Access control · Data & Wi-Fi · AV · Duress · Tailgating · Service call) → per system 3–6 questions (doors: how many, glass or timber, existing panel?; cameras: inside/outside, plaster/concrete, retention days; sqm; storeys; interstate). Then BOM → the operator adds "the extra little things" from a category-filtered catalogue with search, each added line flagged `manual` so we learn from it. Site info boxes disappear; every number comes from a question or the plan.

**D5 — Completeness checks ("lint") before send.** A check runs on the final BOM regardless of how it was built and blocks send on errors (override with a reason, audited): NVR without HDD · cameras without recorder · door hardware without PSU · reader without controller · panel without a comms path · detectors > zone capacity without expander · devices with zero cabling · a device with a labour code but no labour · any line with no product or $0 sell · discontinued product · cost price older than 60 days / no supplier offer · site field still zero while a rule depends on it · device type on the plan with no product. Each finding has a one-click fix. Shown on the Summary step and the quote page.

**D6 — The system learns from every miss.** Every procurement item added after acceptance, and every manual line added in the wizard, lands in a *Quote gaps* inbox: "Break glass added after the quote on 5 PF jobs — add to the mag lock kit for Planet Fitness?" One click creates the kit component or check. This is the loop that stops "over-confident rules" for good.

**D7 — Templates become thin.** A template = product choice per role (existing device defaults), scope wording, branding. No per-template kit rules.

**D8 — Fix the engine's silent failures.** Sum not max when two paths hit one product; a rule that can't resolve its product is an *error in the coverage report*, never a skip; editing a draft re-runs the engine (with a diff view of what changed); supplier price confirmation recomputes the quote total; `fixedCosts` populated so PP1 is right; discount % is a real percent; callout/admin/incidentals and extras get a margin setting.

**D9 — The customer sees what they're buying.** The document gets a *What's included* section per system: kits rendered as one line each ("Bosch Solution 6000 alarm system — panel, comms, power, 12 detectors") with an expandable parts list, quantities for every device, and every product reaches the page (unhandled roles get a proper home, not the bin). Premium output is a separate pass with Mitchell's eye on it: consistent sections (Overview · What's included · Your side · Exclusions · Investment with options · Timeline · Acceptance), one design for PDF and web. **DECIDE: design direction — evolve the current proposal look, or start fresh?**

**D10 — Phasing.** Phase 1: kits + migration + coverage report + lint + engine fixes (this removes most of the missed list and makes every quote checkable). Phase 2: the interview for no-plan quotes. Phase 3: quote-gaps inbox. Phase 4: premium document. Phase 1 alone changes the number in diagnosis §4.

## Locked answers (Mitchell, 23 Sep 2026)

1. **Readers/keypads/intercoms/data points.** Snap clubs: the reader is customer-supplied — no hardware line, labour and cabling still quoted. Planet Fitness: Centrefit supplies the **Veyla readers and controllers** — the PF template's access kit must include them. **Keypads ship inside the K6000 alarm kit** (kit *ships with* 1 keypad; extra keypads beyond the kit add the keypad product). **Intercoms** have been added by hand so far — become a kit. **Data points are cable runs only** — a device type with no product, labour + cable, never a "[No product set]" line.
2. **Kit content is owned by Mitchell.**
3. **Lint blocks send.** Override with a reason, audited.
4. **HDD sizing: 30 days retention ≈ 1 TB per camera.**
5. Document design direction — still open (D9).

## Open question (DECIDE)

1. Document design (D9): keep the current proposal/quote look and fix what it shows, or a new look? Cortex recommends keep-and-fix first.

## Not changing

Plan builder, procurement, invoicing, Xero sync, the send/accept flow, PP1/PP2 structure. Existing quotes are untouched; the engine changes apply to new quotes and to drafts on explicit regenerate.
