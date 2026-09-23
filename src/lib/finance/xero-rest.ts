import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedClient } from "@/lib/xero/client";

// Thin REST layer over the Xero Accounting API for the finance agent.
// Why not the SDK for these calls: the agent needs the rate-limit headers on
// every response (docs/finance-CONTEXT.md D9 — the daily limit is shared with
// prod and was exhausted on 2026-09-23), paged bulk pulls, and error bodies
// that never carry request headers. getAuthedClient() still owns the token
// refresh, so the connection row stays the single source of truth.

export interface XeroLimits {
  dayRemaining: number | null;
  minuteRemaining: number | null;
  retryAfterSeconds: number | null;
  problem: string | null;
}

export class XeroRestError extends Error {
  constructor(public status: number, public body: string, public limits: XeroLimits, path: string) {
    super(`Xero ${status} on ${path.split("?")[0]}: ${body.slice(0, 200)}`);
    this.name = "XeroRestError";
  }
}

export interface XeroRest {
  tenantId: string;
  limits: XeroLimits;
  calls: number;
  get: <T = unknown>(path: string) => Promise<T>;
  post: <T = unknown>(path: string, body: unknown, idempotencyKey?: string) => Promise<T>;
}

const readLimits = (h: Headers): XeroLimits => ({
  dayRemaining: h.get("x-daylimit-remaining") != null ? Number(h.get("x-daylimit-remaining")) : null,
  minuteRemaining: h.get("x-minlimit-remaining") != null ? Number(h.get("x-minlimit-remaining")) : null,
  retryAfterSeconds: h.get("retry-after") != null ? Number(h.get("retry-after")) : null,
  problem: h.get("x-rate-limit-problem"),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function openXero(supabase: SupabaseClient): Promise<XeroRest> {
  const { client, conn } = await getAuthedClient(supabase);
  const tokenSet = client.readTokenSet();
  const accessToken = tokenSet.access_token ?? conn.access_token;
  const state: XeroRest = {
    tenantId: conn.tenant_id,
    limits: { dayRemaining: null, minuteRemaining: null, retryAfterSeconds: null, problem: null },
    calls: 0,
    get: (path) => call("GET", path),
    post: (path, body, idempotencyKey) => call("POST", path, body, idempotencyKey),
  };

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Xero-tenant-id": conn.tenant_id,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      state.calls += 1;
      state.limits = readLimits(res.headers);
      const text = await res.text();
      if (res.status === 429) {
        // Per-minute: wait it out once. Per-day: give up — nothing we can do today.
        if (state.limits.problem === "minute" && attempt < 3) {
          await sleep(((state.limits.retryAfterSeconds ?? 15) + 1) * 1000);
          continue;
        }
        throw new XeroRestError(429, text, state.limits, path);
      }
      if (!res.ok) throw new XeroRestError(res.status, text, state.limits, path);
      return (text ? JSON.parse(text) : null) as T;
    }
    throw new XeroRestError(429, "still rate-limited", state.limits, path);
  }
  return state;
}

/** True when the tenant has enough daily calls left for bulk work (D9). */
export function hasDailyHeadroom(x: XeroRest, floor: number): boolean {
  return x.limits.dayRemaining == null || x.limits.dayRemaining > floor;
}

/** Xero JSON dates come as "/Date(1700000000000+0000)/" or ISO. → YYYY-MM-DD */
export function xeroDate(v: unknown): string | null {
  if (!v) return null;
  const s = String(v);
  const m = /\/Date\((-?\d+)/.exec(s);
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
  return s.slice(0, 10);
}
export function xeroDateTime(v: unknown): string | null {
  if (!v) return null;
  const s = String(v);
  const m = /\/Date\((-?\d+)/.exec(s);
  if (m) return new Date(Number(m[1])).toISOString();
  return s;
}
