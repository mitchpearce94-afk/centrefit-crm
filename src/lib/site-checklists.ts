/**
 * Site checklists — tick lists that live on the site under Documentation and
 * are linked from the job's Progress tab. The template (items) is code; the
 * ticks per site are the `site_checklists` row (`ticks` = { itemKey: { at, by } }).
 *
 * First one (Mitchell, 9 Nov 2026, from the team's spreadsheet): alarm panel
 * testing, done when the panel is built, before it ships.
 */

export interface SiteChecklistItem {
  key: string;
  label: string;
}

export interface SiteChecklistTemplate {
  kind: SiteChecklistKind;
  title: string;
  blurb: string;
  items: SiteChecklistItem[];
}

export type SiteChecklistKind = "alarm-panel-test";

export type SiteChecklistTicks = Record<string, { at: string; by: string }>;

export const SITE_CHECKLISTS: Record<SiteChecklistKind, SiteChecklistTemplate> = {
  "alarm-panel-test": {
    kind: "alarm-panel-test",
    title: "Alarm panel testing",
    blurb: "Run before the panel ships. Tick each item as it passes; the job's Progress tab reads this list.",
    items: [
      { key: "pir_count", label: "Check PIR numbers" },
      { key: "saunas", label: "Check for saunas" },
      { key: "reed_count", label: "Check number of reed switches" },
      { key: "pendant_count", label: "Check number of pendants" },
      { key: "ras_pin", label: "Check RAS PIN has been set (new motherboard)" },
      { key: "pir_power", label: "Test all PIRs have power" },
      { key: "duress_buttons", label: "Test duress buttons" },
      { key: "duress_pendants", label: "Test duress pendants" },
      { key: "card_reader_locked", label: "Test card reader locked" },
      { key: "arm_disarm_swipe", label: "Arm panel and disarm via card swipe — Finder relay should be green while armed" },
      { key: "courier_relay", label: "Test front door courier — 444B relay next to the 5-port switch is activated" },
      { key: "access_reset", label: "Test access control reset" },
      { key: "cloud_switch", label: "Test cloud switch" },
      { key: "green_plugs", label: "Install all green plugs" },
      { key: "rex_yellow_loop", label: "Check for yellow loop in 3 & 4 of REX button" },
      { key: "panel_photos", label: "Take photos of the panel and upload them to the job" },
    ],
  },
};

export function isSiteChecklistKind(v: string): v is SiteChecklistKind {
  return v in SITE_CHECKLISTS;
}

export function siteChecklistProgress(kind: SiteChecklistKind, ticks: SiteChecklistTicks | null | undefined): { done: number; total: number } {
  const t = SITE_CHECKLISTS[kind];
  const done = t.items.filter((i) => ticks?.[i.key]).length;
  return { done, total: t.items.length };
}

export function siteChecklistHref(siteId: string, kind: SiteChecklistKind): string {
  return `/sites/${siteId}/checklists/${kind}`;
}
