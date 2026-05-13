-- =============================================================================
-- Asset overhaul (2026-05-13)
-- =============================================================================
-- 1. Extend site_assets with network credential + extended fields so routers,
--    switches, WAPs, NVRs, etc. can store the operational data we actually
--    need (admin/staff passwords, firmware version, subnet, vlans, wifi
--    ssids). Each addition is nullable so existing rows are untouched.
-- 2. New asset_types table — admin-editable catalogue of asset templates
--    with boolean flags describing which extended fields apply per type.
--    Replaces the hardcoded DEVICE_TYPES list in site-assets-list.tsx.
-- 3. New site_key_info_photos table — server rack, alarm panel, etc.
--    Photos surface on the "Key Information" tab of the site detail page.
-- 4. Seed asset_types with the Centrefit-installed catalogue (routers,
--    switches, WAPs, NVRs, cameras + all security/access/duress/audio/AV
--    items in our standard install kit). Idempotent — slug is unique.
-- =============================================================================

-- 1. EXTEND site_assets ------------------------------------------------------

ALTER TABLE public.site_assets
  ADD COLUMN IF NOT EXISTS subnet TEXT,
  ADD COLUMN IF NOT EXISTS admin_user TEXT,
  ADD COLUMN IF NOT EXISTS admin_password TEXT,
  ADD COLUMN IF NOT EXISTS staff_user TEXT,
  ADD COLUMN IF NOT EXISTS staff_password TEXT,
  ADD COLUMN IF NOT EXISTS firmware TEXT,
  ADD COLUMN IF NOT EXISTS vlans JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS wifi_ssids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS asset_type_id UUID;

-- vlans: array of {name, id, notes}
-- wifi_ssids: array of {ssid, password, notes}

-- 2. ASSET TYPES -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.asset_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT,                        -- 'data' | 'security' | 'access' | 'cctv' | 'audio' | 'av' | 'duress' | 'other'
  default_manufacturer TEXT,
  has_serial BOOLEAN NOT NULL DEFAULT true,
  has_mac BOOLEAN NOT NULL DEFAULT false,
  has_ip BOOLEAN NOT NULL DEFAULT false,
  has_network_credentials BOOLEAN NOT NULL DEFAULT false,  -- admin user/password
  has_staff_credentials BOOLEAN NOT NULL DEFAULT false,    -- secondary user/password (NVR-style)
  has_firmware BOOLEAN NOT NULL DEFAULT false,
  has_vlans BOOLEAN NOT NULL DEFAULT false,
  has_wifi BOOLEAN NOT NULL DEFAULT false,
  is_key_info BOOLEAN NOT NULL DEFAULT false,              -- surface on Key Information tab
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_types_active ON public.asset_types(is_active);
CREATE INDEX IF NOT EXISTS idx_asset_types_category ON public.asset_types(category);

ALTER TABLE public.asset_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asset_types_select" ON public.asset_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "asset_types_admin_write" ON public.asset_types FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Link site_assets to asset_types (nullable so legacy free-text device_type stays valid)
ALTER TABLE public.site_assets
  ADD CONSTRAINT site_assets_asset_type_id_fkey
  FOREIGN KEY (asset_type_id) REFERENCES public.asset_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_site_assets_asset_type ON public.site_assets(asset_type_id);

-- 3. KEY INFO PHOTOS ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.site_key_info_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.customer_sites(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  caption TEXT,
  storage_path TEXT,
  uploaded_by UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_key_info_photos_site ON public.site_key_info_photos(site_id);

ALTER TABLE public.site_key_info_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "skip_select" ON public.site_key_info_photos FOR SELECT TO authenticated USING (true);
CREATE POLICY "skip_insert" ON public.site_key_info_photos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "skip_update" ON public.site_key_info_photos FOR UPDATE TO authenticated USING (true);
CREATE POLICY "skip_delete" ON public.site_key_info_photos FOR DELETE TO authenticated USING (true);

-- 4. SEED ASSET TYPES --------------------------------------------------------

INSERT INTO public.asset_types
  (slug, name, category, has_serial, has_mac, has_ip, has_network_credentials, has_staff_credentials, has_firmware, has_vlans, has_wifi, is_key_info, sort_order)
VALUES
  -- Data / Internet (key info)
  ('router',           'Router / Gateway',         'data',     true,  true,  true,  true,  false, true,  true,  true,  true, 10),
  ('wifi_controller',  'WiFi Controller',          'data',     true,  false, true,  true,  false, true,  false, false, true, 20),
  ('switch',           'Network Switch',           'data',     false, false, true,  true,  false, true,  false, false, true, 30),
  ('wap',              'Wi-Fi Access Point',       'data',     true,  true,  true,  true,  false, true,  false, false, true, 40),
  ('ups',              'UPS',                      'data',     true,  false, false, false, false, false, false, false, false, 50),
  ('comms_rack',       'Comms Rack / Cabinet',     'data',     false, false, false, false, false, false, false, false, false, 60),
  -- CCTV
  ('nvr',              'NVR',                      'cctv',     true,  true,  true,  true,  true,  true,  false, false, true, 70),
  ('camera',           'Camera',                   'cctv',     true,  true,  true,  false, false, false, false, false, false, 80),
  ('nvr_monitor',      'NVR Monitor',              'cctv',     true,  false, false, false, false, false, false, false, false, 81),
  ('storage_hdd',      '6TB Hard Drive',           'cctv',     true,  false, false, false, false, false, false, false, false, 82),
  -- Security
  ('alarm_panel',      'Alarm Panel',              'security', true,  false, false, false, false, false, false, false, false, 90),
  ('alarm_main_board', 'Alarm Main Board',         'security', true,  false, false, false, false, false, false, false, false, 91),
  ('myalarm_ip',       'MyAlarm IP Module',        'security', true,  false, false, false, false, false, false, false, false, 92),
  ('relay_expansion_4','4 Relay Expansion Board',  'security', true,  false, false, false, false, false, false, false, false, 93),
  ('zone_expansion',   '8-16 Zone Expansion Board','security', true,  false, false, false, false, false, false, false, false, 94),
  ('rf_receiver',      'RF Receiver',              'security', true,  false, false, false, false, false, false, false, false, 95),
  ('cf_connector_lg',  'CentreFit Large Connector Board','security', true, false, false, false, false, false, false, false, false, 96),
  ('cf_connector_sm',  'CentreFit Small Connector Board','security', true, false, false, false, false, false, false, false, false, 97),
  ('universal_monitor','Universal Monitoring Module','security', true, false, false, false, false, false, false, false, false, 98),
  ('motion_sensor',    'Motion Sensor',            'security', true,  false, false, false, false, false, false, false, false, 99),
  ('pir_ceiling_360',  'DS936 360 Ceiling Mount PIR','security', true, false, false, false, false, false, false, false, false, 100),
  ('pir_blueline_quad','PIR - Blue Line Gen2 Quad','security', true,  false, false, false, false, false, false, false, false, 101),
  ('reed_switch',      'Reed Switch',              'security', true,  false, false, false, false, false, false, false, false, 102),
  ('duress_pendant',   'Duress Pendant',           'security', true,  false, false, false, false, false, false, false, false, 103),
  ('duress_button',    'Duress Button',            'security', true,  false, false, false, false, false, false, false, false, 104),
  ('light_siren',      'Light & Siren',            'security', true,  false, false, false, false, false, false, false, false, 105),
  -- Duress
  ('sim_card',         'SIM Card',                 'duress',   true,  false, false, false, false, false, false, false, false, 110),
  ('duress_intercom',  'Duress Intercom',          'duress',   true,  false, false, false, false, false, false, false, false, 111),
  -- Access control
  ('door_controller',  'Door Controller',          'access',   true,  false, true,  false, false, false, false, false, false, 120),
  ('card_reader',      'Card Reader',              'access',   true,  false, false, false, false, false, false, false, false, 121),
  ('standalone_keypad','Standalone Keypad',        'access',   true,  false, false, false, false, false, false, false, false, 122),
  ('door_strike',      'Door Strike / Mag Lock',   'access',   true,  false, false, false, false, false, false, false, false, 123),
  ('rex_button',       'REX Button',               'access',   true,  false, false, false, false, false, false, false, false, 124),
  -- Audio
  ('amplifier',        'Amplifier',                'audio',    true,  false, false, false, false, false, false, false, false, 130),
  ('speaker',          'Speaker',                  'audio',    false, false, false, false, false, false, false, false, false, 131),
  -- AV / TV
  ('hdmi_modulator',   'HDMI - RF Modulator',      'av',       true,  false, false, false, false, false, false, false, false, 140),
  ('tv_display',       'TV / Display',             'av',       true,  false, false, false, false, false, false, false, false, 141),
  ('tv_mount',         'TV Mount',                 'av',       false, false, false, false, false, false, false, false, false, 142),
  -- Other
  ('tailgate_system',  'Tailgate System',          'other',    true,  false, false, false, false, false, false, false, false, 200),
  ('cardio_distrib',   'Cardio Distribution',      'other',    true,  false, false, false, false, false, false, false, false, 201),
  ('nightlife_comp',   'Nightlife Component',      'other',    true,  false, false, false, false, false, false, false, false, 202),
  ('other',            'Other',                    'other',    false, false, false, false, false, false, false, false, false, 999)
ON CONFLICT (slug) DO NOTHING;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public._touch_asset_types_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_asset_types_updated_at ON public.asset_types;
CREATE TRIGGER trg_asset_types_updated_at
  BEFORE UPDATE ON public.asset_types
  FOR EACH ROW EXECUTE FUNCTION public._touch_asset_types_updated_at();
