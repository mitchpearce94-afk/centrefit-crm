"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Add a service to an imported (GC-billed) plan. Creates ONE new GoCardless
 * subscription for the new service against the plan's existing mandate after
 * an explicit confirm — existing subscriptions are never touched, so there is
 * no double-up.
 */

interface CatalogueService {
  code: string;
  name: string;
  price_inc_gst: number | string;
  frequency: string;
  account_code?: string | null;
}

export function AddServiceButton({
  planId,
  customerName,
  catalogue,
}: {
  planId: string;
  customerName: string;
  catalogue: CatalogueService[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ subscriptionId: string; firstCharge: string | null } | null>(null);

  const [code, setCode] = useState("");
  const [customName, setCustomName] = useState("");
  const [price, setPrice] = useState("");
  const [frequency, setFrequency] = useState<"monthly" | "yearly">("monthly");
  const [quantity, setQuantity] = useState(1);
  const [startDate, setStartDate] = useState("");

  const selected = useMemo(() => catalogue.find((c) => c.code === code) ?? null, [catalogue, code]);
  const isCustom = code === "custom";
  const effName = isCustom ? customName.trim() : selected?.name ?? "";
  const effPrice = isCustom || price !== "" ? Number(price) : Number(selected?.price_inc_gst ?? 0);
  const effFreq = isCustom ? frequency : ((selected?.frequency === "yearly" ? "yearly" : "monthly") as "monthly" | "yearly");
  const total = (Number.isFinite(effPrice) ? effPrice : 0) * quantity;
  const valid = !!effName && Number.isFinite(effPrice) && effPrice > 0;

  function pick(c: string) {
    setCode(c);
    setError(null);
    const svc = catalogue.find((x) => x.code === c);
    setPrice(svc ? String(svc.price_inc_gst) : "");
  }

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/recurring/add-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          serviceName: effName,
          serviceCode: isCustom ? "custom" : code,
          accountCode: isCustom ? "200" : selected?.account_code ?? "200",
          priceIncGst: effPrice,
          frequency: effFreq,
          quantity,
          startDate: startDate || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? "Failed");
      setDone({ subscriptionId: json.subscriptionId, firstCharge: json.firstCharge ?? null });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add service");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setDone(null); setError(null);
    setCode(""); setCustomName(""); setPrice(""); setQuantity(1); setStartDate("");
  }

  const input = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";
  const label = "block text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:opacity-90"
      >
        Add service
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={close}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {done ? (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold">Service added ✓</h2>
                <p className="text-xs text-muted-foreground">
                  GoCardless subscription <span className="font-mono">{done.subscriptionId}</span> created.
                  First charge {done.firstCharge ?? "as soon as the mandate allows"}.
                </p>
                <p className="text-[11px] rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-300">
                  Heads up: this plan&apos;s Xero repeating invoice (if the customer has a legacy one) won&apos;t include the new service — update it in Xero until the CRM invoice swap ships.
                </p>
                <div className="flex justify-end">
                  <button className="rounded-md px-3 py-1.5 text-xs font-medium border border-border hover:bg-muted/40" onClick={close}>Close</button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold">Add service — {customerName}</h2>
                <div>
                  <span className={label}>Service</span>
                  <select className={input} value={code} onChange={(e) => pick(e.target.value)}>
                    <option value="">Select…</option>
                    {catalogue.map((c) => (
                      <option key={c.code} value={c.code}>{c.name} — ${Number(c.price_inc_gst).toFixed(2)}/{c.frequency}</option>
                    ))}
                    <option value="custom">Custom line…</option>
                  </select>
                </div>
                {isCustom && (
                  <div>
                    <span className={label}>Custom service name</span>
                    <input className={input} value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="e.g. VOIP Phones x2" />
                  </div>
                )}
                {(isCustom || code) && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <span className={label}>Price incl. GST</span>
                      <input className={input} type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
                    </div>
                    <div>
                      <span className={label}>Qty</span>
                      <input className={input} type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.trunc(Number(e.target.value) || 1)))} />
                    </div>
                    <div>
                      <span className={label}>Cadence</span>
                      <select className={input} value={effFreq} onChange={(e) => setFrequency(e.target.value === "yearly" ? "yearly" : "monthly")} disabled={!isCustom}>
                        <option value="monthly">monthly</option>
                        <option value="yearly">yearly</option>
                      </select>
                    </div>
                  </div>
                )}
                {(isCustom || code) && (
                  <div>
                    <span className={label}>First charge date (optional)</span>
                    <input className={input} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    <p className="mt-1 text-[10px] text-muted-foreground">Blank = earliest the mandate allows. Dates earlier than the mandate permits are moved automatically.</p>
                  </div>
                )}

                {valid && (
                  <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs">
                    This creates a <strong>new GoCardless subscription</strong> charging{" "}
                    <strong>${total.toFixed(2)}/{effFreq}</strong> against the customer&apos;s existing mandate.
                    Existing subscriptions are not touched.
                  </div>
                )}
                {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

                <div className="flex justify-end gap-2 pt-1">
                  <button className="rounded-md px-3 py-1.5 text-xs font-medium border border-border hover:bg-muted/40" onClick={close} disabled={busy}>Cancel</button>
                  <button
                    className="rounded-md px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
                    disabled={!valid || busy}
                    onClick={submit}
                  >
                    {busy ? "Creating…" : `Confirm — charge $${total.toFixed(2)}/${effFreq}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
