// Server-side client for the Cisco Jasper Control Centre REST API — the
// platform behind Centrefit's M2M One SIMs (Optus + Telstra). Credentials come
// from env vars only — never expose to the browser.
//
//   JASPER_USERNAME      Control Centre login (the user who generated the key)
//   JASPER_REST_API_KEY  per-user key: Control Centre → user menu → Generate REST API Key
//   JASPER_BASE_URL      optional; M2M One's instance is restapi-telstra.jasper.com
//                        for both carriers (per their "API Integration" PDF, Nov 2026)
//
// Auth is HTTP Basic over "<username>:<api key>". Errors come back as
// { errorMessage, errorCode } with a non-2xx status. The device list only
// returns ICCIDs (and needs `modifiedSince`), so every human-readable column
// is a per-device GET — cached via the Next data cache and tagged so a plan or
// status change can bust just that SIM.

import { revalidateTag } from "next/cache";

const BASE_URL = (process.env.JASPER_BASE_URL ?? "https://restapi-telstra.jasper.com/rws/api/v1").replace(/\/$/, "");
const PAGE_SIZE = 50;
const MAX_PAGES = 60; // 3,000 SIMs — far beyond the fleet
const EPOCH = "2000-01-01T00:00:00Z";

export const JASPER_TAG = "jasper";
export const deviceTag = (iccid: string) => `jasper-device-${iccid}`;

export function isJasperConfigured(): boolean {
  return Boolean(process.env.JASPER_USERNAME && process.env.JASPER_REST_API_KEY);
}

export class JasperError extends Error {
  status: number;
  detail: unknown;
  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = "JasperError";
    this.status = status;
    this.detail = detail;
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new JasperError(`Missing env var: ${name}`, 500);
  return v;
}

function authHeaders(): HeadersInit {
  const token = Buffer.from(`${requireEnv("JASPER_USERNAME")}:${requireEnv("JASPER_REST_API_KEY")}`).toString("base64");
  return { Authorization: `Basic ${token}`, Accept: "application/json" };
}

async function handle<T>(res: Response, label: string): Promise<T> {
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new JasperError(`Jasper ${label}: non-JSON response: ${text.slice(0, 200)}`, res.status || 502);
    }
  }
  if (!res.ok) {
    const obj = (parsed ?? {}) as { errorMessage?: string; errorCode?: string; message?: string };
    const msg = obj.errorMessage || obj.message || `Jasper ${label} failed (HTTP ${res.status})`;
    throw new JasperError(obj.errorCode ? `${msg} (${obj.errorCode})` : msg, res.status, parsed);
  }
  return parsed as T;
}

export async function jasperGet<T = unknown>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
  cache: { revalidate: number; tags?: string[] } | "no-store" = "no-store",
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: authHeaders(),
    ...(cache === "no-store"
      ? { cache: "no-store" as const }
      : { next: { revalidate: cache.revalidate, tags: [JASPER_TAG, ...(cache.tags ?? [])] } }),
  });
  return handle<T>(res, `GET ${path}`);
}

export async function jasperSend<T = unknown>(method: "PUT" | "POST", path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<T>(res, `${method} ${path}`);
}

/* ── Types ─────────────────────────────────────────────────────────── */

export const DEVICE_STATUSES = [
  "ACTIVATED",
  "DEACTIVATED",
  "ACTIVATION_READY",
  "TEST_READY",
  "INVENTORY",
  "RETIRED",
  "PURGED",
  "REPLACED",
] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export interface JasperDevice {
  iccid: string;
  imsi?: string;
  msisdn?: string;
  imei?: string;
  status?: DeviceStatus | string;
  ratePlan?: string;
  communicationPlan?: string;
  customer?: string;
  endConsumerId?: string;
  dateActivated?: string;
  dateAdded?: string;
  dateUpdated?: string;
  dateShipped?: string;
  accountId?: string;
  fixedIPAddress?: string;
  simNotes?: string;
  deviceID?: string;
  modemID?: string;
  globalSimType?: string;
  euiccid?: string;
  operatorCustom1?: string;
  operatorCustom2?: string;
  accountCustom1?: string;
  accountCustom2?: string;
  accountCustom3?: string;
  customerCustom1?: string;
  customerCustom2?: string;
  customerCustom3?: string;
  [key: string]: unknown;
}

export interface JasperUsage {
  iccid: string;
  /** Cycle-to-date data in bytes. */
  ctdDataUsage?: number;
  ctdSMSUsage?: number;
  ctdVoiceUsage?: number;
  ctdSessionCount?: number;
  overageLimitReached?: boolean;
  overageLimitOverride?: string;
}

export interface JasperSession {
  iccid: string;
  ipAddress?: string;
  dateSessionStarted?: string;
  dateSessionEnded?: string;
}

export interface JasperAuditEntry {
  date?: string;
  user?: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  [key: string]: unknown;
}

/* ── Reads ─────────────────────────────────────────────────────────── */

/** Every ICCID on the account. Jasper insists on `modifiedSince`; the epoch means "all". */
export async function listDeviceIccids(status?: DeviceStatus): Promise<string[]> {
  const out: string[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await jasperGet<{ devices?: Array<{ iccid: string }>; lastPage?: boolean }>(
      "/devices",
      { modifiedSince: EPOCH, pageSize: PAGE_SIZE, pageNumber: page, status },
      { revalidate: 300 },
    );
    const items = data.devices ?? [];
    for (const d of items) if (d?.iccid) out.push(String(d.iccid));
    if (data.lastPage !== false || items.length < PAGE_SIZE) break;
  }
  return out;
}

export function fetchDevice(iccid: string) {
  return jasperGet<JasperDevice>(`/devices/${encodeURIComponent(iccid)}`, undefined, {
    revalidate: 300,
    tags: [deviceTag(iccid)],
  });
}

export function fetchDeviceUsage(iccid: string) {
  return jasperGet<JasperUsage>(`/devices/${encodeURIComponent(iccid)}/ctdUsages`, undefined, {
    revalidate: 300,
    tags: [deviceTag(iccid)],
  });
}

export function fetchSessionInfo(iccid: string) {
  return jasperGet<JasperSession>(`/devices/${encodeURIComponent(iccid)}/sessionInfo`, undefined, {
    revalidate: 120,
    tags: [deviceTag(iccid)],
  });
}

/** Best effort — not every instance exposes audit trails. */
export async function fetchAuditTrails(iccid: string): Promise<JasperAuditEntry[]> {
  try {
    const data = await jasperGet<{ auditTrails?: JasperAuditEntry[] }>(
      `/devices/${encodeURIComponent(iccid)}/auditTrails`,
      { since: EPOCH },
      { revalidate: 300, tags: [deviceTag(iccid)] },
    );
    return data.auditTrails ?? [];
  } catch {
    return [];
  }
}

/** Best effort — rate plan listing needs an account-level permission some users lack. */
export async function listRatePlanNames(): Promise<string[]> {
  try {
    const data = await jasperGet<{ ratePlans?: Array<{ name?: string }> }>("/ratePlans", undefined, { revalidate: 3600 });
    return (data.ratePlans ?? []).map((p) => p.name).filter((n): n is string => Boolean(n));
  } catch {
    return [];
  }
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface SimSnapshot {
  device: JasperDevice;
  usage: JasperUsage | null;
}

/** Full fleet: list → per-device detail + cycle usage (6 at a time). */
export async function fetchFleet(): Promise<SimSnapshot[]> {
  const iccids = await listDeviceIccids();
  return pool(iccids, 6, async (iccid) => {
    const [device, usage] = await Promise.all([
      fetchDevice(iccid),
      fetchDeviceUsage(iccid).catch(() => null),
    ]);
    return { device, usage };
  });
}

/* ── Writes ────────────────────────────────────────────────────────── */

export interface DeviceUpdate {
  status?: DeviceStatus;
  ratePlan?: string;
  communicationPlan?: string;
}

/** PUT /devices/{iccid} — change plan and/or status, then bust that SIM's cache. */
export async function updateDevice(iccid: string, update: DeviceUpdate): Promise<void> {
  const body: Record<string, string> = {};
  if (update.status) body.status = update.status;
  if (update.ratePlan) body.ratePlan = update.ratePlan;
  if (update.communicationPlan) body.communicationPlan = update.communicationPlan;
  if (Object.keys(body).length === 0) throw new JasperError("Nothing to update", 400);
  await jasperSend("PUT", `/devices/${encodeURIComponent(iccid)}`, body);
  revalidateTag(deviceTag(iccid), "max");
  revalidateTag(JASPER_TAG, "max");
}

/* ── Helpers ───────────────────────────────────────────────────────── */

/** "61478309731" / "+61 478 309 731" / "0478309731" → "0478309731". */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("61") && digits.length === 11) return `0${digits.slice(2)}`;
  if (digits.length === 9 && digits.startsWith("4")) return `0${digits}`;
  return digits;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function statusTone(status: string | undefined): "good" | "warn" | "bad" | "muted" {
  switch (status) {
    case "ACTIVATED":
      return "good";
    case "ACTIVATION_READY":
    case "TEST_READY":
      return "warn";
    case "DEACTIVATED":
      return "bad";
    default:
      return "muted";
  }
}
