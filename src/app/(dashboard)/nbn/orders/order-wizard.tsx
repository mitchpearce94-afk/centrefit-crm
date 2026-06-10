"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The Rev3-replacement order wizard: address → product → end user →
 * (optional appointment) → submit. Talks to /api/nbn/rev3 (action router).
 *
 * TESTING MODE defaults ON — simulated submissions, nothing reaches NBN.
 * Going live is a deliberate, loudly-labelled toggle.
 */

async function rev3<T = unknown>(action: string, params: Record<string, unknown>, testingMode: boolean): Promise<T> {
  const res = await fetch("/api/nbn/rev3", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, params, testingMode }),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error ?? "Request failed");
  return json.result as T;
}

interface Match { id: string; formattedAddress: string }

const input = "w-full rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary";
const label = "block text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1";
const btn = "rounded-md px-3 py-1.5 text-xs font-medium border border-border hover:bg-muted/40 disabled:opacity-40";
const btnPrimary = "rounded-md px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40";

/** Render whatever shape Kinetix returns for SKU lists as selectable options. */
function extractOptions(data: unknown): { value: string; label: string }[] {
  const arr = Array.isArray(data)
    ? data
    : (data as { skus?: unknown[]; products?: unknown[]; results?: unknown[]; items?: unknown[]; serviceTypes?: unknown[] })?.skus
      ?? (data as { products?: unknown[] })?.products
      ?? (data as { results?: unknown[] })?.results
      ?? (data as { items?: unknown[] })?.items
      ?? (data as { serviceTypes?: unknown[] })?.serviceTypes
      ?? [];
  return (arr as unknown[]).map((x) => {
    if (typeof x === "string") return { value: x, label: x };
    const o = x as Record<string, unknown>;
    const value = String(o.sku ?? o.id ?? o.code ?? o.value ?? JSON.stringify(o).slice(0, 40));
    const name = o.name ? String(o.name) : "";
    return { value, label: name && name !== value ? `${name} (${value})` : value };
  });
}

export function OrderWizard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const testingMode = !live;

  /* address + qualification */
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [loc, setLoc] = useState<Match | null>(null);
  const [qual, setQual] = useState<Record<string, unknown> | null>(null);
  const skipSearch = useRef(false);

  /* product */
  const [serviceTypes, setServiceTypes] = useState<{ value: string; label: string }[]>([]);
  const [serviceType, setServiceType] = useState("");
  const [bandwidths, setBandwidths] = useState<{ value: string; label: string }[]>([]);
  const [bandwidthSku, setBandwidthSku] = useState("");
  const [slas, setSlas] = useState<{ value: string; label: string }[]>([]);
  const [slaSku, setSlaSku] = useState("");

  /* end user */
  const [euType, setEuType] = useState<"residential" | "business">("business");
  const [euRef, setEuRef] = useState("");
  const [euName, setEuName] = useState("");
  const [euCompany, setEuCompany] = useState("");
  const [euPhone, setEuPhone] = useState("");
  const [euEmail, setEuEmail] = useState("");
  const [euAbn, setEuAbn] = useState("");

  /* appointment */
  const [slots, setSlots] = useState<Record<string, unknown>[]>([]);
  const [demandType, setDemandType] = useState("Standard Install");
  const [aptId, setAptId] = useState("");

  /* order */
  const [orderRef, setOrderRef] = useState("");
  const [lineRef, setLineRef] = useState("NEW"); // copper_pair_id or ntd_id
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const sr = qual?.siteRestriction as Record<string, unknown> | undefined;
  const tech = (sr?.supportingTechnology as { primaryAccessTechnology?: string } | undefined)?.primaryAccessTechnology ?? null;
  const serviceable = (sr?.serviceabilityStatus as string | undefined) === "Serviceable";
  const productClass = techToClass(tech);

  function techToClass(t: string | null): "ncas" | "nfas" | "nhas" | "nwas" | null {
    const s = (t ?? "").toLowerCase();
    if (!s) return null;
    if (s === "fibre") return "nfas";
    if (s.includes("node") || s.includes("building") || s.includes("curb")) return "ncas";
    if (s.includes("hfc")) return "nhas";
    if (s.includes("wireless")) return "nwas";
    return null;
  }

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function searchAddress(q: string) {
    setQuery(q);
    setLoc(null); setQual(null);
    if (skipSearch.current) { skipSearch.current = false; return; }
    if (q.trim().length < 5) { setMatches([]); return; }
    try {
      const res = await fetch("/api/nbn/qualify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "search", fullText: q }),
      });
      const json = await res.json();
      setMatches(Array.isArray(json.matches) ? json.matches : []);
    } catch { setMatches([]); }
  }

  async function pick(m: Match) {
    skipSearch.current = true;
    setLoc(m); setQuery(m.formattedAddress); setMatches([]);
    setQual(null); setServiceTypes([]); setServiceType(""); setBandwidths([]); setBandwidthSku(""); setSlas([]); setSlaSku("");
    await run("qualify", async () => {
      const res = await fetch("/api/nbn/qualify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "qualify", locId: m.id }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? "Qualification failed");
      setQual(json.result);
      setOrderRef(`CF.${m.id.replace("LOC", "")}.${new Date().toISOString().slice(0, 10)}`);
    });
  }

  const loadServiceTypes = () => run("svctypes", async () => {
    const data = await rev3("qual.serviceTypes", { location_ref: loc!.id }, testingMode);
    setServiceTypes(extractOptions(data));
  });
  const loadBandwidths = () => run("bandwidths", async () => {
    const data = await rev3("qual.bandwidths", {
      location_ref: loc!.id, service_type: serviceType,
      cpi_ref: productClass === "ncas" && lineRef !== "NEW" ? lineRef : undefined,
    }, testingMode);
    setBandwidths(extractOptions(data));
  });
  const loadSlas = () => run("slas", async () => {
    const data = await rev3("qual.slas", { location_ref: loc!.id, bandwidth_product_sku: bandwidthSku }, testingMode);
    setSlas(extractOptions(data));
  });

  const createEndUser = () => run("eu", async () => {
    const data = euType === "business"
      ? await rev3("party.createBusiness", {
          company_name: euCompany, trading_name: euCompany, contact_name: euName,
          phone_number: euPhone, email_address: euEmail, business_id: euAbn || undefined,
        }, testingMode)
      : await rev3("party.createResidential", {
          contact_name: euName, phone_number: euPhone, email_address: euEmail,
        }, testingMode);
    const id = (data as { id?: string }).id ?? "";
    if (!id) throw new Error("No EUP reference returned");
    setEuRef(id);
  });

  const findSlots = () => run("slots", async () => {
    const start = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const data = await rev3("appointments.queryNew", {
      location_id: loc!.id, start_date_time: start, demand_type: demandType,
      appointment_sla: "Standard", priority_assist: false,
    }, testingMode);
    const list = (data as { availableTimeSlot?: Record<string, unknown>[] }).availableTimeSlot ?? [];
    setSlots(list.slice(0, 12));
  });

  const reserveSlot = (slot: Record<string, unknown>) => run("reserve", async () => {
    const valid = (slot.validFor ?? {}) as { startDateTime?: string; endDateTime?: string };
    const data = await rev3("appointments.reserve", {
      location_id: loc!.id, demand_type: demandType, appointment_sla: "Standard",
      appointment_slot_type: slot.appointmentSlotType,
      start_date_time: valid.startDateTime, end_date_time: valid.endDateTime,
      end_user_contact_type: "Primary Contact",
      end_user_contact_name: euName || euCompany || "Centrefit Communications",
      end_user_contact_phone: euPhone || "0731885115",
      end_user_contact_email: euEmail || undefined,
      end_user_type: euType === "business" ? "Business" : "Residential",
      priority_assist: false,
      rsp_reference: orderRef,
    }, testingMode);
    const id = (data as { id?: string }).id ?? "";
    if (!id) throw new Error("No appointment ID returned");
    setAptId(id);
    setSlots([]);
  });

  const submit = () => run("submit", async () => {
    if (!loc || !productClass) throw new Error("Qualify an address first");
    const params: Record<string, unknown> = {
      productClass,
      technology: tech,
      formattedAddress: loc.formattedAddress,
      location_id: loc.id,
      bandwidth_product_sku: bandwidthSku,
      restoration_sla_sku: slaSku,
      order_reference: orderRef.replace(/[^a-zA-Z0-9_\-.]/g, "").slice(0, 35),
      end_user_ref: euRef || undefined,
      appointment_id: aptId || undefined,
    };
    if (productClass === "ncas") params.copper_pair_id = lineRef || "NEW";
    else params.ntd_id = lineRef || "NEW";
    const data = await rev3("orders.submit", params, testingMode);
    setResult(data as Record<string, unknown>);
    router.refresh();
  });

  if (!open) {
    return (
      <button className={btnPrimary} onClick={() => setOpen(true)}>+ New NBN order</button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-5">
      {/* mode banner */}
      <div className={`flex items-center justify-between rounded-md px-3 py-2 text-xs border ${live ? "border-red-500/50 bg-red-500/10 text-red-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}`}>
        <span className="font-medium">
          {live ? "⚠ LIVE MODE — submissions go to NBN and create real orders" : "Testing Mode — submissions are simulated, nothing reaches NBN"}
        </span>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="accent-red-500" />
          Live
        </label>
      </div>

      {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

      {result ? (
        <div className="space-y-3">
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            Order {String((result as { id?: string }).id ?? "")} — {String((result as { state?: string }).state ?? "Acknowledged")}
            {testingMode ? " (simulated)" : ""}
          </div>
          <details><summary className="text-[10px] text-subtle cursor-pointer">Raw response</summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted/30 p-2 text-[10px]">{JSON.stringify(result, null, 2)}</pre>
          </details>
          <button className={btn} onClick={() => { setResult(null); setOpen(false); }}>Close</button>
        </div>
      ) : (
        <>
          {/* 1 — address */}
          <section>
            <h3 className="text-xs font-semibold mb-2">1 · Address</h3>
            <div className="relative max-w-xl">
              <input className={input} placeholder="Search the nbn® address database…" value={query} onChange={(e) => void searchAddress(e.target.value)} />
              {matches.length > 0 && (
                <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-card shadow-xl">
                  {matches.map((m) => (
                    <button key={m.id} onClick={() => void pick(m)} className="block w-full px-3 py-2 text-left text-xs hover:bg-muted/40 border-b border-border last:border-0">
                      {m.formattedAddress} <span className="ml-1 font-mono text-[10px] text-muted-foreground">{m.id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {busy === "qualify" && <p className="mt-2 text-[11px] text-muted-foreground">Qualifying…</p>}
            {qual && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                <span className={`rounded-full border px-2 py-0.5 ${serviceable ? "border-emerald-500/30 text-emerald-400" : "border-red-500/30 text-red-300"}`}>
                  {serviceable ? "SERVICEABLE" : "NOT SERVICEABLE"}
                </span>
                {tech && <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">{tech}</span>}
                {productClass && <span className="rounded-full border border-border px-2 py-0.5 font-mono text-muted-foreground">{productClass.toUpperCase()}</span>}
                <details className="w-full"><summary className="text-[10px] text-subtle cursor-pointer">Full qualification (lines / NTDs / service class)</summary>
                  <pre className="mt-1 max-h-56 overflow-auto rounded bg-muted/30 p-2 text-[10px]">{JSON.stringify(qual, null, 2)}</pre>
                </details>
              </div>
            )}
          </section>

          {/* 2 — product */}
          {qual && serviceable && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold">2 · Product</h3>
              <div className="grid gap-2 md:grid-cols-3">
                <div>
                  <span className={label}>Service type</span>
                  <div className="flex gap-2">
                    <select className={input} value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
                      <option value="">{serviceTypes.length ? "Select…" : "Load first"}</option>
                      {serviceTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <button className={btn} disabled={busy !== null} onClick={loadServiceTypes}>Load</button>
                  </div>
                </div>
                <div>
                  <span className={label}>Bandwidth SKU</span>
                  <div className="flex gap-2">
                    <select className={input} value={bandwidthSku} onChange={(e) => setBandwidthSku(e.target.value)}>
                      <option value="">{bandwidths.length ? "Select…" : "Load first"}</option>
                      {bandwidths.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <button className={btn} disabled={!serviceType || busy !== null} onClick={loadBandwidths}>Load</button>
                  </div>
                </div>
                <div>
                  <span className={label}>Restoration SLA</span>
                  <div className="flex gap-2">
                    <select className={input} value={slaSku} onChange={(e) => setSlaSku(e.target.value)}>
                      <option value="">{slas.length ? "Select…" : "Load first"}</option>
                      {slas.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <button className={btn} disabled={!bandwidthSku || busy !== null} onClick={loadSlas}>Load</button>
                  </div>
                </div>
              </div>
              <div className="max-w-xs">
                <span className={label}>{productClass === "ncas" ? "Copper pair (CPI) — or NEW" : "NTD ID — or NEW"}</span>
                <input className={input} value={lineRef} onChange={(e) => setLineRef(e.target.value)} placeholder="NEW" />
              </div>
            </section>
          )}

          {/* 3 — end user */}
          {qual && serviceable && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold">3 · End user {euRef && <span className="ml-2 font-mono text-emerald-400">{euRef}</span>}</h3>
              {!euRef && (
                <div className="grid gap-2 md:grid-cols-5">
                  <select className={input} value={euType} onChange={(e) => setEuType(e.target.value as "residential" | "business")}>
                    <option value="business">Business</option>
                    <option value="residential">Residential</option>
                  </select>
                  {euType === "business" && <input className={input} placeholder="Company name *" value={euCompany} onChange={(e) => setEuCompany(e.target.value)} />}
                  <input className={input} placeholder={euType === "business" ? "Contact name" : "Contact name *"} value={euName} onChange={(e) => setEuName(e.target.value)} />
                  <input className={input} placeholder="Phone" value={euPhone} onChange={(e) => setEuPhone(e.target.value)} />
                  <input className={input} placeholder="Email" value={euEmail} onChange={(e) => setEuEmail(e.target.value)} />
                  {euType === "business" && <input className={input} placeholder="ABN" value={euAbn} onChange={(e) => setEuAbn(e.target.value)} />}
                  <button
                    className={btn}
                    disabled={busy !== null || (euType === "business" ? !euCompany : !euName)}
                    onClick={createEndUser}
                  >
                    {busy === "eu" ? "Creating…" : "Create end user (EUP)"}
                  </button>
                </div>
              )}
            </section>
          )}

          {/* 4 — appointment */}
          {qual && serviceable && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold">4 · Appointment {aptId ? <span className="ml-2 font-mono text-emerald-400">{aptId}</span> : <span className="ml-2 text-[10px] text-muted-foreground">(only if the service class requires an install)</span>}</h3>
              {!aptId && (
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <span className={label}>Demand type</span>
                    <select className={input} value={demandType} onChange={(e) => setDemandType(e.target.value)}>
                      {["Standard Install", "Non Standard Install", "Additional Install", "Non EU Jumper Only"].map((d) => <option key={d}>{d}</option>)}
                    </select>
                  </div>
                  <button className={btn} disabled={busy !== null} onClick={findSlots}>{busy === "slots" ? "Searching…" : "Find timeslots"}</button>
                </div>
              )}
              {slots.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {slots.map((s, i) => {
                    const v = (s.validFor ?? {}) as { startDateTime?: string; endDateTime?: string };
                    return (
                      <button key={i} className={btn} disabled={busy !== null} onClick={() => void reserveSlot(s)}>
                        {String(s.appointmentSlotType ?? "")} · {v.startDateTime ? new Date(v.startDateTime).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" }) : "?"}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* 5 — submit */}
          {qual && serviceable && (
            <section className="space-y-2 border-t border-border pt-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="max-w-xs flex-1">
                  <span className={label}>Order reference (RSP ref, ≤35 chars)</span>
                  <input className={input} value={orderRef} onChange={(e) => setOrderRef(e.target.value)} />
                </div>
                <button
                  className={live ? "rounded-md px-4 py-2 text-xs font-semibold bg-red-600 text-white hover:bg-red-500 disabled:opacity-40" : btnPrimary}
                  disabled={busy !== null || !bandwidthSku || !slaSku || !orderRef}
                  onClick={submit}
                >
                  {busy === "submit" ? "Submitting…" : live ? "Submit LIVE order to NBN" : "Submit simulated order"}
                </button>
                <button className={btn} onClick={() => setOpen(false)}>Cancel</button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
