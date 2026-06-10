"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Move this site to a different customer. Two modes with very different
 * billing consequences, so the dialog forces the choice:
 *  - "Sold / changed hands": DD plans stay with the old owner (their bank
 *    account!) — set up a new plan with the new owner separately.
 *  - "Wrong customer": pure filing fix — DD plans follow the site.
 */
export function TransferSiteButton({
  siteId,
  siteName,
  currentCustomerId,
  currentCustomerName,
}: {
  siteId: string;
  siteName: string;
  currentCustomerId: string;
  currentCustomerName: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<{ id: string; name: string }[]>([]);
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const [mode, setMode] = useState<"sold" | "refile">("refile");
  const [planCount, setPlanCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase
      .from("recurring_plans")
      .select("id", { count: "exact", head: true })
      .eq("site_id", siteId)
      .in("status", ["active", "pending_mandate", "paused"])
      .then(({ count }) => setPlanCount(count ?? 0));
  }, [open, siteId, supabase]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setOptions([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name")
        .ilike("name", `%${q}%`)
        .neq("id", currentCustomerId)
        .order("name")
        .limit(8);
      setOptions(data ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [query, currentCustomerId, supabase]);

  async function submit() {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetCustomerId: target.id, movePlans: mode === "refile" }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? "Transfer failed");
      const bits = [`Site moved to ${json.to}.`];
      if (json.movedContacts) bits.push(`${json.movedContacts} contact(s) moved.`);
      if (json.movedPlans) bits.push(`${json.movedPlans} DD plan(s) moved.`);
      if (json.retainedPlans) bits.push(`⚠ ${json.retainedPlans} DD plan(s) stayed with ${currentCustomerName} — set up new billing with the new owner.`);
      setDone(bits.join(" "));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setQuery(""); setOptions([]); setTarget(null); setMode("refile"); setError(null); setDone(null);
  }

  const input = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        Transfer
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={close}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {done ? (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold">Transferred ✓</h2>
                <p className="text-xs text-muted-foreground">{done}</p>
                <div className="flex justify-end">
                  <button className="rounded-md px-3 py-1.5 text-xs font-medium border border-border hover:bg-muted/40" onClick={close}>Close</button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold">Transfer {siteName}</h2>
                <p className="text-xs text-muted-foreground">Currently under <strong>{currentCustomerName}</strong>. History (jobs, quotes, invoices) always stays with the original customer.</p>

                <div>
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">New customer</span>
                  {target ? (
                    <div className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
                      <span>{target.name}</span>
                      <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setTarget(null)}>change</button>
                    </div>
                  ) : (
                    <div className="relative">
                      <input className={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search customers…" />
                      {options.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-48 overflow-auto">
                          {options.map((o) => (
                            <button key={o.id} className="block w-full px-3 py-2 text-left text-sm hover:bg-muted/40" onClick={() => { setTarget(o); setOptions([]); }}>
                              {o.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">Why is it moving?</span>
                  <label className="flex items-start gap-2 rounded-md border border-border p-2.5 text-xs cursor-pointer has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
                    <input type="radio" name="mode" className="mt-0.5" checked={mode === "refile"} onChange={() => setMode("refile")} />
                    <span><strong>Filed under the wrong customer</strong><br /><span className="text-muted-foreground">Record fix — direct debits ({planCount}) move with the site. Billing unchanged.</span></span>
                  </label>
                  <label className="mt-1.5 flex items-start gap-2 rounded-md border border-border p-2.5 text-xs cursor-pointer has-[:checked]:border-amber-500/50 has-[:checked]:bg-amber-500/5">
                    <input type="radio" name="mode" className="mt-0.5" checked={mode === "sold"} onChange={() => setMode("sold")} />
                    <span><strong>Site sold / changed hands</strong><br /><span className="text-muted-foreground">Direct debits ({planCount}) STAY with {currentCustomerName} — their bank account signed the mandate. Set up a new plan with the new owner after.</span></span>
                  </label>
                </div>

                {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

                <div className="flex justify-end gap-2 pt-1">
                  <button className="rounded-md px-3 py-1.5 text-xs font-medium border border-border hover:bg-muted/40" onClick={close} disabled={busy}>Cancel</button>
                  <button
                    className="rounded-md px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
                    disabled={!target || busy}
                    onClick={submit}
                  >
                    {busy ? "Transferring…" : `Transfer to ${target?.name ?? "…"}`}
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
