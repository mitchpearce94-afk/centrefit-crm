# Products & Supplier Offers — CONTEXT

> Locked 2026-07-06 with Mitchell ahead of the Seadan supplier switch (mass RFQ 2026-07-07).
> Every task in this build references a decision below.

## Problem

`quote_products` fuses product + supplier + cost into one row (412 rows, ~30 suppliers).
Switching suppliers means either overwriting rows (losing all other suppliers' pricing)
or duplicating products per supplier (catalogue explosion). Neither is acceptable.

## Decisions

**D1 — Split product from supplier offer.**
`quote_products` stays the canonical catalogue: one row per thing Centrefit installs/sells,
carrying all quote-engine wiring (device_type, scope_role, labour_code, asset_type_id,
markup, sell_price, Xero item, image). It does not grow when suppliers change.
New table `product_supplier_offers`: one row per (product × supplier) with the supplier's
own SKU, their item name, their cost price, cost_updated_at, is_preferred. Unique on
(product_id, supplier_id).

**D2 — Preferred offer drives the product's effective cost/supplier.**
`quote_products.supplier_id / supplier / cost_price / cost_updated_at` remain as a
denormalised mirror of the preferred offer, kept in sync by DB triggers (see D4). Quote
engine, dependency rules, BOM, procurement init and Xero item sync keep reading the
product row unchanged.

**D3 — Product SKU stays canonical.**
Xero Items and PO ItemCodes key off `quote_products.sku` (existing behaviour, don't churn
Xero). Supplier-specific SKUs/names live on the offer and surface on PO line descriptions
and printed order sheets so suppliers see their own part numbers.

**D4 — Sync is bidirectional via triggers, DB-level.**
- Offer set preferred / preferred offer's cost changed → mirror to product row (and unset
  other preferred offers for that product).
- Product row's supplier_id/cost_price written by any existing code path (product form,
  catalogue RFQ cost edits) → upsert that supplier's offer as preferred.
- `pg_trigger_depth()` guard stops recursion. DB-level so bulk SQL loads (Seadan import)
  stay consistent without app code.

**D5 — No automatic supplier fallback.** (Mitchell, 2026-07-06)
If the preferred supplier can't supply, substitution happens per job line in procurement
via `actual_supplier_id` — exactly as today. The catalogue never auto-flips suppliers.

**D6 — Procurement becomes offer-aware.**
PO generation and printed order sheets resolve each line against the
(product × actual_supplier) offer: that supplier's cost, SKU and item name. Fallback when
no offer exists: live catalogue cost, then quote-time snapshot (current behaviour).
Xero ItemCode stays the catalogue SKU per D3.

**D7 — Seadan load is a matching exercise.**
Seadan's RFQ list is matched against existing products (SKU / brand-model heuristics,
manual review for the rest); matches become offers, genuinely-new items become new
products. Mitchell reviews a summary before any preferred flips. Preferred switch to
Seadan is a single bulk action, per-product where a Seadan offer exists.

**D8 — RLS mirrors quote_products.** SELECT for all staff, writes admin-only.

## Out of scope (explicitly)

- Self-serve spreadsheet import UI (Claude does the first load; UI later if needed).
- Automatic supplier fallback of any kind (D5).
- Restructuring quote_line_items, POs, or the Xero item model.
