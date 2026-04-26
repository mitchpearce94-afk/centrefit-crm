// One-off: classify every active product and assign scope_role + labour_code
// based on name + category heuristics. Falls back to 'none' for both when
// nothing matches confidently. Mitchell will eyeball + correct after.
//
// Run: SUPABASE_SERVICE_ROLE_KEY=... node scripts/autotag-products.mjs
// Use DRY_RUN=1 to preview without writing.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zybdcnlcqncbxjrthtgy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === '1';

if (!SUPABASE_KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY env var');
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Classification rules ─────────────────────────────────────────────────
//
// Each rule is { test: (product) => boolean, scope_role, labour_code }.
// Rules are evaluated top-to-bottom, first match wins. Order matters: more
// specific rules first.

const has = (s, ...kw) => kw.some(k => s.toLowerCase().includes(k.toLowerCase()));
const cat = (c, ...names) => names.includes(c);

const RULES = [
  // ── Cabling FIRST (so "speaker cable" doesn't match speaker rule) ─────
  { test: (p) => has(p.name, 'cat6', 'cat 6', 'cat5e', 'rj45', 'patch lead', 'patch cable', 'utp cable', 'data cable', 'cable reel'), scope_role: 'cabling', labour_code: 'none' },
  { test: (p) => has(p.name, 'speaker cable', 'audio cable', 'rca cable', 'hdmi cable', 'coaxial', 'coax cable', 'rg6', 'rg59', 'cable - ', 'cable—', ' lead', 'fly lead'), scope_role: 'cabling', labour_code: 'none' },
  { test: (p) => has(p.name, 'patch panel'), scope_role: 'cabling', labour_code: 'none' },
  { test: (p) => has(p.name, 'data outlet', 'rj45 outlet'), scope_role: 'cabling', labour_code: 'data_point' },
  { test: (p) => has(p.name, 'data point') && !has(p.name, 'plate'), scope_role: 'cabling', labour_code: 'data_point' },

  // ── Power supplies, batteries, accessories (early so they don't fall through) ─
  { test: (p) => has(p.name, 'power supply', 'switchmode', 'plugpack', 'plug pack', 'plug top', 'mains adaptor', 'mains adapter', 'psu '), scope_role: 'none', labour_code: 'none' },
  { test: (p) => has(p.name, 'sla battery', 'security battery', 'standby battery', '12v 7ah', '12v 12ah'), scope_role: 'none', labour_code: 'none' },
  { test: (p) => /\bbattery\b/i.test(p.name) && !has(p.name, 'tester'), scope_role: 'none', labour_code: 'none' },
  { test: (p) => has(p.name, 'faceplate', 'wall plate', 'screw terminal'), scope_role: 'none', labour_code: 'none' },
  { test: (p) => has(p.name, 'splitter', 'rca female', 'rca male', 'adapter 3 pin'), scope_role: 'none', labour_code: 'none' },

  // ── Tailgate ──────────────────────────────────────────────────────────
  { test: (p) => has(p.name, 'felixgate', 'tailgat'), scope_role: 'tailgate_system', labour_code: 'tailgate_system' },

  // ── Speakers (BEFORE monitor — products with "Australian Monitor" brand are speakers) ─
  { test: (p) => has(p.name, 'ceiling speaker', 'roof speaker') || (has(p.name, 'speaker') && has(p.name, 'ceiling')), scope_role: 'speaker', labour_code: 'speaker_roof' },
  { test: (p) => (has(p.name, 'wall speaker') || (has(p.name, 'speaker') && has(p.name, 'wall'))) && !has(p.name, 'mount only'), scope_role: 'speaker', labour_code: 'speaker_wall' },
  { test: (p) => has(p.name, 'speaker pair', 'passive indoor', '100v speaker', 'pa speaker'), scope_role: 'speaker', labour_code: 'speaker_roof' },
  { test: (p) => has(p.name, 'speaker') && !has(p.name, 'amplifier'), scope_role: 'speaker', labour_code: 'speaker_roof' },
  { test: (p) => has(p.name, 'amplifier', 'mixer-amp', 'mixer amp', '100v amp'), scope_role: 'amplifier', labour_code: 'none' },
  { test: (p) => has(p.name, 'volume control', 'attenuator'), scope_role: 'volume_control', labour_code: 'none' },
  { test: (p) => has(p.name, 'audio streamer', 'music streamer', 'soundtrack', 'wiim ', 'sonos '), scope_role: 'audio_streamer', labour_code: 'none' },

  // ── TV / cardio mounts (BEFORE monitor) ───────────────────────────────
  { test: (p) => (has(p.name, 'tv mount', 'tv bracket', 'monitor mount', 'wall mount', 'articulated wall mount')) && (has(p.name, 'wall')), scope_role: 'tv_mount_wall', labour_code: 'none' },
  { test: (p) => (has(p.name, 'tv mount', 'tv bracket', 'monitor mount', 'lcd ceiling mount', 'ceiling mount')) && has(p.name, 'ceiling'), scope_role: 'tv_mount_ceiling', labour_code: 'none' },
  { test: (p) => has(p.name, 'tv mount', 'tv bracket', 'tv arm'), scope_role: 'tv_mount_wall', labour_code: 'none' },

  // ── Cameras (BEFORE monitor) ──────────────────────────────────────────
  { test: (p) => has(p.name, 'camera mount', 'camera bracket', 'pole mount', 'corner mount', 'pendant mount'), scope_role: 'camera_mount', labour_code: 'none' },
  { test: (p) => has(p.name, 'camera') && cat(p.category, 'Digital Surveillance'), scope_role: 'camera', labour_code: 'camera_plaster' },
  { test: (p) => has(p.name, 'ip camera', 'turret', 'eyeball', 'bullet camera', 'dome camera', 'ptz', 'fisheye'), scope_role: 'camera', labour_code: 'camera_plaster' },

  // ── NVR / TVs / monitors / HDDs ───────────────────────────────────────
  { test: (p) => has(p.name, 'nvr', 'network video recorder'), scope_role: 'nvr', labour_code: 'none' },
  { test: (p) => has(p.name, 'tv ', 'television', 'chiq', 'samsung uhd'), scope_role: 'monitor', labour_code: 'none' },
  { test: (p) => has(p.name, 'monitor 24/7', 'fhd led monitor', 'lcd monitor', 'led monitor', 'cctv monitor', '32" 1920'), scope_role: 'monitor', labour_code: 'none' },
  { test: (p) => has(p.name, 'hdd', 'hard drive', 'wd60', 'wd101', 'wd84', 'surveillance hdd', 'purple pro'), scope_role: 'hdd', labour_code: 'none' },

  // ── Access control specifics ───────────────────────────────────────────
  { test: (p) => has(p.name, 'biometric', 'fingerprint'), scope_role: 'card_reader', labour_code: 'card_reader' },
  { test: (p) => has(p.name, 'card reader', 'prox reader', 'mifare reader', 'nfc reader'), scope_role: 'card_reader', labour_code: 'card_reader' },
  { test: (p) => has(p.name, 'rex button', 'request to exit', 'request-to-exit', 'rex push'), scope_role: 'rex_button', labour_code: 'rex_button' },
  { test: (p) => has(p.name, 'mag lock', 'magnetic lock', 'maglock'), scope_role: 'mag_lock', labour_code: 'door_lock' },
  { test: (p) => has(p.name, 'door strike', 'electric strike', 'fes20', 'striker'), scope_role: 'door_strike', labour_code: 'door_lock' },
  { test: (p) => has(p.name, 'emergency door release', 'break glass', 'emergency release'), scope_role: 'emergency_door_release', labour_code: 'none' },
  { test: (p) => has(p.name, 'door loop'), scope_role: 'cabling', labour_code: 'none' },
  { test: (p) => has(p.name, 'standalone keypad', 'pin keypad', 'access keypad') && cat(p.category, 'Access Control'), scope_role: 'standalone_keypad', labour_code: 'alarm_keypad' },
  { test: (p) => has(p.name, 'access controller', 'door controller', 'unifi access', 'ac-825', 'ac825', 'expansion board'), scope_role: 'access_control_system', labour_code: 'none' },

  // ── Security / alarm ───────────────────────────────────────────────────
  { test: (p) => has(p.name, 'alarm panel', 'solution 6000', 'solution 4000', 'control panel') && cat(p.category, 'Security System'), scope_role: 'alarm_panel', labour_code: 'none' },
  { test: (p) => has(p.name, 'pir 360', '360°', 'ceiling pir', 'pir ceiling'), scope_role: 'motion_sensor', labour_code: 'pir_360_roof' },
  { test: (p) => has(p.name, 'pir', 'movement sensor', 'motion sensor', 'detector'), scope_role: 'motion_sensor', labour_code: 'pir_wall' },
  { test: (p) => has(p.name, 'reed switch', 'door contact', 'magnetic contact'), scope_role: 'reed_switch', labour_code: 'reed_switch' },
  { test: (p) => has(p.name, 'duress button', 'panic button', 'duress'), scope_role: 'duress_button', labour_code: 'duress_button' },
  { test: (p) => has(p.name, 'duress pendant', 'wireless pendant'), scope_role: 'duress_pendant', labour_code: 'none' },
  { test: (p) => has(p.name, 'duress intercom'), scope_role: 'duress_intercom', labour_code: 'duress_intercom' },
  { test: (p) => has(p.name, 'rf receiver', 'wireless receiver', 'rf hub'), scope_role: 'rf_receiver', labour_code: 'rf_receiver' },
  { test: (p) => has(p.name, 'siren', 'strobe', 'light & siren', 'light and siren'), scope_role: 'light_siren', labour_code: 'light_siren' },
  { test: (p) => has(p.name, 'alarm keypad', 'codepad') && cat(p.category, 'Security System'), scope_role: 'standalone_keypad', labour_code: 'alarm_keypad' },

  // ── HDMI modulator ─────────────────────────────────────────────────────
  { test: (p) => has(p.name, 'modulator', 'hdmi modulator'), scope_role: 'modulator', labour_code: 'none' },

  // ── Card readers (extra brand patterns) ────────────────────────────────
  { test: (p) => has(p.name, 'paxton10 desktop', 'paxton10 keypad reader', 'paxton10 slimline', 'net2 desktop'), scope_role: 'card_reader', labour_code: 'card_reader' },
  { test: (p) => has(p.name, 'hid signo', 'hid prox', 'morphosmart', 'speedpalm', 'face authentication', 'palm reader', 'fingerprint reader', 'stouch'), scope_role: 'card_reader', labour_code: 'card_reader' },
  { test: (p) => has(p.name, 'paxton10 cards', 'paxton10 keyfob', 'cards (', 'keyfobs (', 'fobs (', 'mifare card', 'access card'), scope_role: 'none', labour_code: 'none' },

  // ── Aiphone / intercom systems ────────────────────────────────────────
  { test: (p) => has(p.name, 'aiphone', 'video intercom', 'door station', 'indoor monitor') && cat(p.category, 'Access Control', 'Security System'), scope_role: 'access_control_system', labour_code: 'intercom_slave' },

  // ── Alarm panel expansion / accessories (Bosch, etc.) ─────────────────
  { test: (p) => /\b(cm[0-9]+|mw[0-9]+|my[0-9]+)\b/i.test(p.name) || has(p.name, 'expansion module', 'expansion board sol', 'enclosure suits', 'output expansion', 'zone input', 'plug on 4g', 'gsm modem', '4g gsm', 'ethernet relay', 'ip module'), scope_role: 'alarm_panel', labour_code: 'none' },
  { test: (p) => has(p.name, 'sol6000', 'solution 6000', 'sol4000', 'solution 4000'), scope_role: 'alarm_panel', labour_code: 'none' },
  { test: (p) => has(p.name, 'bosch') && has(p.name, 'panel', 'modem', 'module', 'enclosure', 'metal box'), scope_role: 'alarm_panel', labour_code: 'none' },
  { test: (p) => has(p.name, 'pendant transmitter', 'wireless pendant', 'inovonics', 'panic pendant'), scope_role: 'duress_pendant', labour_code: 'none' },
  { test: (p) => has(p.name, 'ifob', 'i-fob', 'fob control'), scope_role: 'access_control_system', labour_code: 'none' },
  { test: (p) => has(p.name, 'rf receiver', 'wireless receiver', 'rf hub', 'smart receiver') || /\brf\d/i.test(p.name), scope_role: 'rf_receiver', labour_code: 'rf_receiver' },

  // ── Touch screen / monitor variants ────────────────────────────────────
  { test: (p) => has(p.name, 'touch screen', 'ip indoor monitor', '7in touch'), scope_role: 'monitor', labour_code: 'none' },

  // ── 4G / dialer / connectivity for alarm ──────────────────────────────
  { test: (p) => has(p.name, '4g dialer', '4g - ethernet', '4g ethernet', 'gsm dialer', 'gsm/gprs', 'ness dialer', 't4000', 'multipath') && cat(p.category, 'Security System', 'Data System'), scope_role: 'alarm_panel', labour_code: 'none' },
  { test: (p) => has(p.name, 'sim', 'back to base'), scope_role: 'monitoring_subscription', labour_code: 'none' },

  // ── Power boards, PoE injectors, rack accessories ─────────────────────
  { test: (p) => has(p.name, 'power board', 'poe injector', 'poe budget', 'redundant psu', 'smartpower', 'rack mounted power'), scope_role: 'none', labour_code: 'none' },
  { test: (p) => has(p.name, 'vented shelf', 'vented shelves', 'rack shelf', 'cable management', 'duct style', '19" duct', '19" rack'), scope_role: 'none', labour_code: 'none' },

  // ── Floor ducting / floor box (electrician's scope) ───────────────────
  { test: (p) => has(p.name, 'floor box', 'floor duct', 'aluminium floor ducting', 'floor ducting', 'mounting kit'), scope_role: 'cabling', labour_code: 'none' },
  { test: (p) => has(p.name, 'catenary wire', 'turnbuckle', 'wire clamp', 'eye bolt'), scope_role: 'cabling', labour_code: 'none' },

  // ── Conduit / mounting hardware (consumables) ─────────────────────────
  { test: (p) => has(p.name, 'conduit', 'junction box', 'wall anchor', 'concrete anchor', 'cover plate', 'cover plate mount', 'velcro', 'double sided tape', 'metal screws', 'cable mount plug', 'connector strip', 'relay mount', 'screw eye'), scope_role: 'none', labour_code: 'none' },

  // ── Antennas, AV signal hardware ──────────────────────────────────────
  { test: (p) => has(p.name, 'antenna', 'band pass filter', 'signage media player', 'media licence', 'media license', 'ultra short throw', 'projector', 'tablet'), scope_role: 'none', labour_code: 'none' },
  { test: (p) => has(p.name, 'kiosk', 'nightlife server', 'nightlife kiosk'), scope_role: 'nightlife', labour_code: 'none' },

  // ── Tailgate / turnstile / speed gate ─────────────────────────────────
  { test: (p) => has(p.name, 'turnstile', 'speed gate', 'swing barrier'), scope_role: 'tailgate_system', labour_code: 'tailgate_system' },

  // ── Camera-related hardware that fell through ─────────────────────────
  { test: (p) => has(p.name, 'backbox') && cat(p.category, 'Digital Surveillance'), scope_role: 'camera_mount', labour_code: 'none' },
  { test: (p) => has(p.name, 'gen3 tioc', 'tioc'), scope_role: 'camera', labour_code: 'camera_plaster' },

  // ── Fallback for adapters, generic bits ───────────────────────────────
  { test: (p) => has(p.name, 'adaptor', 'adapter', 'pal male', 'f-female', 'f female', 'usb-c', 'flylead', 'fly lead', 'protector aluminium'), scope_role: 'none', labour_code: 'none' },
  { test: (p) => has(p.name, 'pushbutton', 'push button') && !has(p.name, 'duress', 'rex'), scope_role: 'none', labour_code: 'none' },
  { test: (p) => has(p.name, 'timer relay', 'switch module', 'gp relay'), scope_role: 'none', labour_code: 'none' },

  // ── Last-mile catches ──────────────────────────────────────────────────
  { test: (p) => has(p.name, 'ubiquiti g3', 'ubiquiti g4', 'ubiquiti g5', 'unifi protect'), scope_role: 'camera', labour_code: 'camera_plaster' },
  { test: (p) => has(p.name, 'samsung ls', '24" ips', 'ips led', 'fusion signage', 'media player') && !has(p.name, 'tablet'), scope_role: 'monitor', labour_code: 'none' },
  { test: (p) => has(p.name, 'security cable', 'sec14', 'shielded data cable'), scope_role: 'cabling', labour_code: 'none' },
  { test: (p) => has(p.name, 'vesta') && has(p.name, 'panel'), scope_role: 'alarm_panel', labour_code: 'none' },
  { test: (p) => has(p.name, 'vesta') && has(p.name, 'keypad'), scope_role: 'standalone_keypad', labour_code: 'alarm_keypad' },
  { test: (p) => has(p.name, 'vesta') && has(p.name, 'sensor', 'shock'), scope_role: 'motion_sensor', labour_code: 'pir_wall' },
  { test: (p) => has(p.name, 'vesta') && has(p.name, 'door/window'), scope_role: 'reed_switch', labour_code: 'reed_switch' },
  { test: (p) => has(p.name, 'vesta'), scope_role: 'motion_sensor', labour_code: 'pir_wall' },
  { test: (p) => has(p.name, 'eca2010', 'access control intercom'), scope_role: 'duress_intercom', labour_code: 'duress_intercom' },
  { test: (p) => has(p.name, 'reporting lite', 'connect hub') || has(p.name, 'sifer', 'fob'), scope_role: 'none', labour_code: 'none' },
  { test: (p) => has(p.name, 'mounting tape', 'bootlace', 'crimp'), scope_role: 'none', labour_code: 'none' },
  { test: (p) => has(p.name, 'dahua') && has(p.name, 'poe') && has(p.name, 'port'), scope_role: 'network_switch', labour_code: 'none' },
  { test: (p) => has(p.name, 'middle board') && cat(p.category, 'Security System'), scope_role: 'access_control_system', labour_code: 'none' },
  { test: (p) => has(p.name, 'kingray', 'power connector'), scope_role: 'none', labour_code: 'none' },

  // ── Data / network ─────────────────────────────────────────────────────
  { test: (p) => has(p.name, 'wap', 'access point', ' ap ', 'wifi 6', 'unifi u6', 'unifi u7'), scope_role: 'wap', labour_code: 'wap' },
  { test: (p) => has(p.name, 'router', 'gateway', 'udm', 'usg'), scope_role: 'router', labour_code: 'none' },
  { test: (p) => has(p.name, 'switch') && cat(p.category, 'Data System'), scope_role: 'network_switch', labour_code: 'none' },
  { test: (p) => has(p.name, 'cabinet', '9ru', '27ru', '32ru', '42ru', 'server rack'), scope_role: 'cabinet', labour_code: 'none' },
  { test: (p) => has(p.name, 'ups', 'uninterruptible'), scope_role: 'ups', labour_code: 'none' },

  // ── Mounting brackets (general purpose) ───────────────────────────────
  { test: (p) => has(p.name, 'mounting bracket', 'mount bracket', 'pole bracket', 'vesa', 'nuc mounting'), scope_role: 'mounting_bracket', labour_code: 'none' },

  // ── Subscriptions / plans ──────────────────────────────────────────────
  { test: (p) => cat(p.category, 'Internet Plans', 'VoIP', 'Fibre System'), scope_role: 'monitoring_subscription', labour_code: 'none' },
  { test: (p) => has(p.name, 'monitoring', 'myalarm', 'subscription', 'monthly fee'), scope_role: 'monitoring_subscription', labour_code: 'none' },
];

// ── Run ──────────────────────────────────────────────────────────────────

const { data: products, error } = await supa
  .from('quote_products')
  .select('id, name, category, scope_role, labour_code')
  .eq('is_active', true)
  .order('category, name');

if (error) { console.error(error); process.exit(1); }
console.log(`Loaded ${products.length} active products`);

let assigned = 0, fallback = 0;
const previews = [];

for (const p of products) {
  let matched = null;
  for (const r of RULES) {
    if (r.test(p)) { matched = r; break; }
  }
  const scope_role = matched?.scope_role ?? 'none';
  const labour_code = matched?.labour_code ?? 'none';
  if (matched) assigned++; else fallback++;

  if (DRY_RUN) {
    previews.push({ name: p.name.slice(0, 80), category: p.category, scope_role, labour_code, matched: !!matched });
  }

  if (!DRY_RUN) {
    const { error: upErr } = await supa
      .from('quote_products')
      .update({ scope_role, labour_code })
      .eq('id', p.id);
    if (upErr) console.error('upd err', p.name, upErr.message);
  }
}

console.log(`Assigned by rule: ${assigned}`);
console.log(`Fallback (none/none): ${fallback}`);

if (DRY_RUN) {
  // Group fallbacks (none/none) by category and dump
  const byCat = {};
  for (const p of previews.filter(p => !p.matched)) {
    (byCat[p.category] ??= []).push(p.name);
  }
  console.log('\nFallbacks (none/none) by category:');
  for (const [cat, items] of Object.entries(byCat)) {
    console.log(`\n  [${cat}] (${items.length})`);
    for (const n of items.slice(0, 30)) console.log(`    - ${n}`);
    if (items.length > 30) console.log(`    ... +${items.length - 30} more`);
  }
  console.log('\nDRY_RUN — exiting');
}
