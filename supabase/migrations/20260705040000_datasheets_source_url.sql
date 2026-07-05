-- Web-link datasheet entries (Mitchell 2026-07-05): products whose
-- manufacturer no longer publishes PDFs (the Ubiquiti fleet) link to the
-- canonical techspecs page instead of a stored file. storage_path becomes
-- nullable; the handover TOC hyperlinks source_url when there's no PDF.
alter table datasheets alter column storage_path drop not null;
alter table datasheets add column if not exists source_url text;
alter table datasheets drop constraint datasheets_source_check;
alter table datasheets add constraint datasheets_source_check
  check (source = any (array['upload'::text, 'url'::text, 'web'::text]));

insert into datasheets (manufacturer, model, product_name, match_models, storage_path, source_url, source, notes)
values
  ('Ubiquiti', 'UCG-Fiber', 'UniFi Cloud Gateway Fiber', array['UCG-Fiber','UCG Fiber'], null, 'https://techspecs.ui.com/unifi/cloud-gateways/ucg-fiber', 'web', 'Ubiquiti publishes specs on techspecs.ui.com only'),
  ('Ubiquiti', 'U7 Pro', 'UniFi WiFi 7 Access Point', array['U7 Pro','U7-Pro'], null, 'https://techspecs.ui.com/unifi/wifi/u7-pro', 'web', 'Ubiquiti publishes specs on techspecs.ui.com only'),
  ('Ubiquiti', 'USW-48-PoE', 'UniFi 48-port PoE Switch', array['USW-48-PoE','USW 48 PoE'], null, 'https://techspecs.ui.com/unifi/switching/usw-48-poe', 'web', 'Ubiquiti publishes specs on techspecs.ui.com only'),
  ('Ubiquiti', 'USW-Pro-Max-48-PoE', 'UniFi Pro Max 48 PoE Switch', array['USW-Pro-Max-48-PoE','USW Pro Max 48 PoE'], null, 'https://techspecs.ui.com/unifi/switching/usw-pro-max-48-poe', 'web', 'Ubiquiti publishes specs on techspecs.ui.com only')
on conflict (model) do update set source_url = excluded.source_url;
