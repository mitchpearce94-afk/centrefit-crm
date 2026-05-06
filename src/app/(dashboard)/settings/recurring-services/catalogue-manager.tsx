"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { XERO_SALES_ACCOUNTS, accountCodeLabel } from "@/lib/xero/account-codes";

interface Service {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_inc_gst: number | string;
  frequency: "monthly" | "yearly";
  account_code: string;
  active: boolean;
  sort_order: number;
}

export function CatalogueManager({ initialServices }: { initialServices: Service[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();
  const [services, setServices] = useState<Service[]>(initialServices);
  const [editing, setEditing] = useState<Service | null>(null);
  const [adding, setAdding] = useState(false);

  async function refresh() {
    const { data } = await supabase
      .from("recurring_services")
      .select("*")
      .order("sort_order");
    setServices((data ?? []) as Service[]);
    router.refresh();
  }

  async function toggleActive(svc: Service) {
    const { error } = await supabase
      .from("recurring_services")
      .update({ active: !svc.active })
      .eq("id", svc.id);
    if (error) toast(error.message, "error");
    else { toast(`${svc.name} ${!svc.active ? "activated" : "deactivated"}`); await refresh(); }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={() => setAdding(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + Add service
        </button>
      </div>

      <div className="surface-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Code</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Name</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider text-right">Price (incl. GST)</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Frequency</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Xero Account</th>
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wider">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {services.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground text-sm">No services yet — add one above.</td></tr>
            )}
            {services.map((svc) => (
              <tr key={svc.id} className={svc.active ? "" : "opacity-60"}>
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{svc.code}</td>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{svc.name}</div>
                  {svc.description && <div className="text-xs text-muted-foreground">{svc.description}</div>}
                </td>
                <td className="px-4 py-2.5 text-right font-mono">${Number(svc.price_inc_gst).toFixed(2)}</td>
                <td className="px-4 py-2.5 text-xs capitalize text-muted-foreground">{svc.frequency}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{accountCodeLabel(svc.account_code)}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs ${svc.active ? "text-emerald-400" : "text-muted-foreground"}`}>
                    {svc.active ? "Active" : "Deactivated"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right space-x-2">
                  <button onClick={() => setEditing(svc)} className="text-xs text-primary hover:underline">Edit</button>
                  <button onClick={() => toggleActive(svc)} className="text-xs text-muted-foreground hover:text-foreground">
                    {svc.active ? "Deactivate" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(adding || editing) && (
        <ServiceModal
          service={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={async () => { setAdding(false); setEditing(null); await refresh(); }}
        />
      )}
    </div>
  );
}

function ServiceModal({
  service,
  onClose,
  onSaved,
}: {
  service: Service | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const [code, setCode] = useState(service?.code ?? "");
  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [price, setPrice] = useState(service?.price_inc_gst != null ? String(service.price_inc_gst) : "");
  const [frequency, setFrequency] = useState<"monthly" | "yearly">(service?.frequency ?? "monthly");
  const [accountCode, setAccountCode] = useState(service?.account_code ?? "200");
  const [sortOrder, setSortOrder] = useState(service?.sort_order ?? 0);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!code.trim() || !name.trim() || !price) {
      toast("Code, name and price are required", "error");
      return;
    }
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 0) {
      toast("Price must be a non-negative number", "error");
      return;
    }
    setSaving(true);
    const payload = {
      code: code.trim(),
      name: name.trim(),
      description: description.trim() || null,
      price_inc_gst: priceNum,
      frequency,
      account_code: accountCode,
      sort_order: sortOrder,
    };
    const { error } = service
      ? await supabase.from("recurring_services").update(payload).eq("id", service.id)
      : await supabase.from("recurring_services").insert(payload);
    setSaving(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    toast(service ? "Service updated" : "Service added");
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl bg-background border border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-base font-semibold">{service ? "Edit service" : "Add service"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Code</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. nbn-100-20"
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. NBN Plan - 100/20"
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Description (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Price (incl. GST)</label>
              <input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Frequency</label>
              <select value={frequency} onChange={(e) => setFrequency(e.target.value as "monthly" | "yearly")}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Xero account (sales)</label>
            <select value={accountCode} onChange={(e) => setAccountCode(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary">
              {XERO_SALES_ACCOUNTS.map((a) => (
                <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
              ))}
              {!XERO_SALES_ACCOUNTS.find((a) => a.code === accountCode) && (
                <option value={accountCode}>{accountCode} (unknown)</option>
              )}
            </select>
            <p className="text-[10px] text-muted-foreground mt-1">Maps to the GL account on every Xero invoice line for this service.</p>
          </div>
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Sort order</label>
            <input type="number" value={sortOrder} onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
            <p className="text-[10px] text-muted-foreground mt-1">Lower numbers appear first in the wizard.</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3 bg-muted/30">
          <button onClick={onClose} disabled={saving} className="rounded-md border border-border px-4 py-1.5 text-sm hover:bg-accent disabled:opacity-50 transition-colors">Cancel</button>
          <button onClick={save} disabled={saving} className="rounded-md bg-primary px-5 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
