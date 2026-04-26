// ============================================================================
// Centrefit Quote Engine — Scope of Works Generator (BOM-driven, system-card)
//
// Produces a customer-facing scope document organised BY SYSTEM (Security &
// Alarm, Access Control, CCTV, Audio, AV, Data & Wireless, Tailgate), rather
// than by install phase (rough-in / fit-off). Counts roll up from real BOM
// line items via each product's `scope_role`, so the document stays accurate
// for plan-based quotes, manual quotes, and any tech-added line items.
// ============================================================================

import type { SiteInfo } from './constants';

// ── Document shape ─────────────────────────────────────────────────────────

export interface ScopeSystemBlock {
  id: string;            // 'security_alarm', 'access_control', 'cctv', 'audio', 'av', 'data', 'tailgate'
  name: string;          // 'Security & Alarm'
  iconLabel: string;     // single-character glyph for the icon pill: 'S', 'A', 'C', '♪', '▶', '≣', 'T'
  countSummary: string;  // '1 panel · 8 PIRs · 4 reed · 1 button · 3 pendants'
  subSummary?: string;   // '24/7 monitored'
  lead: string;          // single paragraph of plain-English explanation
  items: string[];       // bullet list (HTML allowed for <strong> emphasis on counts)
  included: boolean;     // false → omit from the doc (override or empty BOM)
  isCustom: boolean;     // user-added via the editor
}

export interface ScopeByOthersBlock {
  id: 'electrician' | 'locksmith' | string;
  name: string;
  items: string[];
  included: boolean;
}

export interface ScopeOngoingCost {
  id: string;
  desc: string;
  price: string;         // e.g. '$55.00 / month ex GST'
  included: boolean;
}

export interface ScopeSummary {
  /** Single paragraph for the executive summary card. */
  lead: string;
  /** Two-column grid of system × headline count. */
  rows: { name: string; qty: string }[];
}

export interface ScopeDocument {
  summary: ScopeSummary;
  systems: ScopeSystemBlock[];
  byOthers: ScopeByOthersBlock[];
  hardExclusion: string;
  ongoingCosts: ScopeOngoingCost[];
  assumptions: string[];
  standards: string[];
}

// ── Override format (v2) ───────────────────────────────────────────────────
//
// New shape, keyed by system id rather than clause id. Old (clause-based)
// overrides are silently ignored — the new model gives users include/exclude
// per system + override of the lead text + override of items list.
//
// Per-quote `scope_overrides` JSONB is loaded as-is; if it matches the new
// shape it applies, otherwise it's ignored. Existing pre-2026-04-25 quotes
// regenerate from BOM with no overrides.

export interface ScopeOverrides {
  systems?: Record<string, {
    included?: boolean;
    lead?: string;
    items?: string[];
  } | undefined>;
  byOthers?: Record<string, {
    included?: boolean;
    items?: string[];
  } | undefined>;
  ongoingCosts?: Record<string, { included?: boolean } | undefined>;
  hideHardExclusion?: boolean;
  /** Override the auto-generated intro paragraph at the top of the SoW. */
  summaryLead?: string;
  customSystems?: Array<{
    id: string;
    name: string;
    iconLabel?: string;
    lead?: string;
    items?: string[];
  }>;
}

// ── BOM rollup ─────────────────────────────────────────────────────────────

export interface BOMLineForScope {
  product_id: string | null;
  quantity: number;
}

export interface ProductForScope {
  id: string;
  scope_role: string | null;
  /** Optional — used by the Miscellaneous block to list untagged products by name. */
  name?: string | null;
  /** Optional — surfaced alongside name in the Miscellaneous block. */
  sku?: string | null;
}

/**
 * Roles the generator emits dedicated bullets for. Anything outside this set
 * — including untagged products (scope_role IS NULL) — falls into the
 * Miscellaneous block so nothing on the BOM goes silent in the SoW.
 *
 * Some entries here are NOT individually rendered as bullets but ARE referenced
 * generically by their parent system block (e.g. `cabling` is mentioned by
 * "All Cat6 cabling..." style lines). They live in this set so they don't
 * clutter the Miscellaneous block.
 */
const HANDLED_ROLES = new Set([
  // Security & Alarm
  'alarm_panel', 'motion_sensor', 'reed_switch',
  'duress_button', 'duress_pendant', 'duress_intercom', 'rf_receiver',
  'light_siren',
  // Access Control
  'door_strike', 'mag_lock', 'rex_button',
  'access_control_system', 'card_reader', 'standalone_keypad',
  // Surveillance
  'camera', 'nvr', 'monitor', 'camera_mount',
  // Audio
  'speaker', 'amplifier',
  // AV / Cardio
  'modulator', 'tv_mount_wall', 'tv_mount_ceiling',
  // Data & Network
  'router', 'network_switch', 'wap', 'cabinet',
  // Tailgate
  'tailgate_system',
  // Nightlife
  'nightlife',
  // Subscriptions / generic-mention roles
  'monitoring_subscription', 'cabling', 'mounting_bracket',
]);

export interface UnhandledLineForScope {
  productId: string;
  productName: string;
  sku: string | null;
  quantity: number;
  scopeRole: string | null;
}

export class BOMRollup {
  private byRole = new Map<string, number>();
  /** Line items whose scope_role is null/empty or not in HANDLED_ROLES. */
  public readonly unhandled: UnhandledLineForScope[] = [];

  constructor(bom: BOMLineForScope[], products: ProductForScope[]) {
    const productsById = new Map(products.map((p) => [p.id, p]));
    for (const item of bom) {
      if (!item.product_id) continue;
      const product = productsById.get(item.product_id);
      if (!product) continue;
      const qty = Number(item.quantity) || 0;
      const role = product.scope_role && product.scope_role.length > 0 ? product.scope_role : null;
      if (role) {
        this.byRole.set(role, (this.byRole.get(role) ?? 0) + qty);
      }
      if (!role || !HANDLED_ROLES.has(role)) {
        this.unhandled.push({
          productId: product.id,
          productName: product.name ?? "(unknown product)",
          sku: product.sku ?? null,
          quantity: qty,
          scopeRole: role,
        });
      }
    }
  }

  count(...roles: string[]): number {
    return roles.reduce((sum, r) => sum + (this.byRole.get(r) ?? 0), 0);
  }

  hasAny(...roles: string[]): boolean {
    return roles.some((r) => (this.byRole.get(r) ?? 0) > 0);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function plural(n: number, singular: string, pluralForm?: string): string {
  return n === 1 ? singular : (pluralForm ?? `${singular}s`);
}

function applySystemOverride(block: ScopeSystemBlock, ov?: ScopeOverrides): ScopeSystemBlock {
  const o = ov?.systems?.[block.id];
  if (!o) return block;
  return {
    ...block,
    lead: o.lead ?? block.lead,
    items: Array.isArray(o.items) ? o.items : block.items,
    included: o.included ?? block.included,
  };
}

// ── Main entry point ───────────────────────────────────────────────────────

/**
 * Lookup helper: return the user-set role description if present and
 * non-empty, otherwise fall back to the hardcoded bullet text. Lets admins
 * tweak default bullet wording per role via Settings → Scope Roles without
 * editing every quote.
 */
function roleBullet(
  roleDescriptions: Record<string, string> | undefined,
  slug: string,
  count: number,
  fallback: string,
): string {
  const desc = roleDescriptions?.[slug]?.trim();
  if (desc && desc.length > 0) {
    return `<strong>(${count}) ${desc}</strong>`;
  }
  return fallback;
}

export function generateScopeOfWorks(
  bom: BOMLineForScope[],
  products: ProductForScope[],
  siteInfo: SiteInfo,
  overrides?: ScopeOverrides,
  roleDescriptions?: Record<string, string>,
): ScopeDocument {
  const r = new BOMRollup(bom, products);

  // ── Counts (BOM) ────────────────────────────────────────────────────────
  const cameras         = r.count('camera');
  const nvrs            = r.count('nvr');
  const monitors        = r.count('monitor');
  const motion          = r.count('motion_sensor');
  const reeds           = r.count('reed_switch');
  const panels          = r.count('alarm_panel');
  const buttons         = r.count('duress_button');
  const pendants        = r.count('duress_pendant');
  const intercoms       = r.count('duress_intercom');
  const rfReceivers     = r.count('rf_receiver');
  const sirens          = r.count('light_siren');
  const doorStrikes     = r.count('door_strike');
  const magLocks        = r.count('mag_lock');
  const rexButtons      = r.count('rex_button');
  const accessControllers = r.count('access_control_system');
  const cardReaders     = r.count('card_reader');
  const keypads         = r.count('standalone_keypad');
  const speakers        = r.count('speaker');
  const amplifiers      = r.count('amplifier');
  const modulators      = r.count('modulator');
  const wallTvMounts    = r.count('tv_mount_wall');
  const ceilingTvMounts = r.count('tv_mount_ceiling');
  const totalTvMounts   = wallTvMounts + ceilingTvMounts;
  const routers         = r.count('router');
  const waps            = r.count('wap');
  const cabinets        = r.count('cabinet');
  const tailgates       = r.count('tailgate_system');
  const nightlifeUnits  = r.count('nightlife');

  // ── Counts (siteInfo) ───────────────────────────────────────────────────
  const tvCount        = siteInfo.tv_count ?? 0;
  const ceilingTVCount = siteInfo.ceiling_tv_count ?? 0;
  const totalTVs       = tvCount + ceilingTVCount;
  const cardioCount    = siteInfo.cardio_count ?? 0;

  // ── System: Security & Alarm ────────────────────────────────────────────
  const securitySystem: ScopeSystemBlock | null = (() => {
    const has = panels + motion + reeds + buttons + pendants + intercoms + rfReceivers + sirens > 0;
    if (!has) return null;
    const counts: string[] = [];
    if (panels > 0)       counts.push(`${panels} ${plural(panels, 'panel')}`);
    if (motion > 0)       counts.push(`${motion} ${plural(motion, 'PIR')}`);
    if (reeds > 0)        counts.push(`${reeds} reed`);
    if (buttons > 0)      counts.push(`${buttons} ${plural(buttons, 'button')}`);
    if (pendants > 0)     counts.push(`${pendants} ${plural(pendants, 'pendant')}`);
    if (intercoms > 0)    counts.push(`${intercoms} ${plural(intercoms, 'intercom')}`);
    if (sirens > 0)       counts.push(`${sirens} siren`);

    const items: string[] = [];
    if (motion > 0)       items.push(roleBullet(roleDescriptions, 'motion_sensor', motion, `<strong>(${motion}) movement ${plural(motion, 'sensor')}</strong> covering the gym floor and back-of-house, programmed for intrusion + member detection`));
    if (reeds > 0)        items.push(roleBullet(roleDescriptions, 'reed_switch', reeds, `<strong>(${reeds}) reed ${plural(reeds, 'switch', 'switches')}</strong> on entry/exit doors and roller shutters`));
    if (buttons > 0)      items.push(roleBullet(roleDescriptions, 'duress_button', buttons, `<strong>(${buttons}) wall-mounted duress ${plural(buttons, 'button')}</strong>`));
    if (pendants > 0)     items.push(roleBullet(roleDescriptions, 'duress_pendant', pendants, `<strong>(${pendants}) wireless duress ${plural(pendants, 'pendant')}</strong> for staff`));
    if (rfReceivers > 0)  items.push(roleBullet(roleDescriptions, 'rf_receiver', rfReceivers, `<strong>(${rfReceivers}) RF receiver ${plural(rfReceivers, 'hub')}</strong> paired to the wireless pendants`));
    if (intercoms > 0)    items.push(roleBullet(roleDescriptions, 'duress_intercom', intercoms, `<strong>(${intercoms}) duress ${plural(intercoms, 'intercom')}</strong>`));
    if (sirens > 0)       items.push(`External light-and-siren combo, monitored to MyAlarm`);
    items.push(`All security cabling, terminations, faceplates and "C"-plates`);
    items.push(`Programming, commissioning and full handover to staff`);

    return {
      id: 'security_alarm',
      name: 'Security & Alarm',
      iconLabel: 'S',
      countSummary: counts.join(' · '),
      subSummary: panels > 0 ? '24/7 monitored' : undefined,
      lead: panels > 0
        ? 'Bosch Solution 6000 alarm with full intrusion and member-detection coverage, 24/7 monitoring, and external siren/strobe. Fully automated to the lights and music control.'
        : 'Intrusion and member-detection sensors with cabling and full commissioning.',
      items,
      included: true,
      isCustom: false,
    };
  })();

  // ── System: Access Control ──────────────────────────────────────────────
  const accessSystem: ScopeSystemBlock | null = (() => {
    const has = doorStrikes + rexButtons + accessControllers + cardReaders + keypads > 0;
    if (!has) return null;
    const counts: string[] = [];
    if (doorStrikes > 0)       counts.push(`${doorStrikes} ${plural(doorStrikes, 'door')}`);
    if (accessControllers > 0) counts.push(`${accessControllers} ${plural(accessControllers, 'controller')}`);
    if (cardReaders > 0)       counts.push(`${cardReaders} ${plural(cardReaders, 'reader')}`);
    if (keypads > 0)           counts.push(`${keypads} ${plural(keypads, 'keypad')}`);
    if (rexButtons > 0)        counts.push(`${rexButtons} REX`);

    const items: string[] = [];
    items.push(`Cabling and termination for ${doorStrikes > 0 ? `${doorStrikes} ${plural(doorStrikes, 'door position')}` : 'each door position'}`);
    if (accessControllers > 0) items.push(roleBullet(roleDescriptions, 'access_control_system', accessControllers, `<strong>(${accessControllers}) UniFi Access ${plural(accessControllers, 'controller')}</strong> — central management for doors, readers and keypads`));
    if (cardReaders > 0)       items.push(roleBullet(roleDescriptions, 'card_reader', cardReaders, `<strong>(${cardReaders}) card ${plural(cardReaders, 'reader')}</strong> — proximity / NFC, integrated with the access controller`));
    if (keypads > 0)           items.push(roleBullet(roleDescriptions, 'standalone_keypad', keypads, `<strong>(${keypads}) standalone PIN ${plural(keypads, 'keypad')}</strong> — code-based door entry`));
    if (doorStrikes > 0)       items.push(roleBullet(roleDescriptions, 'door_strike', doorStrikes, `<strong>(${doorStrikes}) FES20 electric ${plural(doorStrikes, 'striker')}</strong> and door ${plural(doorStrikes, 'loop')}`));
    if (magLocks > 0)          items.push(roleBullet(roleDescriptions, 'mag_lock', magLocks, `<strong>(${magLocks}) magnetic ${plural(magLocks, 'lock')}</strong> with mounting hardware`));
    if (rexButtons > 0)        items.push(roleBullet(roleDescriptions, 'rex_button', rexButtons, `<strong>(${rexButtons}) REX (request-to-exit) push ${plural(rexButtons, 'button')}</strong>`));
    items.push(`Integration with the alarm panel for app-based door control`);

    return {
      id: 'access_control',
      name: 'Access Control',
      iconLabel: 'A',
      countSummary: counts.join(' · '),
      subSummary: accessControllers > 0 ? 'UniFi Access + app' : 'Door automation + app',
      lead: accessControllers > 0
        ? 'UniFi Access controller integrated with the alarm panel and member-management app — central control of all doors, readers and keypads on site.'
        : 'Door automation integrated with the alarm and member-management app for unlocking outside staffed hours.',
      items,
      included: true,
      isCustom: false,
    };
  })();

  // ── System: CCTV ────────────────────────────────────────────────────────
  const cctvSystem: ScopeSystemBlock | null = (() => {
    if (cameras === 0) return null;
    const counts: string[] = [`${cameras} ${plural(cameras, 'camera')}`];
    if (nvrs > 0)     counts.push(`${nvrs} NVR`);
    if (monitors > 0) counts.push(`${monitors} ${plural(monitors, 'monitor')}`);

    const items: string[] = [];
    items.push(`<strong>(${cameras}) IP ${plural(cameras, 'camera')}</strong> — internal and external, mounted as per plan`);
    if (nvrs > 0) {
      items.push(`<strong>(${nvrs}) network video ${plural(nvrs, 'recorder')}</strong> with surveillance-grade storage`);
    }
    if (monitors > 0) {
      items.push(`<strong>(${monitors}) ${plural(monitors, 'monitor')}</strong> for live CCTV viewing in the comms / reception area`);
    }
    items.push(`All Cat6 cabling, terminations and wall-mount brackets`);
    items.push(`Mobile-app configuration and customer training`);

    return {
      id: 'cctv',
      name: 'CCTV / Digital Surveillance',
      iconLabel: 'C',
      countSummary: counts.join(' · '),
      subSummary: 'Full 24/7 coverage',
      lead: 'High-resolution camera array covering all entry points, gym floor, change rooms and back-of-house, recording continuously to the on-site NVR with mobile-app remote viewing.',
      items,
      included: true,
      isCustom: false,
    };
  })();

  // ── System: Audio ───────────────────────────────────────────────────────
  const audioSystem: ScopeSystemBlock | null = (() => {
    if (speakers === 0) return null;
    const ampLabel = amplifiers > 0
      ? `${amplifiers} ${plural(amplifiers, 'amplifier')}`
      : siteInfo.separate_studio_zone ? '2 amplifiers' : '1 amplifier';
    const counts: string[] = [`${speakers} ${plural(speakers, 'speaker')}`, ampLabel];

    const items: string[] = [
      `<strong>(${speakers}) ceiling/wall-mounted ${plural(speakers, 'speaker')}</strong> covering main gym, free-weights and reception`,
      amplifiers > 0
        ? `${amplifiers === 1 ? '' : `(${amplifiers}) `}${plural(amplifiers, 'rack-mounted mixer-amplifier')} on 100V line audio`
        : `Rack-mounted mixer-amplifier on 100V line audio`,
      `All speaker cabling, terminations and faceplates`,
    ];

    return {
      id: 'audio',
      name: 'Audio System',
      iconLabel: 'M',
      countSummary: counts.join(' · '),
      lead: '100V line audio for music distribution across the gym floor.',
      items,
      included: true,
      isCustom: false,
    };
  })();

  // ── System: AV / Cardio ─────────────────────────────────────────────────
  const avSystem: ScopeSystemBlock | null = (() => {
    if (totalTVs + cardioCount === 0) return null;
    const counts: string[] = [];
    if (totalTVs > 0)     counts.push(`${totalTVs} ${plural(totalTVs, 'TV')}`);
    if (cardioCount > 0)  counts.push(`${cardioCount} cardio`);
    if (modulators > 0)   counts.push(`${modulators} ${plural(modulators, 'modulator')}`);

    const items: string[] = [];
    if (totalTVs > 0) {
      const mountBreakdown = [
        wallTvMounts > 0 ? `${wallTvMounts} wall` : null,
        ceilingTvMounts > 0 ? `${ceilingTvMounts} ceiling` : null,
      ].filter(Boolean).join(', ');
      const mountDesc = totalTvMounts > 0
        ? `, mounted on <strong>${totalTvMounts} Centrefit-supplied ${plural(totalTvMounts, 'TV mount')}</strong>${mountBreakdown ? ` (${mountBreakdown})` : ''}`
        : '';
      items.push(`<strong>(${totalTVs}) ${plural(totalTVs, 'TV')} — supplied by the customer</strong>${mountDesc}, installed and commissioned by Centrefit`);
    }
    if (modulators > 0 || cardioCount > 0) {
      items.push(modulators > 0
        ? `(${modulators}) HDMI ${plural(modulators, 'modulator')} + 8-way coax splitter + DA44 distribution amplifier`
        : `HDMI modulator + 8-way coax splitter + DA44 distribution amplifier`);
    }
    items.push('All AV terminations at the rack and at each TV/cardio position');

    return {
      id: 'av',
      name: 'AV / Cardio TV Distribution',
      iconLabel: 'V',
      countSummary: counts.join(' · '),
      lead: 'HDMI distribution from the comms cabinet to all wall-mounted TVs and cardio machines, including coaxial backbone for the in-house fitness channel feed.',
      items,
      included: true,
      isCustom: false,
    };
  })();

  // ── System: Data & Wireless ─────────────────────────────────────────────
  const dataSystem: ScopeSystemBlock | null = (() => {
    if (cabinets + waps + routers === 0) return null;
    const counts: string[] = [];
    if (cabinets > 0) counts.push(`${cabinets} ${plural(cabinets, 'cabinet')}`);
    if (routers > 0)  counts.push(`${routers} ${plural(routers, 'router')}`);
    if (waps > 0)     counts.push(`${waps} ${plural(waps, 'AP')}`);

    const items: string[] = [];
    if (cabinets > 0) items.push(`Server ${plural(cabinets, 'rack')} with patch panels, UPS, cable management and power boards`);
    items.push(`Gigabit managed PoE switching`);
    if (routers > 0)  items.push(`<strong>(${routers}) UniFi ${plural(routers, 'router')}</strong> — gateway, firewall and Wi-Fi controller in one`);
    if (waps > 0)     items.push(`<strong>(${waps}) Wi-Fi access ${plural(waps, 'point')}</strong>, supplied, installed and configured`);
    items.push(`All Cat6 patch leads, snap plugs and rack terminations`);

    return {
      id: 'data',
      name: 'Data & Wireless',
      iconLabel: 'D',
      countSummary: counts.join(' · '),
      subSummary: cabinets > 0 ? 'Comms rack + Wi-Fi' : 'Wi-Fi',
      lead: routers > 0
        ? 'Server cabinet, gigabit managed switching, UPS power and UniFi-managed Wi-Fi covering the whole site.'
        : 'Server cabinet, gigabit managed switching, UPS power and managed Wi-Fi covering the whole site.',
      items,
      included: true,
      isCustom: false,
    };
  })();

  // ── System: Nightlife ───────────────────────────────────────────────────
  const nightlifeSystem: ScopeSystemBlock | null = (() => {
    if (nightlifeUnits === 0) return null;
    return {
      id: 'nightlife',
      name: 'Nightlife',
      iconLabel: 'N',
      countSummary: `${nightlifeUnits} ${plural(nightlifeUnits, 'unit')}`,
      subSummary: 'Streaming + member kiosk',
      lead: 'Nightlife streaming server and member-activity kiosk — supplied by Nightlife and billed directly. Centrefit installs, integrates and commissions on-site.',
      items: [
        `<strong>(${nightlifeUnits}) Nightlife ${plural(nightlifeUnits, 'component')}</strong> — server + kiosk per the Nightlife spec`,
        `Cat6 cabling, terminations and rack integration`,
        `Configuration and commissioning of the kiosk against the gym's member system`,
      ],
      included: true,
      isCustom: false,
    };
  })();

  // ── System: Tailgate ────────────────────────────────────────────────────
  const tailgateSystem: ScopeSystemBlock | null = (() => {
    if (tailgates === 0) return null;
    return {
      id: 'tailgate',
      name: 'FelixGate Tailgating',
      iconLabel: 'T',
      countSummary: `${tailgates} ${plural(tailgates, 'system')}`,
      subSummary: 'Tailgating detection',
      lead: 'Tailgating detection at the front entrance. A counting sensor and profile camera count every person walking through the door and cross-reference against the gym\'s member access system to flag unauthorised entries. Each event uploads a 15-second video clip (5 seconds before, 10 seconds after) to the FelixGate cloud portal for review.',
      items: [
        `<strong>(${tailgates}) FelixGate counting sensor + profile camera</strong> installed at the front entrance`,
        `Cloud-connect server with daily email alerts and a 15-second video clip per detected event`,
        `Cross-referenced against the gym's existing member-management / access-control system`,
        `Cat6 cabling and terminations to the comms rack`,
        `On-site installation, plus remote calibration and commissioning by Gibson Global`,
      ],
      included: true,
      isCustom: false,
    };
  })();

  // ── System: Miscellaneous (catch-all for untagged / unhandled BOM items) ─
  // Ensures nothing on the BOM goes silent in the SoW. Lists product name +
  // qty for any line whose role isn't in HANDLED_ROLES. Quantities are
  // aggregated per product so duplicates collapse into one line.
  const miscSystem: ScopeSystemBlock | null = (() => {
    if (r.unhandled.length === 0) return null;
    const aggregate = new Map<string, { productName: string; sku: string | null; quantity: number }>();
    for (const u of r.unhandled) {
      const existing = aggregate.get(u.productId);
      if (existing) existing.quantity += u.quantity;
      else aggregate.set(u.productId, { productName: u.productName, sku: u.sku, quantity: u.quantity });
    }
    const lines = Array.from(aggregate.values()).sort((a, b) =>
      a.productName.localeCompare(b.productName),
    );
    if (lines.length === 0) return null;
    return {
      id: 'misc',
      name: 'Additional items',
      iconLabel: '·',
      countSummary: `${lines.length} ${plural(lines.length, 'item')}`,
      lead: 'Additional items on this quote — supplied and installed as part of the package.',
      items: lines.map(
        (l) => `<strong>(${l.quantity}) ${l.productName}</strong>${l.sku ? ` <span style="color:#94a3b8">(${l.sku})</span>` : ""}`,
      ),
      included: true,
      isCustom: false,
    };
  })();

  // Apply per-system overrides + filter nulls + add custom systems
  const baseSystems: ScopeSystemBlock[] = [
    securitySystem, accessSystem, cctvSystem, audioSystem, avSystem, dataSystem, nightlifeSystem, tailgateSystem, miscSystem,
  ].filter((b): b is ScopeSystemBlock => b !== null)
   .map((b) => applySystemOverride(b, overrides));

  for (const c of overrides?.customSystems ?? []) {
    baseSystems.push({
      id: c.id,
      name: c.name,
      iconLabel: c.iconLabel ?? '+',
      countSummary: '',
      lead: c.lead ?? '',
      items: c.items ?? [],
      included: true,
      isCustom: true,
    });
  }
  const systems = baseSystems.filter((s) => s.included);

  // ── By Others ────────────────────────────────────────────────────────────
  const electricianItems: string[] = [];
  if (cardioCount > 0) {
    electricianItems.push('<strong>Floor ducting and floor boxes</strong> for cardio equipment, per drawings supplied by Centrefit');
    electricianItems.push('<strong>Data and AV cable runs</strong> from each cardio position back to the comms rack');
  }
  if (totalTVs > 0) {
    electricianItems.push('<strong>Antenna installation</strong> for the digital TV signal (Centrefit distributes from the rack)');
  }
  if (panels > 0 || motion > 0 || reeds > 0) {
    electricianItems.push('<strong>Switchboard</strong> — split lighting circuits into 4 zones with a twin run to the alarm panel');
  }
  if (cardioCount > 0 || totalTVs > 0) {
    electricianItems.push('<strong>All termination of floor-box AV/data points</strong>');
  }

  const locksmithItems: string[] = [];
  if (doorStrikes > 0 || magLocks > 0) {
    const parts: string[] = [];
    if (doorStrikes > 0) parts.push(`electronic door ${plural(doorStrikes, 'strike')}`);
    if (magLocks > 0) parts.push(`magnetic ${plural(magLocks, 'lock')}`);
    locksmithItems.push(`<strong>Fitting of all ${parts.join(' and ')}</strong> — invoiced directly by the locksmith to the customer`);
  }

  const baseByOthers: ScopeByOthersBlock[] = [];
  if (electricianItems.length > 0) baseByOthers.push({ id: 'electrician', name: 'By the Electrician', items: electricianItems, included: true });
  if (locksmithItems.length > 0)   baseByOthers.push({ id: 'locksmith',   name: 'By the Locksmith',   items: locksmithItems,   included: true });

  const byOthers = baseByOthers
    .map((b) => {
      const o = overrides?.byOthers?.[b.id];
      if (!o) return b;
      return { ...b, items: o.items ?? b.items, included: o.included ?? b.included };
    })
    .filter((b) => b.included);

  // ── Ongoing costs ────────────────────────────────────────────────────────
  const baseOngoing: ScopeOngoingCost[] = [];
  if (panels > 0 || motion > 0 || reeds > 0) {
    baseOngoing.push({ id: 'monitoring',  desc: '24/7 alarm monitoring (MyAlarm)',                       price: '$55.00 / month ex GST',  included: true });
    baseOngoing.push({ id: 'app',         desc: 'Mobile app subscription (security + cameras)',         price: '$133.50 / year ex GST',  included: true });
  }
  if (intercoms > 0) {
    baseOngoing.push({ id: 'intercom_sim',desc: '4G postpaid SIM per duress intercom',                  price: '$22.50 / month ex GST',  included: true });
  }
  if (tailgates > 0) {
    baseOngoing.push({ id: 'felixgate',   desc: 'FelixGate cloud subscription (billed by Gibson Global)', price: 'As per Gibson agreement', included: true });
  }
  const ongoingCosts = baseOngoing
    .map((o) => {
      const ov = overrides?.ongoingCosts?.[o.id];
      return ov ? { ...o, included: ov.included ?? o.included } : o;
    })
    .filter((o) => o.included);

  // ── Summary ──────────────────────────────────────────────────────────────
  const summaryRows: { name: string; qty: string }[] = [];
  if (cameras > 0)         summaryRows.push({ name: 'Digital Surveillance', qty: `${cameras} ${plural(cameras, 'camera')}` });
  if (motion > 0)          summaryRows.push({ name: 'Movement Sensors',     qty: `${motion} ${plural(motion, 'PIR')}` });
  if (reeds > 0)           summaryRows.push({ name: 'Door Sensors',         qty: `${reeds} reed ${plural(reeds, 'switch', 'switches')}` });
  if (doorStrikes > 0)     summaryRows.push({ name: 'Access Control',       qty: `${doorStrikes} ${plural(doorStrikes, 'door')}` });
  if (buttons + pendants > 0) summaryRows.push({ name: 'Duress',            qty: [buttons > 0 ? `${buttons} button` : null, pendants > 0 ? `${pendants} pendants` : null].filter(Boolean).join(' · ') });
  if (speakers > 0)        summaryRows.push({ name: 'Audio System',         qty: `${speakers} speakers · ${amplifiers > 0 ? `${amplifiers} amp` : '1 amp'}` });
  if (totalTVs > 0)        summaryRows.push({ name: 'AV / Cardio',          qty: `${totalTVs} TVs${modulators > 0 ? ` · ${modulators} modulator` : ''}` });
  if (waps > 0)            summaryRows.push({ name: 'Wireless',             qty: `${waps} access points` });
  if (cabinets > 0)        summaryRows.push({ name: 'Server Cabinet',       qty: `${cabinets} ${plural(cabinets, 'rack')}` });
  if (tailgates > 0)        summaryRows.push({ name: 'FelixGate Tailgating', qty: `${tailgates} system` });

  const systemNames = systems.map((s) => s.name.toLowerCase()).join(', ');
  const autoLead = systems.length > 0
    ? `Centrefit Group will supply, install and commission the ${systemNames} systems for this site. All cabling, terminations, configuration and customer-staff training are included. Trade work outside our scope (electrical, antenna, door strikes) is called out as "By others" below.`
    : 'No items currently selected — add products to the BOM to populate this scope.';
  const summary: ScopeSummary = {
    lead: overrides?.summaryLead ?? autoLead,
    rows: summaryRows,
  };

  // ── Hard exclusion ───────────────────────────────────────────────────────
  const hardExclusion = overrides?.hideHardExclusion
    ? ''
    : 'ANY AND ALL ELECTRICAL WORKS ARE NOT INCLUDED IN THIS QUOTE';

  // ── Assumptions + Standards ──────────────────────────────────────────────
  const assumptions = [
    'Site is at fit-out stage with frame complete and roof closed before rough-in is booked.',
    'Power and internet are live before fit-off is booked.',
    "Customer's electrician's data/AV cabling is run and labelled to drawings before fit-off.",
    'Doors, glazing and joinery are installed before access control fit-off.',
    'Site has safe ladder/scaffold access where ceilings exceed 3.0 m.',
  ];

  const standards = [
    'AS/NZS 2201.1-2007 (Intruder alarm systems)',
    'AS 4806 (CCTV — management & operation)',
    'AS/NZS 62676.1.2:2020 (Video surveillance)',
    'AS/NZS IEC 60839.11.1:2019 (Electronic access control)',
    'AS/CA S009:2020 (Customer cabling — wiring rules)',
    'AS 11801.5:2019 (Generic cabling for customer premises)',
  ];

  return {
    summary,
    systems,
    byOthers,
    hardExclusion,
    ongoingCosts,
    assumptions,
    standards,
  };
}

// ── Renderers ───────────────────────────────────────────────────────────────
//
// Two emitters: HTML (for the customer-facing PDF + email) and plain text
// (for Xero invoice line descriptions, where HTML doesn't render).

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

/** Plain-text renderer — used for Xero invoice line descriptions. */
export function renderScopeAsText(scope: ScopeDocument): string {
  const lines: string[] = [];
  if (scope.summary.lead) lines.push(scope.summary.lead, '');

  for (const sys of scope.systems) {
    lines.push(`${sys.name.toUpperCase()}${sys.countSummary ? `  (${sys.countSummary})` : ''}`);
    if (sys.lead) lines.push(`  ${stripHtml(sys.lead)}`);
    for (const item of sys.items) lines.push(`    • ${stripHtml(item)}`);
    lines.push('');
  }

  if (scope.byOthers.length > 0) {
    for (const blk of scope.byOthers) {
      lines.push(blk.name.toUpperCase());
      for (const item of blk.items) lines.push(`    • ${stripHtml(item)}`);
      lines.push('');
    }
  }

  if (scope.hardExclusion) lines.push(scope.hardExclusion, '');

  if (scope.ongoingCosts.length > 0) {
    lines.push('ONGOING COSTS');
    for (const c of scope.ongoingCosts) lines.push(`    • ${c.desc} — ${c.price}`);
  }

  return lines.join('\n').trim();
}

/** HTML renderer — used for the customer-facing PDF preview and the email. */
export function renderScopeAsHtml(scope: ScopeDocument): string {
  const escape = (s: string) => s; // items already use safe HTML (only <strong>)

  const summaryRowsHtml = scope.summary.rows
    .map((row) => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px dashed #e2e8f0;padding:4px 0;font-size:11px">
        <span style="color:#0f172a;font-weight:500">${row.name}</span>
        <span style="color:#475569;font-family:Consolas,Menlo,monospace;font-weight:600">${row.qty}</span>
      </div>`)
    .join('');

  const summaryHtml = scope.summary.lead || scope.summary.rows.length > 0 ? `
    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:18px 22px;margin-bottom:24px;background:#fff">
      <p style="font-size:13px;color:#0f172a;line-height:1.65;margin:0">${escape(scope.summary.lead)}</p>
      ${scope.summary.rows.length > 0 ? `<div style="margin-top:14px;display:grid;grid-template-columns:repeat(2,1fr);gap:8px 24px">${summaryRowsHtml}</div>` : ''}
    </div>` : '';

  const systemsHtml = scope.systems.map((sys) => `
    <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:12px;background:#fff">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:26px;height:26px;border-radius:7px;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px">${escape(sys.iconLabel)}</div>
          <div style="font-size:14px;font-weight:700;color:#0f172a">${escape(sys.name)}</div>
        </div>
        <div style="font-size:10px;color:#475569;text-align:right">
          ${sys.countSummary ? `<strong style="color:#0f172a;font-family:Consolas,Menlo,monospace;font-size:11px">${escape(sys.countSummary)}</strong>` : ''}
          ${sys.subSummary ? `<br>${escape(sys.subSummary)}` : ''}
        </div>
      </div>
      <div style="padding:12px 18px 14px">
        ${sys.lead ? `<p style="font-size:11.5px;color:#0f172a;margin:0 0 8px;line-height:1.55">${escape(sys.lead)}</p>` : ''}
        ${sys.items.length > 0 ? `<ul style="list-style:none;padding:0;margin:0">${sys.items.map((it) => `
          <li style="padding:4px 0 4px 14px;position:relative;font-size:11px;color:#475569;line-height:1.5">
            <span style="position:absolute;left:0;top:11px;width:5px;height:5px;border-radius:50%;background:#047857"></span>
            ${escape(it)}
          </li>`).join('')}</ul>` : ''}
      </div>
    </div>`).join('');

  const byOthersHtml = scope.byOthers.map((blk) => `
    <div style="border-radius:10px;overflow:hidden;margin-bottom:12px">
      <div style="padding:10px 18px;background:#fef3c7;border:1px solid #fde68a;border-radius:10px 10px 0 0">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#92400e">${escape(blk.name)}</div>
      </div>
      <div style="padding:12px 18px;background:#fffbeb;border-left:1px solid #fde68a;border-right:1px solid #fde68a;border-bottom:1px solid #fde68a;border-radius:0 0 10px 10px">
        <ul style="list-style:none;padding:0;margin:0">${blk.items.map((it) => `
          <li style="padding:5px 0 5px 14px;position:relative;font-size:11px;color:#78350f;line-height:1.55">
            <span style="position:absolute;left:0;top:12px;width:5px;height:5px;border-radius:50%;background:#b45309"></span>
            ${escape(it)}
          </li>`).join('')}</ul>
      </div>
    </div>`).join('');

  const hardExclusionHtml = scope.hardExclusion
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 16px;margin-bottom:12px;font-size:11px;color:#991b1b;text-align:center;font-weight:700;letter-spacing:0.5px">${escape(scope.hardExclusion)}</div>`
    : '';

  const ongoingHtml = scope.ongoingCosts.length > 0 ? `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px;margin-bottom:12px">
      <h3 style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#0f172a;margin:0 0 8px">Ongoing Costs</h3>
      ${scope.ongoingCosts.map((c, i) => `
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:4px 0;${i < scope.ongoingCosts.length - 1 ? 'border-bottom:1px dashed #e2e8f0;' : ''}font-size:11px">
          <span style="color:#475569">${escape(c.desc)}</span>
          <span style="color:#0f172a;font-family:Consolas,Menlo,monospace;font-weight:600;white-space:nowrap">${escape(c.price)}</span>
        </div>`).join('')}
    </div>` : '';

  const assumptionsHtml = scope.assumptions.length > 0 ? `
    <div style="margin-bottom:12px">
      <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#0f172a;margin:0 0 6px">Assumptions</p>
      <p style="font-size:10px;color:#94a3b8;margin:0 0 8px">If anything below isn't true on install day, please flag before booking.</p>
      <ul style="list-style:none;padding:0;margin:0">${scope.assumptions.map((a) => `
        <li style="padding:3px 0 3px 16px;position:relative;font-size:10.5px;color:#475569;line-height:1.5">
          <span style="position:absolute;left:0;color:#94a3b8">–</span>${escape(a)}
        </li>`).join('')}</ul>
    </div>` : '';

  const standardsHtml = scope.standards.length > 0 ? `
    <div style="margin-top:18px;padding-top:14px;border-top:1px dashed #e2e8f0">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:#94a3b8;margin-bottom:6px">Standards &amp; codes of practice</div>
      <p style="font-size:9.5px;color:#94a3b8;line-height:1.5;margin:0">${scope.standards.join(' · ')}</p>
    </div>` : '';

  return `${summaryHtml}${systemsHtml ? `<div style="margin-top:8px">${systemsHtml}</div>` : ''}${byOthersHtml ? `<div style="margin-top:14px">${byOthersHtml}</div>` : ''}${hardExclusionHtml}${ongoingHtml}${assumptionsHtml}${standardsHtml}`;
}
