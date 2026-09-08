-- Product catalogue tagging sweep — DO NOT RUN until Mitchell approves the proposal.
-- Generated 2026-07-13. Idempotent: safe to re-run.

-- ============ 1. NEW ASSET TYPES ============
insert into asset_types (name, slug, category, has_serial, has_mac, has_ip, has_wifi, has_rfid, sort_order)
select v.* from (values
  ('Intercom',              'intercom',           'access',   true,  true,  true,  false, false, 125),
  ('Alarm Communicator',    'alarm_communicator', 'security', true,  false, false, false, false, 92),
  ('VoIP Phone',            'voip_phone',         'data',     true,  true,  true,  false, false, 55),
  ('Turnstile / Speed Gate','turnstile',          'access',   true,  false, true,  false, false, 126),
  ('Signage / Media Player','signage_player',     'av',       true,  true,  true,  false, false, 143)
) as v(name, slug, category, has_serial, has_mac, has_ip, has_wifi, has_rfid, sort_order)
where not exists (select 1 from asset_types t where t.slug = v.slug);

-- ============ 2. TAGS TO EXISTING TYPES ============
-- Camera
update quote_products set asset_type_id = (select id from asset_types where slug='camera')
where id in ('25d4aa9c-52a0-4ddb-897a-345ca18189e9');

-- NVR
update quote_products set asset_type_id = (select id from asset_types where slug='nvr')
where id in ('f8e73407-ad4f-45d1-8f78-57fa46f023ec','90629a1f-060b-46e6-a7b7-7476bf2ff76c','ab4c63f1-b806-4d10-b817-85fc40bf48ae');

-- Hard Drive
update quote_products set asset_type_id = (select id from asset_types where slug='hard_drive')
where id in ('bdf066e2-6604-4096-9595-c7f5989d264a','57e97b76-7122-4190-aba9-46d2abc8f200','ef683464-ea74-42f4-aa5a-5e0f93f296ef','926e9568-b7ae-474f-8f56-e0459b56734d','9d3c82db-eb42-4624-a12c-33e50f166c07','58222329-c921-4c99-89ce-028fdc4c9d0a','bc3df372-3a45-4a57-ad3c-0c93659dd351','59e4373a-584e-46c3-8c10-916c75a859a8');

-- NVR Monitor
update quote_products set asset_type_id = (select id from asset_types where slug='nvr_monitor')
where id in ('a6bcca7c-4f6f-46d0-bfec-afc48a402006');

-- TV / Display
update quote_products set asset_type_id = (select id from asset_types where slug='tv_display')
where id in ('ec4c01ee-bf30-4b6b-8348-7c1935f600c7','806c0c43-1f2f-49f4-898c-3d46ea003c3c','3341cadb-6fb1-44a7-96a6-a10b8c344654','bf0b3e83-eee6-42ee-84cf-bef0c70eaa95','25ac31e9-d9f6-4b7b-be7f-beb85997dcef','f5d71750-6f9e-4532-8a45-0cfc16d40d57','55b358b7-5c4a-4fdb-8780-1d9292ab9509');

-- Router / Gateway
update quote_products set asset_type_id = (select id from asset_types where slug='router')
where id in ('1ee85a10-37bc-43ab-beb4-47c6c50961dc','06827961-2677-4ff2-bb53-e1a13a4885e3','57cd463b-f9af-40f4-bd03-db1a48fa3249','04576a61-220e-4b65-a036-e38bc514f0f4','03b767f9-de49-4b83-9710-08b954b2d657','23fb83ce-db80-4376-b994-47510e64416a','53eff5be-cbe5-43b4-b67e-ff9e37a21699');

-- WAP Controller
update quote_products set asset_type_id = (select id from asset_types where slug='wifi_controller')
where id in ('8917cd1d-2ddd-4654-bf3e-6cae00a010dd');

-- Network Switch
update quote_products set asset_type_id = (select id from asset_types where slug='switch')
where id in ('b94a81f4-c1e2-41ae-9ec1-9d3e6d633a42');

-- UPS
update quote_products set asset_type_id = (select id from asset_types where slug='ups')
where id in ('833a893b-6e0c-4078-8947-1e76228e8351','afc3b5bd-3d03-41c5-a80c-47e5a2114037','b7684d2d-ea73-4674-a8a7-c4446d5ff389','9a448aed-e429-4e25-8b93-c4d3a2c4057f','ef314de0-efec-4ae0-bc72-ef72b7e9041c','91b72173-8925-4846-9c0c-888c660fba42');

-- Comms Rack / Cabinet (classification only — not trackable, won't import)
update quote_products set asset_type_id = (select id from asset_types where slug='comms_rack')
where id in ('0543ca70-3a8a-43ff-9d95-da228f0ea080','c01828d8-74d5-44fc-b11f-9cb2994d0da9','47956850-62f6-48ee-a5f4-67d8ef4315a2','1ce58df4-1263-4c3a-9870-b2f05d088a53','5b9ffec8-efb4-4d97-9433-11afed052036','fff02c67-5ff8-43c3-b60c-60d79675b726');

-- Card Reader (incl. biometric readers)
update quote_products set asset_type_id = (select id from asset_types where slug='card_reader')
where id in ('768f83a2-84db-4db3-89e8-b0df916dcc6f','60ebcf0d-9294-4b44-bbc9-f5b8db371b44','1e155e7d-f0af-496f-a4d8-6556c665a48c','a2c67914-4d27-42b4-abeb-a87b4281121b','2ed75fb4-3672-4d35-98c3-6ba33786479c','57c71c93-4189-448f-b181-c2654255e23e','d8cf93a8-6a50-4032-99d9-d7d72d094445','6e00449f-9bf4-496c-8470-cc20103c5561','dc37f0ea-3054-4e6c-8fa4-877f0903e1ad');

-- Door Controller
update quote_products set asset_type_id = (select id from asset_types where slug='door_controller')
where id in ('3684250a-39a2-4829-9ea4-58253fb32299','f241444e-6552-46da-957c-bed00807e2c7','642716fa-f688-4be9-a72d-1714c947f027','94b7a193-03a6-4c16-a8f7-fa9a8b32040c','51e9c484-ee98-45e9-a6a3-a92eed46357b','e2ffe149-d671-4bfb-8432-39cdab5ef07c','3c16f2c9-caf0-4301-8e1b-14ee8a00c858','442eaaf8-f4bd-4dc6-9ada-4fd1dd17511f','20e26b42-f542-46a1-aed8-6b58e3fc39fe','ac6d9ddb-3ad4-4ef5-a592-5dfe94a2b3b9');

-- Standalone Keypad
update quote_products set asset_type_id = (select id from asset_types where slug='standalone_keypad')
where id in ('0294fa6e-fadb-49e1-866c-ad0dfd0e9f5c');

-- REX Button
update quote_products set asset_type_id = (select id from asset_types where slug='rex_button')
where id in ('8af66e72-15d1-4de2-afec-06b9f3cfb2ee','ea26728b-f50a-46f0-9995-12a4c5c4e0e1');

-- Alarm Panel
update quote_products set asset_type_id = (select id from asset_types where slug='alarm_panel')
where id in ('822b78d9-21dc-467a-8c6f-1947f6c1b341','167c4f9e-fce2-4122-8995-d8a312011d6e','b494fecd-dc0f-4826-aa89-e887be37f886');

-- Reed Switch
update quote_products set asset_type_id = (select id from asset_types where slug='reed_switch')
where id in ('987f7ef8-b496-4338-9632-c80da976ea94','80439a46-5782-4c7c-97bf-0696b381051d');

-- Light & Siren
update quote_products set asset_type_id = (select id from asset_types where slug='light_siren')
where id in ('f3c46637-98e9-4716-9dea-940fcbe910d4','171d3d55-2710-4cf3-9ba0-98678c97ca67','c5979c98-4d9f-46aa-b122-f89c12cece07');

-- DS936 360 Ceiling Mount PIR
update quote_products set asset_type_id = (select id from asset_types where slug='pir_ceiling_360')
where id in ('87a31d07-44c3-4405-9c33-84655fbc9048','335e41b9-e3a3-415b-a13f-ce003d5aa884','1cb1f436-8ba7-4a3c-89c3-8442b2a9f8f1');

-- Duress Button (WEL2210R-DURE carried the duress_button slug)
update quote_products set asset_type_id = (select id from asset_types where slug='duress_button')
where id in ('bd76488e-645d-4bbd-b324-6fe46d796c2d');

-- Duress Intercom
update quote_products set asset_type_id = (select id from asset_types where slug='duress_intercom')
where id in ('a2a3677b-5340-425e-9461-fbd9b5b1e6b4');

-- CentreFit Large / Small Connector Boards
update quote_products set asset_type_id = (select id from asset_types where slug='cf_connector_lg')
where id in ('a6428d56-054c-4254-ac9c-7d046b6f8776');
update quote_products set asset_type_id = (select id from asset_types where slug='cf_connector_sm')
where id in ('1bafb3f8-bfd0-499c-9b08-e562d56b3940');

-- SIM Card
update quote_products set asset_type_id = (select id from asset_types where slug='sim_card')
where id in ('f8d5d99c-050c-4ae1-b782-c20bedba3097','405144de-d918-40f1-acaf-304bebdc4a62','0385e39b-a531-425f-b9e4-1b0655271d9e');

-- Amplifier
update quote_products set asset_type_id = (select id from asset_types where slug='amplifier')
where id in ('de6962ca-a62c-45e8-9ac5-6d0d68020cc5','22d36185-e6d9-492b-8344-90a527a99270');

-- Nightlife Component
update quote_products set asset_type_id = (select id from asset_types where slug='nightlife_comp')
where id in ('3f2a7a23-968a-44dc-83a6-29d8324d8ffb','2e898bb5-185a-4145-8f8b-10ead5723bb6');

-- Speaker (classification only — not trackable, won't import)
update quote_products set asset_type_id = (select id from asset_types where slug='speaker')
where id in ('e50e2bcd-6407-46e7-9f7a-cd552022ab06','84e3f351-f470-474a-aa2b-d07a4e2f4ff8','20eb6de2-3f31-49b9-ac0f-93a15baf160d','6d3f7b7e-6fb5-40e8-9185-af130e0c538f','d2f9846e-805b-4e1d-9cd3-1e19dbccbc5e','2d42c995-2982-4d80-a50e-3b76d8335afb','fd7835c3-4758-42cc-b76f-b872a8f03d02');

-- ============ 3. TAGS TO NEW TYPES ============
-- Intercom
update quote_products set asset_type_id = (select id from asset_types where slug='intercom')
where id in ('1a11bfec-133e-46eb-93c6-64055465c40d','266d5259-3842-445c-9082-cba7dd8daa84','23c99cdb-1c3a-4dbb-8d44-241c19ed3b4b','295f6966-6136-4e75-84d1-eb249d6a7b7a','d33736e3-6b7b-4569-982b-03e6fad5888b','570f633e-ed60-438f-a3ce-b8e1cfbd5185');

-- Alarm Communicator
update quote_products set asset_type_id = (select id from asset_types where slug='alarm_communicator')
where id in ('a6e97049-f394-4554-9a18-82ef72f4adf3','87dd1b9f-522d-4f8e-be50-dfa6ec4d124c','146320da-08b7-461f-a6d1-6aabb05e3b5d','3daed9fe-4c6a-4397-923a-26f2ed0ee06e','95a44d01-a83c-4578-a93c-8dff231fc775','9f06c00c-d214-4865-a000-e8a2c2d12fdd');

-- VoIP Phone
update quote_products set asset_type_id = (select id from asset_types where slug='voip_phone')
where id in ('68577775-d302-446c-b8f7-ca6e41c16eae','57355b24-9ac8-4adb-896b-030929e8b141','30ae0691-4d67-478c-869b-59562889ee94','3b488d1b-f7b6-4594-afce-7bfc8445e35f','ee0c88d6-a9b2-464d-b966-4457ee7289e2');

-- Turnstile / Speed Gate
update quote_products set asset_type_id = (select id from asset_types where slug='turnstile')
where id in ('556326de-4cd5-4ac9-a99d-44eba0a835aa','9681c1fd-e9d9-4fb7-b975-b2d95016eb31');

-- Signage / Media Player
update quote_products set asset_type_id = (select id from asset_types where slug='signage_player')
where id in ('430249b1-5ff5-454b-8069-3c9e757d3929');

-- ============ 4. EVERYTHING ELSE -> Other (reviewed consumable) ============
-- Excludes the borderline items below, which stay untagged so they warn on
-- import until Mitchell decides.
update quote_products set asset_type_id = (select id from asset_types where slug='other')
where asset_type_id is null
  and coalesce(is_active, true)
  and id not in (
    'a5f5d3fd-5780-48c4-9942-b033ed401b0a', -- Emergency Door Release GIACP32W
    '9b9f9444-e17a-4bf3-b6b3-a977e472a965', -- Secor resettable EDR w/ LED+piezo
    '4e676ff0-1da1-4036-882d-655db0d2c40d', -- HID Access Control Middle Board (Lift Brands) CFLB2025
    '969a666f-2f6e-457f-a9bb-7910116cbbed', -- Centrefit 12V 4 Relay Cloud Switch
    '9ffec10a-8601-4a2b-85fe-b4ec301a51e5', -- Centrefit 240V 4 Relay Cloud Switch
    '4243052c-e910-4c8e-b462-0a12825d6ff3', -- WiiM Pro AirPlay receiver
    'f3b8cb5b-4f68-4525-be86-7eab22b1ca5c', -- MT-VIKI 4K HDMI matrix
    '6fdd0b89-34e6-4a3d-b04e-6d4d63f9332f', -- Laser 10in Android tablet
    '2f744f6e-6b18-4bc4-aebb-7d3d1c7aff87', -- VESTA wireless shock sensor
    'b19df2ae-0999-4722-af69-d636fa729749', -- BOSCH CM435B power terminal expansion
    'd6066123-5ba9-4e40-831d-5dad46a19243'  -- 5 Port Ethernet Switch Module
  );

-- ============ 5. VERIFY ============
select count(*) filter (where asset_type_id is not null) as tagged,
       count(*) filter (where asset_type_id is null) as still_untagged
from quote_products where coalesce(is_active, true);
-- Expect still_untagged = 11 (the borderline items).
