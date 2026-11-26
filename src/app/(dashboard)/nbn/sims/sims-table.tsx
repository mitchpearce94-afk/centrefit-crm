"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import type { SiteOption } from "@/lib/jasper/links";
import { SimStatusBadge, formatBytesClient } from "./sim-ui";

export interface SimRow {
  iccid: string;
  msisdn: string | null;
  status: string | null;
  ratePlan: string | null;
  customer: string | null;
  dateActivated: string | null;
  dataBytes: number | null;
  overage: boolean;
  linked: { assetId: string; siteId: string; siteName: string; deviceName: string | null } | null;
  suggested: { assetId: string; siteId: string; siteName: string; serial: string | null } | null;
}

type Filter = "all" | "activated" | "unlinked" | "other";

export function SimsTable({ rows, sites, canLink }: { rows: SimRow[]; sites: SiteOption[]; canLink: boolean }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "activated" && r.status !== "ACTIVATED") return false;
      if (filter === "unlinked" && r.linked) return false;
      if (filter === "other" && r.status === "ACTIVATED") return false;
      if (!needle) return true;
      const hay = [r.iccid, r.msisdn, r.status, r.ratePlan, r.customer, r.linked?.siteName, r.linked?.deviceName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q, filter]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by site, phone, ICCID, plan…"
          className="w-full sm:w-72 rounded-md border border-border bg-input px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex gap-1">
          {(
            [
              ["all", "All"],
              ["activated", "Activated"],
              ["unlinked", "Unlinked"],
              ["other", "Not active"],
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={`rounded-full px-3 py-1 text-[11px] font-medium border transition-colors ${
                filter === k ? "bg-primary/15 text-foreground border-primary/40" : "text-muted-foreground border-border hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Site</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">ICCID</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Plan</th>
              <th className="px-3 py-2 text-right">Data (cycle)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No SIMs match.
                </td>
              </tr>
            )}
            {visible.map((r) => (
              <tr key={r.iccid} className="hover:bg-accent/20">
                <td className="px-3 py-2 align-top">
                  <SiteCell row={r} sites={sites} canLink={canLink} />
                </td>
                <td className="px-3 py-2 font-mono text-xs align-top">{r.msisdn ?? "—"}</td>
                <td className="px-3 py-2 align-top">
                  <Link href={`/nbn/sims/${encodeURIComponent(r.iccid)}`} className="font-mono text-xs underline decoration-dotted underline-offset-2 hover:text-primary">
                    {r.iccid}
                  </Link>
                </td>
                <td className="px-3 py-2 align-top">
                  <SimStatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2 text-xs align-top">{r.ratePlan ?? "—"}</td>
                <td className={`px-3 py-2 text-right text-xs font-mono align-top ${r.overage ? "text-amber-400" : ""}`}>
                  {formatBytesClient(r.dataBytes)}
                  {r.overage && <span className="ml-1" title="Overage limit reached">⚠</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SiteCell({ row, sites, canLink }: { row: SimRow; sites: SiteOption[]; canLink: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [siteId, setSiteId] = useState("");

  async function link(body: { siteId?: string; assetId?: string }) {
    setBusy(true);
    try {
      const res = await fetch(`/api/sims/${encodeURIComponent(row.iccid)}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, msisdn: row.msisdn }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast(`Linked to ${data.siteName ?? "site"}`);
      setPicking(false);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Link failed", "error");
    } finally {
      setBusy(false);
    }
  }

  if (row.linked) {
    return (
      <div>
        <Link href={`/sites/${row.linked.siteId}`} className="font-medium hover:underline">
          {row.linked.siteName}
        </Link>
        {row.linked.deviceName && <div className="text-[11px] text-muted-foreground">{row.linked.deviceName}</div>}
      </div>
    );
  }

  if (!canLink) return <span className="text-xs text-muted-foreground">Unlinked</span>;

  if (picking) {
    return (
      <div className="flex items-center gap-1.5">
        <select
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
          className="max-w-[220px] rounded-md border border-border bg-input px-2 py-1 text-xs"
          autoFocus
        >
          <option value="">Choose a site…</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.customerName && s.customerName !== s.name ? ` · ${s.customerName}` : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!siteId || busy}
          onClick={() => link({ siteId })}
          className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "…" : "Link"}
        </button>
        <button type="button" onClick={() => setPicking(false)} className="text-xs text-muted-foreground hover:text-foreground">
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {row.suggested && (
        <button
          type="button"
          disabled={busy}
          onClick={() => link({ assetId: row.suggested!.assetId })}
          className="text-left text-xs text-amber-300 hover:underline disabled:opacity-50"
          title={`SIM asset at this site has serial ${row.suggested.serial ?? "?"} — matches this SIM's phone number`}
        >
          Looks like {row.suggested.siteName} — confirm
        </button>
      )}
      <button type="button" onClick={() => setPicking(true)} className="text-left text-xs text-muted-foreground underline decoration-dotted hover:text-foreground">
        Link to a site…
      </button>
    </div>
  );
}
