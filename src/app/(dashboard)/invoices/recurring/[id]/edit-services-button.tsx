"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

interface CatalogueService {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_inc_gst: number | string;
  frequency: "monthly" | "yearly";
}

interface CurrentItem {
  serviceId: string;
  quantity: number;
}

/**
 * Edit-services modal for an existing recurring plan. Lets staff add /
 * remove / change quantities on the services attached to the plan. The
 * mandate stays as-is — DD authority is amount-agnostic, the next debit
 * just reflects the new total.
 *
 * Already-issued child invoices for the current period don't change;
 * Xero pushes the new lineItems forward from the next scheduled run.
 */
export function EditServicesButton({
  planId,
  catalogue,
  currentItems,
}: {
  planId: string;
  catalogue: CatalogueService[];
  currentItems: CurrentItem[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [items, setItems] = useState<Map<string, number>>(new Map());

  // Reset state when the modal opens — pull from currentItems so user always
  // sees the live state if they cancel and reopen.
  useEffect(() => {
    if (open) {
      setItems(new Map(currentItems.map((i) => [i.serviceId, i.quantity])));
    }
  }, [open, currentItems]);

  const totals = useMemo(() => {
    let monthly = 0, yearly = 0;
    for (const [svcId, qty] of items.entries()) {
      const svc = catalogue.find((s) => s.id === svcId);
      if (!svc) continue;
      const line = Number(svc.price_inc_gst) * qty;
      if (svc.frequency === "monthly") monthly += line;
      else yearly += line;
    }
    return { monthly, yearly };
  }, [items, catalogue]);

  function toggle(svcId: string) {
    setItems((prev) => {
      const next = new Map(prev);
      if (next.has(svcId)) next.delete(svcId);
      else next.set(svcId, 1);
      return next;
    });
  }

  function setQty(svcId: string, qty: number) {
    if (qty < 1) qty = 1;
    setItems((prev) => {
      if (!prev.has(svcId)) return prev;
      const next = new Map(prev);
      next.set(svcId, qty);
      return next;
    });
  }

  async function save() {
    if (items.size === 0) {
      toast("Must keep at least one service. Cancel the plan if you want to stop everything.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/recurring-plans/${planId}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: Array.from(items.entries()).map(([serviceId, quantity]) => ({ serviceId, quantity })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Update failed", "error");
        setSubmitting(false);
        return;
      }
      if (json.warnings?.length) {
        toast(`Updated with warnings: ${json.warnings.join("; ")}`, "error");
      } else {
        toast("Plan updated — next invoice will reflect the new services");
      }
      setOpen(false);
      setSubmitting(false);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Network error", "error");
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
      >
        Edit services
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onMouseDown={() => !submitting && setOpen(false)} />
          <div
            className="relative w-full max-w-xl max-h-[90dvh] overflow-hidden rounded-xl bg-background border border-border shadow-2xl flex flex-col"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div>
                <h3 className="text-base font-semibold">Edit services</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Changes apply from the next billing cycle. Already-issued invoices aren't affected.</p>
              </div>
              <button onClick={() => setOpen(false)} disabled={submitting} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-1">
              {catalogue.map((svc) => {
                const selected = items.has(svc.id);
                const qty = items.get(svc.id) ?? 1;
                return (
                  <label
                    key={svc.id}
                    className="flex items-center gap-3 px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggle(svc.id)}
                      className="h-4 w-4 rounded accent-primary"
                    />
                    <span className="flex-1 text-sm">{svc.name}</span>
                    {selected && (
                      <input
                        type="number"
                        min={1}
                        value={qty}
                        onChange={(e) => setQty(svc.id, parseInt(e.target.value) || 1)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-14 rounded-md border border-border bg-input px-2 py-0.5 text-xs text-right"
                      />
                    )}
                    <span className="font-mono text-xs text-muted-foreground w-28 text-right">
                      ${Number(svc.price_inc_gst).toFixed(2)}/{svc.frequency === "monthly" ? "mo" : "yr"}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="border-t border-border px-5 py-3 bg-muted/30 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Monthly recurring</span>
                <span className="font-mono">${totals.monthly.toFixed(2)}</span>
              </div>
              {totals.yearly > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Yearly recurring</span>
                  <span className="font-mono">${totals.yearly.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm border-t border-border pt-2">
                <span className="text-muted-foreground">Effective MRR</span>
                <span className="font-mono font-semibold">${(totals.monthly + totals.yearly / 12).toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button onClick={() => setOpen(false)} disabled={submitting} className="rounded-md border border-border px-4 py-1.5 text-sm hover:bg-accent disabled:opacity-50 transition-colors">
                  Cancel
                </button>
                <button onClick={save} disabled={submitting} className="rounded-md bg-primary px-5 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
                  {submitting ? "Saving..." : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
