-- Split the combined `door_lock` device-type into `door_strike` and `mag_lock`.
-- The plan-builder, BOM engine, labour engine and scope-of-works all now reference
-- the two codes separately. Three things need to move in lockstep:
--
--   1. quote_products.device_type — so the BOM engine can find a default product
--      for each split code.
--   2. quote_dependency_rules.trigger_code — existing rules reference `door_lock`,
--      which no longer appears in any DeviceCounts. Re-point them at the new
--      codes so the same downstream products (door loop, FES20, REX) still fire.
--   3. A new rule wiring the Magnetic Lock SKU to the `mag_lock` trigger.
--
-- Mapping:
--   FSHFES20 (FES20 Striker)  -> door_strike (is_default = true)
--   LOXCCW30F (Magnetic Lock) -> mag_lock    (is_default = true)
--   Any other lingering door_lock products -> door_strike (safe default).
--   FES20 rule: trigger door_lock -> door_strike (mag locks don't get FES20)
--   Door loop + REX rules: trigger door_lock -> 'door_strike + mag_lock'
--   Security-cable compound rules: substring `door_lock` -> `door_strike + mag_lock`
--
-- Idempotent — re-running is a no-op (the second run sees the new codes already
-- in place and finds nothing to update; the dedicated mag-lock rule INSERT uses
-- a NOT EXISTS guard).

-- ── 1. Realign quote_products.device_type ──────────────────────────────────

update quote_products
set device_type = 'mag_lock', is_default = true
where sku = 'LOXCCW30F';

update quote_products
set device_type = 'door_strike', is_default = true
where sku = 'FSHFES20';

update quote_products
set device_type = 'door_strike'
where device_type = 'door_lock';

-- ── 2a. Repoint the FES20 striker rule (door_strike only — mag locks don't
--        get an electric striker) ──────────────────────────────────────────

update quote_dependency_rules
set trigger_code = 'door_strike'
where trigger_code = 'door_lock'
  and description ilike '%FES20%';

-- ── 2b. Repoint the Door Loop + REX rules (any access door — strike or mag) ─

update quote_dependency_rules
set trigger_code = 'door_strike + mag_lock'
where trigger_code = 'door_lock';

-- ── 2c. Compound security-cable rules embed `door_lock` mid-string ─────────

update quote_dependency_rules
set trigger_code = replace(trigger_code, 'door_lock', 'door_strike + mag_lock')
where trigger_code like '%door_lock%';

-- ── 3. Wire the Magnetic Lock product to the mag_lock trigger ──────────────
--      Guarded by NOT EXISTS so re-running doesn't create duplicates.

insert into quote_dependency_rules (
  preset, description, is_active, trigger_code, trigger_condition,
  trigger_value, quantity_mode, auto_add_product_id, is_universal
)
select
  'snap_fitness',
  'Magnetic lock per mag-lock door',
  true,
  'mag_lock',
  'greater_than',
  0,
  'match_trigger',
  qp.id,
  false
from quote_products qp
where qp.sku = 'LOXCCW30F'
  and not exists (
    select 1 from quote_dependency_rules r
    where r.auto_add_product_id = qp.id
      and r.trigger_code = 'mag_lock'
  );
