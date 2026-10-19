"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

export interface AssetUnitRow {
  id: string;
  product_id: string;
  asset_type_id: string;
  quantity: number | string;
  device_name: string | null;
  manufacturer: string | null;
  model: string | null;
  sort_order: number;
}

interface AssetTypeLite { id: string; name: string }

const inputClass =
  "block w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

/**
 * "Receiving one of these puts … on the site asset register." A kit lists
 * several units (Veyla Protect kit → AI server + camera); a single device
 * lists one with its real make/model. No rows = fall back to the product's
 * asset-type tag above. Read by procurement Receive and the BOM→assets import.
 */
export function AssetUnitsPanel({
  product,
  units,
  assetTypes,
}: {
  product: { id: string; name: string };
  units: AssetUnitRow[];
  assetTypes: AssetTypeLite[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [typeId, setTypeId] = useState("");
  const [qty, setQty] = useState("1");
  const [deviceName, setDeviceName] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const typeName = (id: string) => assetTypes.find((t) => t.id === id)?.name ?? "Unknown type";

  async function save() {
    if (!typeId) { toast("Pick the asset type", "error"); return; }
    setBusy("new");
    try {
      const res = await fetch(`/api/products/${product.id}/asset-units`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset_type_id: typeId, quantity: Number(qty) || 1, device_name: deviceName, manufacturer, model, sort_order: units.length + 1 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      toast("Asset unit saved");
      setAdding(false); setTypeId(""); setQty("1"); setDeviceName(""); setManufacturer(""); setModel("");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: AssetUnitRow) {
    setBusy(row.id);
    try {
      const res = await fetch(`/api/products/${product.id}/asset-units`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Remove failed");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Remove failed", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Asset register — what receiving one of these adds
        </span>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="text-xs text-primary hover:underline">
            + Add unit
          </button>
        )}
      </div>
      {units.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground">
          Uses the asset type above (one asset per unit). List units here when this product is a kit of several trackable devices (e.g. AI server + camera) or needs its own make/model on the register.
        </p>
      )}
      {units.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {units.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="font-mono text-xs w-10 shrink-0 text-right">{Number(u.quantity)}×</span>
              <span className="min-w-0 flex-1 truncate">
                {u.device_name || typeName(u.asset_type_id)}
                <span className="ml-2 text-xs text-muted-foreground">
                  {typeName(u.asset_type_id)}{u.manufacturer || u.model ? ` · ${[u.manufacturer, u.model].filter(Boolean).join(" ")}` : ""}
                </span>
              </span>
              <button type="button" disabled={busy === u.id} onClick={() => remove(u)} className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-50">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div className="rounded-md border border-border bg-background p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <label className="block col-span-2">
              <span className="text-[11px] text-muted-foreground">Asset type</span>
              <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className={inputClass + " mt-1"}>
                <option value="">— pick —</option>
                {assetTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Qty per product</span>
              <input type="number" min={1} step="1" value={qty} onChange={(e) => setQty(e.target.value)} className={inputClass + " mt-1"} />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Device name</span>
              <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="e.g. Veyla AI Server" className={inputClass + " mt-1"} />
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Make</span>
              <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="e.g. Veyla" className={inputClass + " mt-1"} />
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Model</span>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. AI Server" className={inputClass + " mt-1"} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">Cancel</button>
            <button type="button" onClick={save} disabled={!typeId || busy === "new"} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {busy === "new" ? "Saving…" : "Add unit"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
