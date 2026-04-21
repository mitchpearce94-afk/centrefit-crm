"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

interface Connection {
  id: string;
  tenant_name: string | null;
  tenant_id: string;
  expires_at: string;
  last_sync_at: string | null;
  last_sync_result: any;
  created_at: string;
}

type SyncSummary = {
  synced: number;
  created: number;
  updated: number;
  skipped: number;
  total?: number;
  errors: { sku: string; name: string; message: string }[];
};

export function IntegrationsPanel({
  connection,
  productCount,
  syncedCount,
  initialFlash,
}: {
  connection: Connection | null;
  productCount: number;
  syncedCount: number;
  initialFlash: { type: "success" | "error"; message: string } | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [flash, setFlash] = useState(initialFlash);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<SyncSummary | null>(
    (connection?.last_sync_result as SyncSummary | null) ?? null
  );

  async function handleSync() {
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch("/api/xero/sync-products", { method: "POST" });
      const json = await res.json();
      if (!res.ok || json.error) {
        toast(json.error ?? "Sync failed", "error");
      } else {
        setLastResult(json.summary as SyncSummary);
        toast(
          `Synced ${json.summary.synced} products (${json.summary.created} new, ${json.summary.updated} updated)`
        );
        router.refresh();
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Sync failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect from Xero? You'll need to reconnect to sync again.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/xero/disconnect", { method: "POST" });
      const json = await res.json();
      if (!res.ok || json.error) {
        toast(json.error ?? "Disconnect failed", "error");
      } else {
        toast("Disconnected from Xero");
        router.refresh();
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Disconnect failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {flash && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            flash.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          }`}
        >
          {flash.message}
        </div>
      )}

      {/* Xero card */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Xero</h2>
              {connection ? (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                  Connected
                </span>
              ) : (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  Not connected
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Two-way sync for products, invoices, contacts, and purchase orders.
            </p>
            {connection && (
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                <p>
                  Organisation:{" "}
                  <span className="text-foreground font-medium">
                    {connection.tenant_name ?? connection.tenant_id}
                  </span>
                </p>
                <p>
                  Products synced:{" "}
                  <span className="text-foreground font-mono">
                    {syncedCount} / {productCount}
                  </span>
                </p>
                {connection.last_sync_at && (
                  <p>
                    Last sync:{" "}
                    {new Date(connection.last_sync_at).toLocaleString("en-AU")}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 gap-2">
            {connection ? (
              <>
                <button
                  onClick={handleSync}
                  disabled={busy}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy ? "Syncing..." : "Sync Products"}
                </button>
                <button
                  onClick={handleDisconnect}
                  disabled={busy}
                  className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <a
                href="/api/xero/connect"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Connect to Xero
              </a>
            )}
          </div>
        </div>

        {/* Last sync summary */}
        {lastResult && (
          <div className="mt-5 rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Last sync result
            </p>
            <div className="mt-2 grid grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Synced</p>
                <p className="font-mono font-medium">{lastResult.synced}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Created</p>
                <p className="font-mono font-medium">{lastResult.created}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Updated</p>
                <p className="font-mono font-medium">{lastResult.updated}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Skipped</p>
                <p className="font-mono font-medium">{lastResult.skipped}</p>
              </div>
            </div>
            {lastResult.errors?.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-red-400">
                  {lastResult.errors.length} error{lastResult.errors.length === 1 ? "" : "s"}
                </summary>
                <div className="mt-2 max-h-48 overflow-y-auto rounded bg-background p-2 text-[11px]">
                  {lastResult.errors.map((e, i) => (
                    <div key={i} className="border-b border-border py-1 last:border-0">
                      <span className="font-mono">{e.sku}</span>{" "}
                      <span className="text-muted-foreground">— {e.name}</span>
                      <p className="text-red-400 mt-0.5">{e.message}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {/* Setup hint */}
        {!connection && (
          <details className="mt-4 text-xs text-muted-foreground">
            <summary className="cursor-pointer">First-time setup</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>Register an OAuth 2.0 app at <span className="font-mono">developer.xero.com/app/manage</span></li>
              <li>Set the redirect URI to <span className="font-mono">{typeof window !== "undefined" ? window.location.origin : ""}/api/xero/callback</span></li>
              <li>Copy the Client ID and Client Secret into the CRM env vars (<span className="font-mono">XERO_CLIENT_ID</span>, <span className="font-mono">XERO_CLIENT_SECRET</span>)</li>
              <li>Redeploy, then click Connect to Xero</li>
            </ol>
          </details>
        )}
      </div>
    </div>
  );
}
