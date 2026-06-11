"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { flattenRows } from "./format";

/**
 * Run an nbn™ diagnostic against this service (AVC) from inside the CRM —
 * the Rev3 support superpower. After firing, polls the test until Kinetix
 * returns a result and renders it inline (times in Brisbane).
 */

const POLL_MS = 6_000;
const POLL_MAX = 30; // ~3 minutes

export function RunTest({ serviceRef, testTypes }: { serviceRef: string; testTypes: string[] }) {
  const router = useRouter();
  const [test, setTest] = useState(testTypes[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const pollSeq = useRef(0);

  async function rev3(action: string, params: Record<string, unknown>) {
    const res = await fetch("/api/nbn/rev3", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, params, testingMode: false }),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error ?? "Request failed");
    return json.result;
  }

  function looksFinished(r: unknown): boolean {
    const s = JSON.stringify(r ?? {});
    if (/"(state|status)"\s*:\s*"(complete|completed|success|successful|finished|failed|error)"/i.test(s)) return true;
    // a measurements/result block appearing also counts
    return /"(testResult|results|measurement)/i.test(s);
  }

  async function pollResult(testRef: string) {
    const seq = ++pollSeq.current;
    for (let i = 0; i < POLL_MAX; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (seq !== pollSeq.current) return; // superseded by a newer run
      try {
        const r = await rev3("diagnostics.get", { test_ref: testRef });
        setResult(r);
        if (looksFinished(r)) {
          setMsg(`Test ${testRef} finished.`);
          router.refresh();
          return;
        }
        setMsg(`Test ${testRef} running… (checking every ${POLL_MS / 1000}s)`);
      } catch {
        // transient — keep polling
      }
    }
    setMsg(`Test ${testRef} is still running after 3 minutes — refresh the page later to see the result.`);
  }

  async function run() {
    if (!test) return;
    if (!confirm(`Run "${test}" against ${serviceRef}?\n\nNote: some tests (e.g. Metallic Line Test, resets) can briefly interrupt the service.`)) return;
    setBusy(true);
    setMsg(null);
    setError(null);
    setResult(null);
    try {
      const params: Record<string, unknown> = { avc_ref: serviceRef, test };
      if (test === "Line Quality Diagnostic") { params.resync_type = "No Resync"; params.monitoring_duration = 6; }
      if (test === "Network Performance Test") params.traffic_class = "TC-2";
      if (test === "Single End Line Test") params.force_measurement = false;
      const json = await rev3("diagnostics.run", params);
      const id = (json as { id?: string })?.id;
      if (id) {
        setMsg(`Test requested — ${id}. Waiting for the result…`);
        void pollResult(id);
      } else {
        setResult(json);
        setMsg("Test response received.");
      }
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
      {result != null && (
        <div className="mt-3 rounded-md border border-border bg-background/50 p-3">
          <h4 className="text-[11px] font-semibold mb-2">Result</h4>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11px]">
            {flattenRows(result).map(([k, v], i) => (
              <div key={`${k}-${i}`} className="contents">
                <dt className="text-muted-foreground font-mono">{k}</dt>
                <dd className="truncate" title={v}>{v}</dd>
              </div>
            ))}
          </dl>
          <details className="mt-2">
            <summary className="cursor-pointer text-[10px] text-subtle hover:text-muted-foreground">raw</summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted/30 p-2 text-[10px]">{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
