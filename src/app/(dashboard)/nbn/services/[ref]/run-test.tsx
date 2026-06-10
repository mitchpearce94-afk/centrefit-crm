"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Run an nbn™ diagnostic against this service (AVC) from inside the CRM —
 * the Rev3 support superpower. Test types come from the eligible-types
 * lookup on the server page. Runs live by default (that's the point of a
 * line test); results land back on this page after a refresh.
 */
export function RunTest({ serviceRef, testTypes }: { serviceRef: string; testTypes: string[] }) {
  const router = useRouter();
  const [test, setTest] = useState(testTypes[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!test) return;
    if (!confirm(`Run "${test}" against ${serviceRef}?\n\nNote: some tests (e.g. Metallic Line Test, resets) can briefly interrupt the service.`)) return;
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const params: Record<string, unknown> = { avc_ref: serviceRef, test };
      if (test === "Line Quality Diagnostic") { params.resync_type = "No Resync"; params.monitoring_duration = 6; }
      if (test === "Network Performance Test") params.traffic_class = "TC-2";
      if (test === "Single End Line Test") params.force_measurement = false;
      const res = await fetch("/api/nbn/rev3", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "diagnostics.run", params, testingMode: false }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? "Test request failed");
      const id = (json.result as { id?: string })?.id;
      setMsg(`Test requested${id ? ` — ${id}` : ""}. Results appear under Recent Diagnostic Tests (refresh in a minute or two).`);
      setTimeout(() => router.refresh(), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-xs font-semibold mb-2">Run a diagnostic test</h3>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
          value={test}
          onChange={(e) => setTest(e.target.value)}
        >
          {testTypes.length === 0 && <option value="">No eligible test types reported</option>}
          {testTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          disabled={!test || busy}
          onClick={() => void run()}
        >
          {busy ? "Requesting…" : "Run test"}
        </button>
      </div>
      {msg && <p className="mt-2 text-[11px] text-emerald-400">{msg}</p>}
      {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}
    </div>
  );
}
