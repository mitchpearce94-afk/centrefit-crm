"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { DEVICE_TYPES } from "@/lib/quote-engine";

/**
 * Per-template device → product defaults (quote_template_device_defaults).
 *
 * quote_products.is_default is one global flag per device type, so "REX is
 * DFMWES2261 on Planet Fitness but WEL1911 on Snap" couldn't be expressed
 * before 2026-09-08. This panel sets the override per template; the BOM
 * engine checks it first and falls back to the catalogue default. Writes go
 * through the browser client — RLS restricts them to admins.
 */

interface TemplateOpt {
  id: string;
  name: string;
  slug: string;
  is_active?: boolean | null;
}
interface ProductOpt {
  id: string;
  name: string;
  sku: string | null;
  device_type: string | null;
  is_default: boolean | null;
}
export interface DeviceDefaultRow {
  id: string;
  template_id: string;
  device_type: string;
  product_id: string;
}

export function TemplateDeviceDefaults({
  templates,
  products,
  defaults,
}: {
  templates: TemplateOpt[];
  products: ProductOpt[];
  defaults: DeviceDefaultRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();
  const activeTemplates = templates.filter((t) => t.is_active !== false);
  const [templateId, setTemplateId] = useState<string>(activeTemplates[0]?.id ?? "");
  const [rows, setRows] = useState<DeviceDefaultRow[]>(defaults);
  const [saving, setSaving] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const productsByDevice = useMemo(() => {
    const m = new Map<string, ProductOpt[]>();
    for (const p of products) {
      if (!p.device_type) continue;
      const list = m.get(p.device_type) ?? [];
      list.push(p);
      m.set(p.device_type, list);
    }
    return m;
  }, [products]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const overrideFor = (code: string) => rows.find((r) => r.template_id === templateId && r.device_type === code);
  const catalogueDefault = (code: string) => {
    const list = productsByDevice.get(code) ?? [];
    return list.find((p) => p.is_default) ?? list[0] ?? null;
  };

  async function setOverride(code: string, productId: string) {
    if (!templateId) return;
    setSaving(code);
    try {
      if (!productId) {
        const { error } = await supabase
          .from("quote_template_device_defaults")
          .delete()
          .eq("template_id", templateId)
          .eq("device_type", code);
        if (error) throw error;
        setRows((prev) => prev.filter((r) => !(r.template_id === templateId && r.device_type === code)));
        toast("Back to the catalogue default");
      } else {
        const { data, error } = await supabase
          .from("quote_template_device_defaults")
          .upsert(
            { template_id: templateId, device_type: code, product_id: productId, updated_at: new Date().toISOString() },
            { onConflict: "template_id,device_type" },
          )
          .select("id, template_id, device_type, product_id")
          .single();
        if (error) throw error;
        setRows((prev) => [
          ...prev.filter((r) => !(r.template_id === templateId && r.device_type === code)),
          data as DeviceDefaultRow,
        ]);
        toast(`Default saved — new quotes on this template use ${productById.get(productId)?.sku ?? "that product"}`);
      }
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSaving(null);
    }
  }

  const templateOverrideCount = rows.filter((r) => r.template_id === templateId).length;
  const visibleDeviceTypes = DEVICE_TYPES.filter(
    (d) => showAll || (productsByDevice.get(d.code)?.length ?? 0) > 1 || overrideFor(d.code),
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/20 p-4 text-xs text-muted-foreground leading-relaxed">
        When a device is placed on a plan, the quote picks the catalogue&apos;s default product for that device type.
        Set a different default <span className="text-foreground">per template</span> here — e.g. the REX button is DFMWES2261 on Planet Fitness
        but the illuminated WEL1911 on Snap. Only affects quotes generated after the change.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {activeTemplates.map((t) => {
          const active = t.id === templateId;
          const n = rows.filter((r) => r.template_id === t.id).length;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTemplateId(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                active ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {t.name}
              {n > 0 && (
                <span className={`rounded-full px-1.5 text-[10px] font-semibold ${active ? "bg-white/20" : "bg-muted-foreground/15"}`}>{n}</span>
              )}
            </button>
          );
        })}
        <label className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="h-4 w-4 accent-primary" />
          Show every device type
        </label>
      </div>

      <div className="surface-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Device</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider hidden md:table-cell">Catalogue default</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">
                Default on {activeTemplates.find((t) => t.id === templateId)?.name ?? "this template"}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibleDeviceTypes.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground text-sm">
                  No device types have more than one candidate product. Tick &ldquo;Show every device type&rdquo; to see them all.
                </td>
              </tr>
            )}
            {visibleDeviceTypes.map((d) => {
              const candidates = productsByDevice.get(d.code) ?? [];
              const override = overrideFor(d.code);
              const catDefault = catalogueDefault(d.code);
              // An override pointing at a product that no longer carries this
              // device_type still needs to appear in the list.
              const overrideProduct = override ? productById.get(override.product_id) : null;
              const options = overrideProduct && !candidates.some((c) => c.id === overrideProduct.id)
                ? [...candidates, overrideProduct]
                : candidates;
              return (
                <tr key={d.code} className={override ? "bg-primary/5" : ""}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-foreground">{d.legend}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{d.code}</p>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell">
                    {catDefault ? (
                      <>
                        <span className="font-mono text-foreground">{catDefault.sku ?? "—"}</span> · {catDefault.name}
                      </>
                    ) : (
                      <span className="text-destructive">No product carries this device type</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={override?.product_id ?? ""}
                      disabled={saving === d.code || options.length === 0}
                      onChange={(e) => setOverride(d.code, e.target.value)}
                      className="block w-full max-w-md rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                    >
                      <option value="">— Catalogue default{catDefault ? ` (${catDefault.sku ?? catDefault.name})` : ""} —</option>
                      {options.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku ? `${p.sku} · ` : ""}{p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {templateOverrideCount === 0
          ? "This template uses the catalogue defaults for everything."
          : `${templateOverrideCount} override${templateOverrideCount === 1 ? "" : "s"} on this template.`}
      </p>
    </div>
  );
}
