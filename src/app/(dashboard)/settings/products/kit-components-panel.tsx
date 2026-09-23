"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

// Kit components editor (quoting-v2 D1/D2): what quoting this product REQUIRES.
// Proposed rows (from the rule migration or the gaps inbox) wait for approval;
// only approved rows expand in a quote.

export interface KitComponentRow {
  id: string;
  kit_product_id: string;
  component_product_id: string;
  qty_mode: string;
  qty_value: number;
  qty_per: number | null;
  qty_formula: string | null;
  qty_device_type: string | null;
  requirement: string;
  ask_prompt: string | null;
  status: string;
  source: string;
  notes: string | null;
  sort_order: number;
}
interface ProductLite { id: string; name: string; sku: string | null; category?: string | null }

const MODE_LABEL: Record<string, string> = { per_unit: "× per unit", fixed: "fixed", per_n: "per N units", formula: "formula", per_device_type: "× device count" };

export function KitComponentsPanel({ product, rows, products, deviceTypes = [] }: { product: { id: string; name: string }; rows: KitComponentRow[]; products: ProductLite[]; deviceTypes?: { code: string; legend: string }[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [componentId, setComponentId] = useState("");
  const [qtyMode, setQtyMode] = useState("per_unit");
  const [qtyValue, setQtyValue] = useState("1");
  const [qtyPer, setQtyPer] = useState("");
  const [qtyFormula, setQtyFormula] = useState("");
  const [qtyDeviceType, setQtyDeviceType] = useState("");
  const [requirement, setRequirement] = useState("required");
  const [askPrompt, setAskPrompt] = useState("");
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const hits = search.length >= 2 ? products.filter((p) => p.id !== product.id && (`${p.name} ${p.sku ?? ""}`.toLowerCase().includes(search.toLowerCase()))).slice(0, 8) : [];

  async function call(method: "PUT" | "PATCH" | "DELETE", body: unknown, key: string, ok: string) {
    setBusy(key);
    try {
      const res = await fetch(`/api/products/${product.id}/kit-components`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json.error ?? "Failed", "error"); return false; }
      toast(ok); router.refresh(); return true;
    } finally { setBusy(null); }
  }

  const qtyText = (r: KitComponentRow) => r.qty_mode === "per_unit" ? `${r.qty_value} per unit` : r.qty_mode === "fixed" ? `${r.qty_value} fixed` : r.qty_mode === "per_n" ? `${r.qty_value} per ${r.qty_per ?? "?"} units` : r.qty_mode === "formula" ? `= ${r.qty_formula}` : `${r.qty_value} × ${r.qty_device_type ?? "?"} count`;
  const sorted = [...rows].sort((a, b) => (a.status === b.status ? a.sort_order - b.sort_order : a.status === "proposed" ? -1 : b.status === "proposed" ? 1 : 0));

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kit — what quoting this needs</p>
          <p className="text-[11px] text-muted-foreground">Approved parts are added to every quote that has this product. Proposed parts wait for Mitchell.</p>
        </div>
        <button type="button" onClick={() => setAdding((v) => !v)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent">{adding ? "Cancel" : "+ Add part"}</button>
      </div>
      {sorted.length === 0 && !adding ? <p className="mt-2 text-xs text-muted-foreground">No kit parts yet.</p> : null}
      <ul className="mt-2 space-y-1">
        {sorted.map((r) => {
          const comp = byId.get(r.component_product_id);
          return (
            <li key={r.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs ${r.status === "proposed" ? "border-amber-500/40 bg-amber-500/5" : r.status === "rejected" ? "border-border opacity-50" : "border-border"}`}>
              <span className="min-w-0">
                <span className="font-medium">{comp?.name ?? r.component_product_id}</span>
                <span className="ml-2 text-muted-foreground">{qtyText(r)}</span>
                {r.requirement !== "required" ? <span className="ml-2 rounded bg-sky-500/15 px-1 text-[10px] text-sky-300">{r.requirement === "ask" ? `asks: ${r.ask_prompt ?? ""}` : "optional"}</span> : null}
                {r.status !== "approved" ? <span className="ml-2 rounded bg-amber-500/15 px-1 text-[10px] uppercase text-amber-300">{r.status}</span> : null}
                {r.notes ? <span className="block text-[10px] text-muted-foreground">{r.notes}</span> : null}
              </span>
              <span className="flex gap-1">
                {r.status !== "approved" ? <button type="button" disabled={busy === r.id} onClick={() => call("PATCH", { id: r.id, status: "approved" }, r.id, "Approved")} className="rounded-md bg-emerald-600/80 px-2 py-0.5 text-[11px] text-white hover:bg-emerald-600">Approve</button> : null}
                {r.status !== "rejected" ? <button type="button" disabled={busy === r.id} onClick={() => call("PATCH", { id: r.id, status: "rejected" }, r.id, "Rejected")} className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-accent">Reject</button> : null}
                <button type="button" disabled={busy === r.id} onClick={() => { if (window.confirm("Remove this part from the kit?")) void call("DELETE", { id: r.id }, r.id, "Removed"); }} className="rounded-md border border-red-500/30 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-500/10">Remove</button>
              </span>
            </li>
          );
        })}
      </ul>
      {adding ? (
        <div className="mt-3 grid gap-2 rounded-md border border-border bg-background p-2 text-xs sm:grid-cols-2">
          <div className="relative sm:col-span-2">
            <input value={search} onChange={(e) => { setSearch(e.target.value); setComponentId(""); }} placeholder="Search the part to add…" className="w-full rounded-md border border-border bg-background px-2 py-1.5" />
            {hits.length && !componentId ? <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-card shadow-lg">{hits.map((p) => <li key={p.id}><button type="button" className="block w-full px-2 py-1.5 text-left hover:bg-accent" onClick={() => { setComponentId(p.id); setSearch(`${p.name}${p.sku ? ` (${p.sku})` : ""}`); }}>{p.name} <span className="text-muted-foreground">{p.sku}</span></button></li>)}</ul> : null}
          </div>
          <select value={qtyMode} onChange={(e) => setQtyMode(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5">{Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          {qtyMode === "formula" ? <input value={qtyFormula} onChange={(e) => setQtyFormula(e.target.value)} placeholder="e.g. max(0, ceil((qty - 2) / 2))  or  hdd_pack" className="rounded-md border border-border bg-background px-2 py-1.5" /> : qtyMode === "per_device_type" ? <select value={qtyDeviceType} onChange={(e) => setQtyDeviceType(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5"><option value="">device type…</option>{deviceTypes.map((d) => <option key={d.code} value={d.code}>{d.legend}</option>)}</select> : <input type="number" min={0} step="1" value={qtyValue} onChange={(e) => setQtyValue(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5" placeholder="qty" />}
          {qtyMode === "per_n" ? <input type="number" min={1} value={qtyPer} onChange={(e) => setQtyPer(e.target.value)} placeholder="per how many units" className="rounded-md border border-border bg-background px-2 py-1.5" /> : null}
          <select value={requirement} onChange={(e) => setRequirement(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5"><option value="required">Required</option><option value="optional">Optional</option><option value="ask">Ask a question</option></select>
          {requirement === "ask" ? <input value={askPrompt} onChange={(e) => setAskPrompt(e.target.value)} placeholder="The question, e.g. Glass door?" className="rounded-md border border-border bg-background px-2 py-1.5 sm:col-span-2" /> : null}
          <div className="sm:col-span-2 flex justify-end">
            <button type="button" disabled={!componentId || busy === "add"} onClick={async () => { const ok = await call("PUT", { component_product_id: componentId, qty_mode: qtyMode, qty_value: Number(qtyValue || 1), qty_per: qtyPer || null, qty_formula: qtyFormula || null, qty_device_type: qtyDeviceType || null, requirement, ask_prompt: askPrompt || null }, "add", "Part added"); if (ok) { setAdding(false); setSearch(""); setComponentId(""); } }} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">Add to kit</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
