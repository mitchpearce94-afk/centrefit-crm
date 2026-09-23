-- Quoting v2 phase 1 (docs/quoting-v2-CONTEXT.md D1, D3, D5). Applied via Supabase MCP 2026-09-23.
-- Kits live on products (additive); device types become data; lint overrides are recorded on the quote.

-- D3: device types as data. Seeded from the code constant + the plan-builder codes that never had a home.
create table if not exists public.quote_device_types (
  code text primary key,
  legend text not null,
  category text,
  default_scope_role text,
  labour_code text,
  has_hardware boolean not null default true,   -- false = labour/cable only (data points, integration cables)
  count_only boolean not null default false,    -- counted on the plan for rules/labour, never a BOM line
  sort_order int not null default 100,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Per-template supply: who supplies a device type on this franchise's jobs (Snap: readers are customer-supplied).
create table if not exists public.quote_template_device_supply (
  template_id uuid not null references public.quote_rule_templates(id) on delete cascade,
  device_type text not null references public.quote_device_types(code) on delete cascade,
  supplied_by text not null check (supplied_by in ('centrefit','customer')),
  note text,
  primary key (template_id, device_type)
);

-- D1: additive kits. "Quoting X requires these components." Approved rows expand in the BOM; proposed rows wait for Mitchell.
create table if not exists public.product_kit_components (
  id uuid primary key default gen_random_uuid(),
  kit_product_id uuid not null references public.quote_products(id) on delete cascade,
  component_product_id uuid not null references public.quote_products(id) on delete cascade,
  qty_mode text not null default 'per_unit' check (qty_mode in ('per_unit','fixed','per_n','formula','per_device_type')),
  qty_value numeric not null default 1,        -- per_unit: qty × kit qty · fixed: qty once · per_n: CEIL(kit qty / qty_per) × qty_value
  qty_per numeric,                             -- per_n divisor
  qty_formula text,                            -- formula: JS-safe expression over {qty, cameras, doors, detectors, sqm, retention_days, tv_count, cardio_count}
  qty_device_type text references public.quote_device_types(code), -- per_device_type: qty_value × count of that device type on the quote
  requirement text not null default 'required' check (requirement in ('required','optional','ask')),
  ask_prompt text,                             -- for 'ask': the question shown in the wizard
  status text not null default 'proposed' check (status in ('proposed','approved','rejected')),
  source text not null default 'manual' check (source in ('manual','rule_migration','gap_inbox')),
  source_rule_id uuid,
  notes text,
  sort_order int not null default 100,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists product_kit_components_unique_idx on public.product_kit_components (kit_product_id, component_product_id, qty_mode, coalesce(qty_device_type,''));
create index if not exists product_kit_components_kit_idx on public.product_kit_components (kit_product_id, status);

-- D5: lint findings the operator overrode, with a reason. Audited on the quote.
alter table public.quotes add column if not exists lint_findings jsonb;
alter table public.quotes add column if not exists lint_overrides jsonb;
alter table public.quotes add column if not exists lint_checked_at timestamptz;

-- Kit UI helpers on the catalogue
alter table public.quote_products add column if not exists is_kit boolean not null default false;
alter table public.quote_products add column if not exists customer_supplied boolean not null default false;

-- RLS mirrors quote_products (D8 of products-CONTEXT): everyone reads, admins write.
alter table public.quote_device_types enable row level security;
alter table public.quote_template_device_supply enable row level security;
alter table public.product_kit_components enable row level security;
do $$
declare t text;
begin
  foreach t in array array['quote_device_types','quote_template_device_supply','product_kit_components'] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_admin_write on public.%I', t, t);
    execute format('create policy %I_admin_write on public.%I for all to authenticated using (exists (select 1 from public.staff s where s.id = auth.uid() and s.role = ''admin'' and s.is_active)) with check (exists (select 1 from public.staff s where s.id = auth.uid() and s.role = ''admin'' and s.is_active))', t, t);
  end loop;
end $$;

-- Seed device types: the 28 from constants.ts + the orphans the plan builder emits.
insert into public.quote_device_types (code, legend, category, default_scope_role, labour_code, has_hardware, count_only, sort_order) values
 ('alarm_panel','Alarm Panel','Security System','alarm_panel',null,true,false,10),
 ('alarm_keypad','Alarm Keypad','Security System','alarm_panel','alarm_keypad',true,false,11),
 ('pir_360_roof','PIR 360° Ceiling','Security System','motion_sensor','pir_360_roof',true,false,12),
 ('pir_wall','PIR Wall','Security System','motion_sensor','pir_wall',true,false,13),
 ('reed_switch','Reed Switch','Security System','reed_switch','reed_switch',true,false,14),
 ('duress_button','Duress Button','Security System','duress_button','duress_button',true,false,15),
 ('duress_intercom','Duress Intercom','Security System','duress_intercom','duress_intercom',true,false,16),
 ('duress_pendant','Duress Pendant','Security System','duress_pendant',null,true,false,17),
 ('rf_receiver','RF Receiver','Security System','rf_receiver','rf_receiver',true,false,18),
 ('light_siren','Light & Siren','Security System','light_siren','light_siren',true,false,19),
 ('siren_piezo','Piezo Siren','Security System','light_siren',null,true,false,20),
 ('break_glass','Break Glass','Access Control','emergency_door_release',null,true,false,30),
 ('door_strike','Door Strike','Access Control','door_strike','door_lock',true,false,31),
 ('mag_lock','Mag Lock','Access Control','mag_lock','door_lock',true,false,32),
 ('door_lock','Door Lock','Access Control','door_strike','door_lock',true,false,33),
 ('rex_button','REX Button','Access Control','rex_button','rex_button',true,false,34),
 ('card_reader','Card Reader','Access Control','card_reader','card_reader',true,false,35),
 ('bio_access','Biometric Reader','Access Control','card_reader','card_reader',true,false,36),
 ('tailgate_system','Tailgate System','Access Control','tailgate_system','tailgate_system',true,false,37),
 ('camera_white','Camera (white)','Digital Surveillance','camera','camera_plaster',true,false,40),
 ('camera_black','Camera (black)','Digital Surveillance','camera','camera_plaster',true,false,41),
 ('wap','Wi-Fi Access Point','Data System','wap','wap',true,false,50),
 ('data_point','Data Point (cable run)','Data System','cabling','data_point',false,false,51),
 ('coax_point','Coax Point (cable run)','AV System','cabling','coax_point',false,false,52),
 ('integration_cable','Integration Cable','Data System','cabling','integration_cable',false,false,53),
 ('cabinet_9ru','Cabinet 9RU','Data System','cabinet',null,true,false,60),
 ('cabinet_27ru','Cabinet 27RU','Data System','cabinet',null,true,false,61),
 ('cabinet_32ru','Cabinet 32RU','Data System','cabinet',null,true,false,62),
 ('cabinet_42ru','Cabinet 42RU','Data System','cabinet',null,true,false,63),
 ('speaker_roof_white','Ceiling Speaker (white)','AV System','speaker','speaker_roof',true,false,70),
 ('speaker_roof_black','Ceiling Speaker (black)','AV System','speaker','speaker_roof',true,false,71),
 ('speaker_wall_white','Wall Speaker (white)','AV System','speaker','speaker_wall',true,false,72),
 ('speaker_wall_black','Wall Speaker (black)','AV System','speaker','speaker_wall',true,false,73),
 ('intercom_master','Intercom Master','Security System','video_intercom','intercom_master',true,false,80),
 ('intercom_slave','Intercom Slave','Security System','video_intercom','intercom_slave',true,false,81),
 ('volume_control','Volume Control','AV System','volume_control','volume_control',true,false,74)
on conflict (code) do nothing;

-- Locked answers 23 Sep: Snap readers are customer-supplied; PF readers/controllers are Centrefit (Veyla).
insert into public.quote_template_device_supply (template_id, device_type, supplied_by, note)
select t.id, 'card_reader', 'customer', 'Snap supplies its own readers — labour + cabling only (Mitchell 23 Sep 2026)'
from public.quote_rule_templates t where t.slug = 'snap_fitness'
on conflict do nothing;
insert into public.quote_template_device_supply (template_id, device_type, supplied_by, note)
select t.id, 'card_reader', 'centrefit', 'Veyla readers + controllers supplied by Centrefit (Mitchell 23 Sep 2026)'
from public.quote_rule_templates t where t.slug = 'planet_fitness'
on conflict do nothing;
