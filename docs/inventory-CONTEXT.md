# Inventory — CONTEXT

Locked 2026-09-08 (Mitchell's brief, decisions taken by Cortex while he was in transit — flagged in the session recap; change any of them and the build follows).

## Brief (Mitchell)

> Allow us to add our own products to the inventory, and when something is marked in stock from procurement, removes it from the live inventory tracking. And then once it gets to a certain number (selectable in the setting on the stock) a QTY in which it notifies someone (add a notification alert) for reorder.

## Decisions

**D1 — One catalogue, not two.** Inventory tracks rows of `quote_products`. No parallel "parts" catalogue (the dead `public.parts` table from the Tradify import stays unused). A stock item = a `quote_products` row you have chosen to track.

**D2 — Tracking is opt-in per product.** `inventory_items` has one row per tracked product (`product_id` unique). Untracked products are unaffected everywhere. Adding a product to inventory = "start tracking" with an opening balance.

**D3 — Stock moves through an append-only ledger.** `inventory_movements` records every change (delta, qty after, reason, who, which job/procurement row). `inventory_items.qty_on_hand` is the running balance maintained by `inventory_apply_movement()`. Never UPDATE qty_on_hand directly.

**D4 — Procurement "In Stock" is the decrement.** A DB trigger on `job_procurement_items` calls the movement function:
- row enters `in_stock` → `−quantity` (`job_allocation`)
- row leaves `in_stock` for anything other than `received` (undo → pending/order) → `+quantity` (`job_release`)
- quantity edited while `in_stock` → the difference
- `in_stock` → `received` is the natural completion: **no** movement (the stock was already consumed)
- `in_stock` row deleted → `+quantity`
Untracked products are a no-op. The trigger is the single source of truth so every code path (PATCH, split, undo, delete) is covered without app code.

**D5 — Receipts do NOT add stock automatically.** Ordered items are for a job, not the shelf. Stock comes in via the Inventory page ("Received stock", "Stock take", "Returned from job", "Adjustment"). Revisit if Mitchell wants a "receive to stock" path from POs.

**D6 — Reorder point per item, alert once per low episode.** `reorder_point` (nullable = no alert) and optional `reorder_qty` live on the item. When `qty_on_hand <= reorder_point` a `inventory.low_stock` notification (bell + email) goes to **admins**, plus an optional nominated `alert_staff_id` on the item. `low_stock_alerted_at` stops repeats; it clears automatically when stock rises back above the point, so the next dip alerts again. Fired immediately from the routes that move stock, and swept daily by `/api/cron/inventory-low-stock` (7am Brisbane, weekdays) as a safety net.

**D7 — Permissions.** New flags `inventory.view` and `inventory.manage`. Defaults: admin + project_manager both; finance_manager and field_staff view only. Page gate in `inventory/layout.tsx`; mutation routes check `inventory.manage`; writes run on the service role after that check (same pattern as notifications).

**D8 — Xero stays untracked.** Xero Items remain `isTrackedAsInventory: false`. This module is operational stock control, not accounting inventory. Flipping Xero changes COGS posting and is a separate finance decision.

## Not in scope (yet)
- Multiple locations / bins (one `location` text per item for now).
- Receive-to-stock from Xero POs (D5).
- Barcode scanning on the Inventory page.
- Stock valuation reports (cost × on hand) — trivial to add later from the ledger.

## Where things live
- Migration: `inventory_module` (applied via Supabase MCP, 2026-09-08).
- Ledger + trigger: `inventory_apply_movement()`, `inventory_on_procurement_change()`.
- Alerting: `src/lib/inventory/low-stock.ts` (`checkLowStock`).
- Routes: `src/app/api/inventory/*`, cron `src/app/api/cron/inventory-low-stock`.
- UI: `src/app/(dashboard)/inventory/*` (sidebar + mobile nav entries gated on the flags).
- Procurement: `/api/procurement-items/[id]` PATCH returns the new on-hand so the "In Stock" click toasts "N left on hand".
