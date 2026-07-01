// Name/service matching helpers shared by the billing-reconciliation tooling
// (scripts/billing-recon.mjs mirrors this logic) and the weekly NBN billing
// watchdog cron. Matching is deliberately fuzzy-but-explainable: strip brand
// and corporate noise, then require every remaining location token of the
// cost-side name to appear in the billing-side name.

const BRANDS = /\b(snap fitness|snap|sf|9 ?rounds?|core ?plus|coreplus|just focus|fit4eva|planet fitness|total fusion|fitness)\b/g;
const NOISE = /\b(pty|ltd|atf|t\/?a|trust|group|the|family|nominees|security|myalarm|duress intercom|duress|b2b|monitoring|intercom|homes|24\/?7|247|qld|nsw|vic|wa|sa|tas|nt|act)\b/g;

export function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

export function siteTokens(s: string | null | undefined): string[] {
  const n = norm(s).replace(BRANDS, " ").replace(NOISE, " ").replace(/\s+/g, " ").trim();
  return n.split(" ").filter((w) => w.length >= 3 && !/^\d+$/.test(w));
}

export function nameMatches(costName: string, billingName: string): boolean {
  const bn = " " + norm(billingName) + " ";
  const toks = siteTokens(costName);
  if (toks.length === 0) return false;
  return toks.every((t) => bn.includes(t));
}

export const SERVICE_TESTS: Record<string, (t: string) => boolean> = {
  // "Bundle 250/100"-style invoice lines are NBN too (TFBL false positive)
  nbn: (t) => /nbn|bundle\s*\d|internet|\b\d{2,4}\s*\/\s*\d{2,4}\b/i.test(t),
  sim: (t) => /\bsim\b|sim card/i.test(t),
  myalarm: (t) => /my ?alarm|ifob/i.test(t),
  duress: (t) => /duress/i.test(t),
  monitoring: (t) => /monitor|b2b|back2base|alarm/i.test(t),
};
