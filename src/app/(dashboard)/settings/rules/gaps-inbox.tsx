"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import type { GapsData } from "@/lib/quoting/coverage";

// Gaps inbox (quoting-v2 D6): parts people keep adding by hand after the
// engine ran. One click turns a repeat into a kit part; Dismiss records the
// pair as rejected so it stops being suggested.

export function GapsInbox({ data }: { data: GapsData }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(kitId: string, componentId: string, status: "approved" | "rejected", seen: number) {
    const key = `${kitId}|${componentId}`; setBusy(key);
    try {
      const res = await fetch(`/api/products/${kitId}/kit-components`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ component_product_id: componentId, qty_mode: "per_unit", qty_value: 1, requirement: "required", source: "gap_inbox", status, notes: `Gaps inbox: hand-added on ${seen} quotes alongside this kit` }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) toast(json.error ?? "Failed", "error");
      else { toast(status === "approved" ? "Added to the kit — 1 per unit. Adjust the quantity on the product if needed." : "Dismissed"); router.refresh(); }
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Scanned {data.quotesScanned} quotes since {new Date(data.since).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}. A part shows here when it was added by hand on a plan quote, or ordered for a job without being on the quote, on two or more quotes. {data.oneOffs ? `${data.oneOffs} one-offs hidden.` : ""}
      </p>
      {data.adds.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">Nothing repeating. The engine is covering what people add.</div>
      ) : data.adds.map((a) => (
        <div key={a.product.id} className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <span className="text-sm font-semibold">{a.product.name}</span>
              {a.product.sku ? <span className="ml-2 font-mono text-xs text-muted-foreground">{a.product.sku}</span> : null}
            </div>
            <div className="text-xs text-muted-foreground">
              hand-added on <span className="font-medium text-foreground">{a.quotes}</span> quotes
              {a.viaManual ? ` · ${a.viaManual} in the wizard` : ""}{a.viaProcurement ? ` · ${a.viaProcurement} in procurement` : ""}
              {a.ruleAdds ? <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">a rule adds this — check why it didn&apos;t fire</span> : null}
            </div>
          </div>
          {a.alongside.length ? (
            <div className="mt-2 space-y-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Seen alongside — add it to one of these kits?</p>
              {a.alongside.map((x) => { const key = `${x.product.id}|${a.product.id}`; return (
                <div key={x.product.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5 text-xs">
                  <span><span className="font-medium">{x.product.name}</span> <span className="text-muted-foreground">on {x.n} of those quotes</span></span>
                  {x.alreadyComponent ? <span className="text-muted-foreground">already decided</span> : (
                    <span className="flex gap-1">
                      <button type="button" disabled={busy === key} onClick={() => decide(x.product.id, a.product.id, "approved", x.n)} className="rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground disabled:opacity-50">Add to kit</button>
                      <button type="button" disabled={busy === key} onClick={() => decide(x.product.id, a.product.id, "rejected", x.n)} className="rounded-md border border-border px-2 py-1 text-muted-foreground hover:text-foreground disabled:opacity-50">Dismiss</button>
                    </span>
                  )}
                </div>); })}
            </div>
          ) : <p className="mt-2 text-xs text-muted-foreground">No kit or device on those quotes to attach it to — it may want a rule instead.</p>}
        </div>
      ))}
    </div>
  );
}
