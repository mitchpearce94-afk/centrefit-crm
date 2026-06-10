import Link from "next/link";
import {
  fetchProductByServiceRef,
  fetchServiceOutages,
  fetchServiceAppointments,
  fetchDiagnosticsRecent,
  fetchDiagnosticsLatest,
  fetchDiagnosticsTestTypes,
  fetchServiceHealthLatest,
} from "@/lib/kinetix/client";

export const dynamic = "force-dynamic";

/**
 * Single NBN service cockpit — everything Rev3 shows for a service, in the
 * CRM: product detail, outages, appointments, diagnostics and health.
 * Each section fetches independently (allSettled) so one flaky endpoint
 * doesn't blank the page; raw payloads are kept in expandable sections
 * because Kinetix field shapes vary by technology.
 */
export default async function NbnServiceDetailPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  const serviceRef = decodeURIComponent(ref);

  const [product, outages, appointments, diagRecent, diagLatest, testTypes, health] =
    await Promise.allSettled([
      fetchProductByServiceRef(serviceRef),
      fetchServiceOutages(serviceRef),
      fetchServiceAppointments(serviceRef),
      fetchDiagnosticsRecent(serviceRef),
      fetchDiagnosticsLatest(serviceRef),
      fetchDiagnosticsTestTypes(serviceRef),
      fetchServiceHealthLatest(serviceRef),
    ]);

  return (
    <div>
      <div className="mb-4">
        <Link href="/nbn/services" className="text-xs text-muted-foreground hover:text-foreground">← All services</Link>
        <h2 className="text-sm font-semibold mt-1 font-mono">{serviceRef}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Live service cockpit — product, outages, appointments, diagnostics and health from Kinetix.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Product" result={product} />
        <Section title="Known outages" result={outages} emptyHint="No known outages for this service." />
        <Section title="Appointments" result={appointments} emptyHint="No appointments recorded for this service." />
        <Section title="Latest diagnostic result" result={diagLatest} emptyHint="No diagnostic tests have been run." />
        <Section title="Recent diagnostic tests" result={diagRecent} emptyHint="No recent tests." />
        <Section title="Eligible test types" result={testTypes} emptyHint="No test types reported." />
        <Section title="Service health (latest)" result={health} emptyHint="No service health records." />
      </div>

      <p className="mt-4 text-[10px] text-subtle">
        Live from Kinetix Rev3. Run-test and order actions land once the order/diagnostics write APIs are wired (needs swagger schemas).
      </p>
    </div>
  );
}

function Section({
  title,
  result,
  emptyHint,
}: {
  title: string;
  result: PromiseSettledResult<unknown>;
  emptyHint?: string;
}) {
  if (result.status === "rejected") {
    const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-xs font-semibold mb-2">{title}</h3>
        <p className="text-[11px] text-red-300">{msg}</p>
      </div>
    );
  }

  const data = result.value;
  const isEmpty =
    data == null ||
    (Array.isArray(data) && data.length === 0) ||
    (typeof data === "object" && Object.keys(data as object).length === 0);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-xs font-semibold mb-2">{title}</h3>
      {isEmpty ? (
        <p className="text-[11px] text-muted-foreground">{emptyHint ?? "Nothing returned."}</p>
      ) : (
        <>
          <KeyValues data={data} />
          <details className="mt-2">
            <summary className="text-[10px] text-subtle cursor-pointer hover:text-muted-foreground">Raw payload</summary>
            <pre className="mt-1 max-h-72 overflow-auto rounded bg-muted/30 p-2 text-[10px] leading-relaxed">
              {JSON.stringify(data, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}

/** Flatten the first level of useful scalar fields into a readable list. */
function KeyValues({ data }: { data: unknown }) {
  const obj = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : (data as Record<string, unknown>);
  if (!obj || typeof obj !== "object") return null;
  const rows = Object.entries(obj)
    .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
    .slice(0, 12);
  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground font-mono">{k}</dt>
          <dd className="truncate" title={String(v)}>{String(v)}</dd>
        </div>
      ))}
      {Array.isArray(data) && data.length > 1 && (
        <div className="contents">
          <dt className="text-muted-foreground font-mono">…</dt>
          <dd className="text-muted-foreground">{data.length - 1} more item{data.length > 2 ? "s" : ""} in raw payload</dd>
        </div>
      )}
    </dl>
  );
}
