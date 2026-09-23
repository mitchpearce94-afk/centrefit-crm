"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

// Coverage report (quoting-v2 D3): the things that make a quote silently
// incomplete, listed so they get fixed at the source. Plus the per-template
// "who supplies this device type" table (Snap readers = customer).

export interface CoverageData {
  deviceTypesNoProduct: { code: string; legend: string; count_quotes: number }[];
  productsMissingTags: { id: string; name: string; sku: string | null; missing: string[] }[];
  labourMismatch: { id: string; name: string; sku: string | null; device_type: string; problem: string }[];
  rulesBroken: { id: string; description: string | null; problem: string; template: string | null }[];
  kitsBroken: { kit: string; component: string; problem: string }[];
  zeroCost: { id: string; name: string; sku: string | null; used_by_rules: number; used_by_kits: number }[];
  templates: { id: string; name: string }[];
  deviceTypes: { code: string; legend: string; has_hardware: boolean }[];
  supply: { template_id: string; device_type: string; supplied_by: string }[];
}

export function CoverageReport({ data }: { data: CoverageData }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const supplyOf = (t: string, d: string) => data.supply.find((s) => s.template_id === t && s.device_type === d)?.supplied_by ?? "centrefit";
  async function setSupply(template_id: string, device_type: string, supplied_by: string) {
    const key = `${template_id}|${device_type}`; setBusy(key);
    try {
      const res = await fetch("/api/quoting/template-supply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template_id, device_type, supplied_by }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) toast(json.error ?? "Failed", "error"); else { toast("Saved"); router.refresh(); }
    } finally { setBusy(null); }
  }
  const Section = ({ title, n, children }: { title: string; n: number; children: React.ReactNode }) => (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">{title} <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${n ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"}`}>{n}</span></h3>
      <div className="mt-2 text-xs">{n ? children : <p className="text-muted-foreground">Nothing to fix.</p>}</div>
    </section>
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Section title="Device types with no product" n={data.deviceTypesNoProduct.length}>
        <p className="mb-1 text-muted-foreground">A plan can count these, and the quote gets no part. Tag a product with the device type in Settings → Products.</p>
        <ul className="space-y-1">{data.deviceTypesNoProduct.map((d) => <li key={d.code}><span className="font-medium">{d.legend}</span> <span className="font-mono text-muted-foreground">{d.code}</span>{d.count_quotes ? <span className="ml-2 text-amber-300">counted on {d.count_quotes} quotes since March</span> : null}</li>)}</ul>
      </Section>
      <Section title="Products missing tags" n={data.productsMissingTags.length}>
        <p className="mb-1 text-muted-foreground">Without a scope role the part never reaches the customer&apos;s document; without a labour code no fit-off labour is charged.</p>
        <ul className="max-h-64 space-y-1 overflow-auto">{data.productsMissingTags.map((p) => <li key={p.id}><span className="font-medium">{p.name}</span> <span className="text-muted-foreground">{p.sku} — missing {p.missing.join(", ")}</span></li>)}</ul>
      </Section>
      <Section title="Labour tags that contradict the device type" n={data.labourMismatch.length}>
        <p className="mb-1 text-muted-foreground">Wrong fit-off line, or a cable run charged for head-end gear, on every quote the product lands on. Fix the product&apos;s labour code / cable-run flag in Settings → Products.</p>
        <ul className="space-y-1">{data.labourMismatch.map((p, i) => <li key={`${p.id}-${i}`}><span className="font-medium">{p.name}</span> <span className="font-mono text-muted-foreground">{p.device_type}</span> <span className="text-muted-foreground">— {p.problem}</span></li>)}</ul>
      </Section>
      <Section title="Rules that can't fire" n={data.rulesBroken.length}>
        <ul className="space-y-1">{data.rulesBroken.map((r) => <li key={r.id}><span className="font-medium">{r.description ?? r.id.slice(0, 8)}</span> <span className="text-muted-foreground">({r.template ?? "universal"}) — {r.problem}</span></li>)}</ul>
      </Section>
      <Section title="Kit parts that can't expand" n={data.kitsBroken.length}>
        <ul className="space-y-1">{data.kitsBroken.map((k, i) => <li key={i}><span className="font-medium">{k.kit}</span> → {k.component} <span className="text-muted-foreground">— {k.problem}</span></li>)}</ul>
      </Section>
      <Section title="Products with $0 cost that rules or kits add" n={data.zeroCost.length}>
        <p className="mb-1 text-muted-foreground">These would be quoted free. Set a cost (a supplier offer) before they hit a quote — lint blocks them.</p>
        <ul className="space-y-1">{data.zeroCost.map((p) => <li key={p.id}><span className="font-medium">{p.name}</span> <span className="text-muted-foreground">{p.sku} — {p.used_by_rules} rules, {p.used_by_kits} kits</span></li>)}</ul>
      </Section>
      <section className="rounded-xl border border-border bg-card p-4 md:col-span-2">
        <h3 className="text-sm font-semibold">Who supplies what, per template</h3>
        <p className="mb-2 text-xs text-muted-foreground">Customer-supplied device types stay on the quote for labour and cabling, carry no price and are never ordered.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">Device type</th>{data.templates.map((t) => <th key={t.id} className="py-1 pr-3">{t.name}</th>)}</tr></thead>
            <tbody>
              {data.deviceTypes.filter((d) => d.has_hardware).map((d) => (
                <tr key={d.code} className="border-t border-border">
                  <td className="py-1 pr-3">{d.legend}</td>
                  {data.templates.map((t) => { const v = supplyOf(t.id, d.code); const key = `${t.id}|${d.code}`; return (
                    <td key={t.id} className="py-1 pr-3">
                      <select value={v} disabled={busy === key} onChange={(e) => setSupply(t.id, d.code, e.target.value)} className={`rounded-md border px-1 py-0.5 ${v === "customer" ? "border-sky-500/40 bg-sky-500/10 text-sky-300" : "border-border bg-background"}`}>
                        <option value="centrefit">Centrefit</option><option value="customer">Customer</option>
                      </select>
                    </td>); })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
