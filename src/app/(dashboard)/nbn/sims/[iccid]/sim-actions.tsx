"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import type { SiteOption } from "@/lib/jasper/links";

const STATUS_OPTIONS = ["ACTIVATED", "DEACTIVATED", "ACTIVATION_READY", "TEST_READY", "INVENTORY", "RETIRED"] as const;

const inputClass =
  "w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";
const primaryBtn = "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50";
const ghostBtn = "rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50";

export function SimActions(props: {
  iccid: string;
  msisdn: string | null;
  status: string | null;
  ratePlan: string | null;
  knownPlans: string[];
  linked: { assetId: string; siteId: string; siteName: string } | null;
  suggested: { assetId: string; siteName: string; serial: string | null } | null;
  sites: SiteOption[];
  canManage: boolean;
  canLink: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [plan, setPlan] = useState(props.ratePlan ?? "");
  const [status, setStatus] = useState(props.status ?? "");
  const [siteId, setSiteId] = useState(props.linked?.siteId ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  async function call(label: string, url: string, init: RequestInit, okMsg: string) {
    setBusy(label);
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast(okMsg);
      router.refresh();
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : `${label} failed`, "error");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const base = `/api/sims/${encodeURIComponent(props.iccid)}`;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Site</h3>
        {props.linked ? (
          <div className="mt-2 text-sm">
            <div className="font-medium">{props.linked.siteName}</div>
            {props.canLink && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  if (!confirm(`Unlink this SIM from ${props.linked!.siteName}? The asset stays; only the ICCID is cleared.`)) return;
                  void call("Unlink", `${base}/link`, { method: "DELETE" }, "Unlinked");
                }}
                className={`${ghostBtn} mt-2`}
              >
                {busy === "Unlink" ? "…" : "Unlink"}
              </button>
            )}
          </div>
        ) : !props.canLink ? (
          <p className="mt-2 text-xs text-muted-foreground">Not linked. You need the manage-assets permission to link it.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {props.suggested && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  call("Link", `${base}/link`, { method: "POST", body: JSON.stringify({ assetId: props.suggested!.assetId, msisdn: props.msisdn }) }, `Linked to ${props.suggested!.siteName}`)
                }
                className="w-full rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-200 hover:bg-amber-500/15 disabled:opacity-50"
              >
                <div className="font-medium">Looks like {props.suggested.siteName}</div>
                <div className="text-[11px] text-amber-200/70">
                  Its SIM asset has serial {props.suggested.serial ?? "?"} — same number as this SIM. Tap to confirm.
                </div>
              </button>
            )}
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={inputClass}>
              <option value="">Choose a site…</option>
              {props.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.customerName && s.customerName !== s.name ? ` · ${s.customerName}` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!siteId || busy !== null}
              onClick={() => call("Link", `${base}/link`, { method: "POST", body: JSON.stringify({ siteId, msisdn: props.msisdn }) }, "Linked")}
              className={primaryBtn}
            >
              {busy === "Link" ? "…" : "Link to site"}
            </button>
            <p className="text-[11px] text-muted-foreground">
              Uses the site&rsquo;s existing SIM-card asset if it has one without an ICCID, otherwise adds one.
            </p>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rate plan</h3>
        {props.canManage ? (
          <div className="mt-2 space-y-2">
            <input list="sim-rate-plans" value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="e.g. M2M One - 10GB Plan (PAYG)" className={`${inputClass} text-xs`} />
            <datalist id="sim-rate-plans">
              {props.knownPlans.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <button
              type="button"
              disabled={!plan.trim() || plan.trim() === props.ratePlan || busy !== null}
              onClick={() => {
                if (!confirm(`Move ${props.iccid} to "${plan.trim()}"? M2M One bills the new plan from the change.`)) return;
                void call("Plan", base, { method: "PATCH", body: JSON.stringify({ ratePlan: plan.trim() }) }, "Rate plan changed");
              }}
              className={primaryBtn}
            >
              {busy === "Plan" ? "…" : "Change plan"}
            </button>
            <p className="text-[11px] text-muted-foreground">Plan names must match Control Centre exactly — pick from the list where possible.</p>
          </div>
        ) : (
          <p className="mt-2 text-sm">{props.ratePlan ?? "—"}</p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</h3>
        {props.canManage ? (
          <div className="mt-2 space-y-2">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
              {!STATUS_OPTIONS.includes(status as (typeof STATUS_OPTIONS)[number]) && <option value={status}>{status || "Unknown"}</option>}
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!status || status === props.status || busy !== null}
              onClick={() => {
                const warn =
                  status === "DEACTIVATED"
                    ? `Deactivate ${props.iccid}? The device on it loses service immediately.`
                    : `Set ${props.iccid} to ${status.replace(/_/g, " ")}?`;
                if (!confirm(warn)) return;
                void call("Status", base, { method: "PATCH", body: JSON.stringify({ status }) }, "Status changed");
              }}
              className={status === "DEACTIVATED" ? "rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50" : primaryBtn}
            >
              {busy === "Status" ? "…" : "Change status"}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-sm">{props.status?.replace(/_/g, " ") ?? "—"}</p>
        )}
      </section>
    </div>
  );
}
