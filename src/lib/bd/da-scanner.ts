import "server-only";

/**
 * SEQ council development-application scanner (QLD growth phase 1 — see
 * docs/qld-growth-CONTEXT.md D5). Six councils polled nightly via their own
 * public JSON endpoints (verified 2026-07-28):
 *
 *  - Brisbane / Ipswich / Redland: Development.i `Geo/GetApplicationFilterResults`
 *  - Gold Coast: newer Development.i build, `Home/ApplicationFilterCSVPaged`
 *    (its server-side date filter is broken — sort desc + cut client-side)
 *  - Logan: DevET council-api-proxy (richest feed — explicit applicant + landUse)
 *  - Moreton Bay: DA Tracker api.moretonbay.qld.gov.au
 *
 * Sunshine Coast is deliberately NOT polled — its robots.txt disallows
 * everything; PlanningAlerts is the compliant substitute if we want it later.
 *
 * Total nightly footprint: ~10 requests across all councils.
 */

export interface DaLead {
  source: string;
  application_number: string;
  address: string | null;
  description: string | null;
  use_type: string | null;
  applicant: string | null;
  application_type: string | null;
  lodged_date: string | null; // YYYY-MM-DD
  decision_status: string | null;
  url: string | null;
  matched_keywords: string[];
}

export interface ScanResult {
  source: string;
  fetched: number;
  matched: number;
  leads: DaLead[];
  error?: string;
}

// Phase-1 verticals (childcare + fitout builders) plus opportunistic
// adjacents. Matched against use-type + description + application-type.
const KEYWORD_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "childcare", re: /child\s?care|kindergarten|early (learning|education)/i },
  { label: "medical", re: /health care|medical centre|dental|veterinary|pharmacy/i },
  { label: "gym", re: /\bgym\b|fitness|indoor sport/i },
  { label: "fitout", re: /fit-?out|shopfit/i },
  { label: "food-retail", re: /food and drink|restaurant|caf[eé]/i },
  { label: "commercial", re: /commercial premises|shopping centre|\boffice\b/i },
];

export function matchKeywords(haystack: string): string[] {
  return KEYWORD_PATTERNS.filter((k) => k.re.test(haystack)).map((k) => k.label);
}

function toIsoDate(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v);
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  const epoch = /\/Date\((\d+)/.exec(s);
  if (epoch) return new Date(Number(epoch[1])).toISOString().slice(0, 10);
  const parsed = Date.parse(s);
  return isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

const FETCH_OPTS: RequestInit = {
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "CentrefitCRM-DA-Scanner/1.0 (admin@centrefit.com.au)",
  },
  // Council endpoints can be slow — cap each at 30s so one hang doesn't eat
  // the cron budget.
  signal: AbortSignal.timeout(30_000),
};

// ── Development.i classic (Brisbane / Ipswich / Redland) ────────────────────

const DEVELOPMENTI_HOSTS: { source: string; host: string }[] = [
  { source: "brisbane", host: "developmenti.brisbane.qld.gov.au" },
  { source: "ipswich", host: "developmenti.ipswich.qld.gov.au" },
  { source: "redland", host: "developmenti.redland.qld.gov.au" },
];

async function scanDevelopmenti(source: string, host: string, sinceMs: number): Promise<ScanResult> {
  const body = {
    Progress: "all",
    StartDateUnixEpochNumber: sinceMs,
    EndDateUnixEpochNumber: Date.now(),
    DateRangeField: "submitted",
    SortField: "submitted",
    SortAscending: false,
    PagingStartIndex: 0,
    MaxRecords: 200,
    ShowCode: true,
    ShowImpact: true,
    ShowOther: true,
    ShowIAGA: true,
    ShowIAGI: true,
    ShowRequest: true,
    ShowNotifiableCode: true,
    ShowReferralResponse: true,
    IncludeAroundMe: false,
    PixelWidth: 800,
    PixelHeight: 800,
  };
  const res = await fetch(`https://${host}/Geo/GetApplicationFilterResults`, {
    ...FETCH_OPTS,
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const features: Record<string, unknown>[] = (
    Array.isArray(data) ? data : data?.features ?? data?.Features ?? []
  ).map((f: Record<string, unknown>) => (f?.properties as Record<string, unknown>) ?? f);

  const leads: DaLead[] = [];
  for (const p of features) {
    const appNo = str(p.application_number) ?? str(p.applicationNumber);
    if (!appNo) continue;
    const description = str(p.description);
    const useType = [str(p.uselevel1), str(p.uselevel2)].filter(Boolean).join(" / ") || null;
    const haystack = [useType, description, str(p.application_type), str(p.category_desc)]
      .filter(Boolean)
      .join(" ");
    const matched = matchKeywords(haystack);
    if (matched.length === 0) continue;
    leads.push({
      source,
      application_number: appNo,
      // Development.i packs "ADDRESS - description - applicant" into one field;
      // the address is reliably the first segment.
      address: description ? description.split(" - ")[0]?.trim() || null : null,
      description,
      use_type: useType,
      applicant: null, // often embedded in description; no discrete field
      application_type: str(p.application_type) ?? str(p.category_desc),
      lodged_date: toIsoDate(p.date_received),
      decision_status: str(p.progress) ?? str(p.decision_desc),
      // Raw concatenation, NO encoding — Development.i's filter parser wants
      // literal slashes in refs like 1077/2020/MAMC/E (PlanningAlerts format).
      url: `https://${host}/Home/FilterDirect?filters=DANumber=${appNo}`,
      matched_keywords: matched,
    });
  }
  return { source, fetched: features.length, matched: leads.length, leads };
}

// ── Gold Coast (Development.i, newer build) ─────────────────────────────────

async function scanGoldCoast(sinceMs: number): Promise<ScanResult> {
  const source = "goldcoast";
  const host = "developmenti.goldcoast.qld.gov.au";
  const collected: Record<string, unknown>[] = [];
  // Server-side date filter is unreliable — page newest-first and cut locally.
  for (let page = 0; page < 5; page++) {
    const res = await fetch(`https://${host}/Home/ApplicationFilterCSVPaged`, {
      ...FETCH_OPTS,
      method: "POST",
      body: JSON.stringify({
        Progress: "all",
        IncludeDA: true,
        IncludeBA: false,
        IncludePlumb: false,
        SortField: "submitted",
        SortAscending: false,
        PagingStartIndex: page * 200,
        MaxRecords: 200,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rows: Record<string, unknown>[] = Array.isArray(data)
      ? data
      : data?.applications ?? data?.rows ?? data?.Results ?? data?.results ?? [];
    if (rows.length === 0) break;
    collected.push(...rows);
    const oldest = rows[rows.length - 1];
    const oldestMs = Number(oldest?.dateReceived ?? oldest?.DateReceived ?? NaN);
    if (Number.isFinite(oldestMs) && oldestMs < sinceMs) break;
  }

  const leads: DaLead[] = [];
  for (const p of collected) {
    const receivedMs = Number(p.dateReceived ?? p.DateReceived ?? NaN);
    if (Number.isFinite(receivedMs) && receivedMs < sinceMs) continue;
    const appNo = str(p.ramId) ?? str(p.applicationNumber) ?? str(p.appNo);
    if (!appNo) continue;
    const useType =
      [str(p.useLevel1), str(p.useLevel2)].filter(Boolean).join(" / ") || null;
    const description = str(p.description);
    const haystack = [useType, description, str(p.applicationType)].filter(Boolean).join(" ");
    const matched = matchKeywords(haystack);
    if (matched.length === 0) continue;
    leads.push({
      source,
      application_number: appNo,
      address: description,
      description,
      use_type: useType,
      applicant: null,
      application_type: str(p.applicationType),
      lodged_date: Number.isFinite(receivedMs) ? toIsoDate(receivedMs) : null,
      decision_status: str(p.stage),
      url: `https://${host}/Home/FilterDirect?filters=DANumber=${appNo}`,
      matched_keywords: matched,
    });
  }
  return { source, fetched: collected.length, matched: leads.length, leads };
}

// ── Logan (DevET) ───────────────────────────────────────────────────────────

async function scanLogan(sinceMs: number): Promise<ScanResult> {
  const source = "logan";
  const from = new Date(sinceMs).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  // Live shape (verified 2026-07-28): { pagination: {total…}, data: [rows] },
  // rows carry propertyFmtAddress / applicationClass / applicant /
  // lodgementDate. ~400 lodgements a week → page through.
  const rows: Record<string, unknown>[] = [];
  for (let page = 1; page <= 5; page++) {
    const url =
      `https://council-api-proxy.lcc.wspdigital.com/pdonline/applications` +
      `?lodgeDateFrom=${from}&lodgeDateTo=${to}&pageOffset=${page}&pageLimit=100&sortColumn=appNo&sortDesc=1`;
    const res = await fetch(url, FETCH_OPTS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const batch: Record<string, unknown>[] = Array.isArray(data)
      ? data
      : data?.data ?? data?.applications ?? data?.items ?? data?.results ?? [];
    if (batch.length === 0) break;
    rows.push(...batch);
    const total = Number((data?.pagination as Record<string, unknown>)?.total ?? NaN);
    if (Number.isFinite(total) && rows.length >= total) break;
  }

  const leads: DaLead[] = [];
  for (const p of rows) {
    const appNo = str(p.appNo) ?? str(p.applicationNumber);
    if (!appNo) continue;
    const address =
      str(p.propertyFmtAddress) ??
      ([p.propertyStreetNo, p.propertyStreetName, p.propertySuburb, p.propertyPostCode]
        .map(str)
        .filter(Boolean)
        .join(" ") || null);
    const haystack = [str(p.landUse), str(p.description), str(p.applicationClass), str(p.developmentType)]
      .filter(Boolean)
      .join(" ");
    const matched = matchKeywords(haystack);
    if (matched.length === 0) continue;
    leads.push({
      source,
      application_number: appNo,
      address,
      description: str(p.description),
      use_type: str(p.landUse),
      applicant: str(p.applicant),
      application_type: str(p.applicationClass) ?? str(p.developmentType),
      lodged_date: toIsoDate(p.lodgementDate),
      decision_status: str(p.decisionStatus),
      // DevET's per-application hash route uses slash-form refs
      // (BW-11870-2026 → BW/11870/2026) — PlanningAlerts' Logan format.
      url: `https://devet.loganhub.com.au/#/applications/${appNo.replace(/-/g, "/")}`,
      matched_keywords: matched,
    });
  }
  return { source, fetched: rows.length, matched: leads.length, leads };
}

// ── Moreton Bay (DA Tracker) ────────────────────────────────────────────────

async function scanMoretonBay(sinceMs: number): Promise<ScanResult> {
  const source = "moretonbay";
  const url =
    `https://api.moretonbay.qld.gov.au/mplu/da/search/advanced` +
    `?searchType=advanced&propertyType=address&dateRange=custom&start=${sinceMs}&end=${Date.now()}`;
  const res = await fetch(url, FETCH_OPTS);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const rows: Record<string, unknown>[] = Array.isArray(data)
    ? data
    : data?.results ?? data?.records ?? data?.data ?? [];

  // The endpoint ignores its date params and returns everything newest-first
  // (verified 2026-07-28: 5000 rows, sorted desc) — cut client-side.
  const leads: DaLead[] = [];
  let considered = 0;
  for (const p of rows) {
    const lodgedMs = Date.parse(String(p.lodgedDate ?? ""));
    if (Number.isFinite(lodgedMs) && lodgedMs < sinceMs) break; // sorted desc
    considered++;
    const appNo = str(p.fileId) ?? str(p.applicationId);
    if (!appNo) continue;
    const numericId = str(p.applicationId);
    const description = str(p.description);
    const haystack = [description, str(p.formattedTitle), str(p.applicationType)]
      .filter(Boolean)
      .join(" ");
    const matched = matchKeywords(haystack);
    if (matched.length === 0) continue;
    leads.push({
      source,
      application_number: appNo,
      address: str(p.primaryPropertyAddress),
      description,
      use_type: null,
      applicant: null,
      application_type: str(p.applicationType),
      lodged_date: toIsoDate(p.lodgedDate),
      decision_status: str(p.status),
      // Per-application page needs the NUMERIC id, not the DA/YYYY/N file ref.
      url: numericId
        ? `https://www.moretonbay.qld.gov.au/Services/Building-Development/DA-Tracker/${numericId}`
        : "https://www.moretonbay.qld.gov.au/Services/Building-Development/DA-Tracker",
      matched_keywords: matched,
    });
  }
  return { source, fetched: considered, matched: leads.length, leads };
}

// ── Orchestrator ────────────────────────────────────────────────────────────

/** Scan every council for DAs lodged in the trailing `lookbackDays`. Each
 * council is independent — one failing feed reports an error but never kills
 * the run. */
export async function scanAllCouncils(lookbackDays: number): Promise<ScanResult[]> {
  const sinceMs = Date.now() - lookbackDays * 86400000;
  const jobs: Promise<ScanResult>[] = [
    ...DEVELOPMENTI_HOSTS.map(({ source, host }) =>
      scanDevelopmenti(source, host, sinceMs).catch((err) => ({
        source,
        fetched: 0,
        matched: 0,
        leads: [],
        error: err instanceof Error ? err.message : String(err),
      })),
    ),
    scanGoldCoast(sinceMs).catch((err) => ({
      source: "goldcoast", fetched: 0, matched: 0, leads: [],
      error: err instanceof Error ? err.message : String(err),
    })),
    scanLogan(sinceMs).catch((err) => ({
      source: "logan", fetched: 0, matched: 0, leads: [],
      error: err instanceof Error ? err.message : String(err),
    })),
    scanMoretonBay(sinceMs).catch((err) => ({
      source: "moretonbay", fetched: 0, matched: 0, leads: [],
      error: err instanceof Error ? err.message : String(err),
    })),
  ];
  return Promise.all(jobs);
}
