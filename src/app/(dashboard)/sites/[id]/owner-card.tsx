"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Owner card (site-first D2/D4). Two paths:
 *  - Edit details: fixes on the CURRENT owner record (typos, phone, email).
 *  - Change owner (admin, site sold): creates a NEW backing record via
 *    /api/sites/[id]/change-owner; history stays with the old owner.
 */
export interface OwnerInfo {
  id: string;
  name: string;
  abn: string | null;
  billing_email: string | null;
  /** Xero billing-entity override (customer_sites.invoice_name). Null = bill as site name. */
  invoiceName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

const inputClass =
  "w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function OwnerCard({
  siteId,
  owner,
  activePlanCount,
  isAdmin,
}: {
  siteId: string;
  owner: OwnerInfo;
  activePlanCount: number;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [mode, setMode] = useState<"view" | "edit" | "change">("view");
  const [busy, setBusy] = useState(false);
  const [sendDdSignup, setSendDdSignup] = useState(true);

  // Shared form state — seeded from the current owner in edit mode, blank in
  // change mode.
  const [form, setForm] = useState({
    name: "", abn: "", billingEmail: "", invoiceName: "", contactName: "", contactEmail: "", contactPhone: "",
  });

  function openEdit() {
    setForm({
      name: owner.name,
      abn: owner.abn ?? "",
      billingEmail: owner.billing_email ?? "",
      invoiceName: owner.invoiceName ?? "",
      contactName: owner.contactName ?? "",
      contactEmail: owner.contactEmail ?? "",
      contactPhone: owner.contactPhone ?? "",
    });
    setMode("edit");
  }

  function openChange() {
    setForm({ name: "", abn: "", billingEmail: "", invoiceName: "", contactName: "", contactEmail: "", contactPhone: "" });
    setSendDdSignup(true);
    setMode("change");
  }

  async function submit() {
    if (!form.name.trim()) {
      toast("Owner name is required", "error");
      return;
    }
    const isChange = mode === "change";
    // The DD signup email goes to billing email (falls back to contact email)
    // — catch the miss client-side rather than after the owner is created.
    if (isChange && sendDdSignup && activePlanCount > 0 && !form.billingEmail.trim() && !form.contactEmail.trim()) {
      toast("Add a billing or contact email so the new owner can receive the direct-debit signup", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/${isChange ? "change-owner" : "owner"}`, {
        method: isChange ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          abn: form.abn.trim() || null,
          billingEmail: form.billingEmail.trim() || null,
          invoiceName: form.invoiceName.trim() || null,
          contactName: form.contactName.trim() || null,
          contactEmail: form.contactEmail.trim() || null,
          contactPhone: form.contactPhone.trim() || null,
          ...(isChange ? { sendDdSignup } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Save failed", "error");
        setBusy(false);
        return;
      }
      if (isChange) {
        const sent = (json.remandate ?? []).filter((r: { ok: boolean }) => r.ok).length;
        const failedCount = (json.remandate ?? []).filter((r: { ok: boolean }) => !r.ok).length;
        if (failedCount > 0) {
          toast(`Owner changed, but the DD signup failed for ${failedCount} plan(s) — check the plan page.`, "error");
        } else if (sent > 0) {
          toast(`Owner changed. DD signup emailed for ${sent} plan(s) — billing swaps when they sign.`);
        } else {
          toast(
            json.activePlansNeedingRemandate > 0
              ? `Owner changed. ${json.activePlansNeedingRemandate} recurring plan(s) still need a new mandate for the new owner.`
              : "Owner changed.",
          );
        }
      } else {
        toast("Owner details updated");
      }
      setMode("view");
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Network error", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Owner</h3>
        {mode === "view" && (
          <div className="flex gap-2">
            <button onClick={openEdit} className="text-xs text-primary hover:underline">Edit details</button>
            {isAdmin && (
              <button onClick={openChange} className="text-xs text-amber-400 hover:underline">Change owner</button>
            )}
          </div>
        )}
      </div>

      {mode === "view" && (
        <div className="mt-2 space-y-1 text-sm">
          <p className="font-medium text-foreground">{owner.name}</p>
          {owner.contactName && owner.contactName !== owner.name && (
            <p className="text-muted-foreground">{owner.contactName}</p>
          )}
          {owner.contactEmail && <p className="text-muted-foreground font-mono text-xs">{owner.contactEmail}</p>}
          {owner.contactPhone && <p className="text-muted-foreground text-xs">{owner.contactPhone}</p>}
          {owner.billing_email && owner.billing_email !== owner.contactEmail && (
            <p className="text-xs text-muted-foreground">Billing: <span className="font-mono">{owner.billing_email}</span></p>
          )}
          {owner.invoiceName && (
            <p className="text-xs text-muted-foreground">Invoices bill to: <span className="font-medium text-foreground">{owner.invoiceName}</span></p>
          )}
          {owner.abn && <p className="text-xs text-muted-foreground">ABN {owner.abn}</p>}
          {/* Customer ID — deliberately surfaced ONLY here (site-first spec:
              the CCTV/asset bulk imports key on it). Click to copy. */}
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(owner.id).then(
                () => toast("Customer ID copied"),
                () => toast("Couldn't copy — select it manually", "error"),
              );
            }}
            title="Click to copy (used by the asset import spreadsheets)"
            className="block text-[10px] text-muted-foreground/60 font-mono hover:text-muted-foreground transition-colors"
          >
            Customer ID: {owner.id}
          </button>
        </div>
      )}

      {mode !== "view" && (
        <div className="mt-3 space-y-2">
          {mode === "change" && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-300 leading-relaxed">
              <p className="font-medium">Site sold — new owner takes over.</p>
              <p className="mt-0.5 text-amber-300/80">
                A new owner record is created; all history (jobs, quotes, invoices, plans) stays with the previous owner to match the Xero paper trail.
                {activePlanCount > 0 && (
                  <> This site has <strong>{activePlanCount} recurring plan{activePlanCount === 1 ? "" : "s"}</strong> collecting from the previous owner&apos;s bank.</>
                )}
              </p>
              {activePlanCount > 0 && (
                <label className="mt-2 flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={sendDdSignup}
                    onChange={(e) => setSendDdSignup(e.target.checked)}
                    className="mt-0.5 accent-amber-500"
                  />
                  <span className="text-amber-300/90">
                    Email the new owner a direct-debit signup now (recommended). Billing swaps to their bank automatically when they sign; the previous owner&apos;s mandate keeps collecting until then.
                  </span>
                </label>
              )}
            </div>
          )}
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">{mode === "change" ? "New owner / entity name *" : "Owner / entity name *"}</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass + " mt-1"} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">ABN</span>
              <input value={form.abn} onChange={(e) => setForm({ ...form, abn: e.target.value })} className={inputClass + " mt-1"} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Billing email</span>
              <input value={form.billingEmail} onChange={(e) => setForm({ ...form, billingEmail: e.target.value })} className={inputClass + " mt-1"} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Invoice name (Xero contact)</span>
            <input
              value={form.invoiceName}
              onChange={(e) => setForm({ ...form, invoiceName: e.target.value })}
              placeholder="Leave blank to bill as the site name"
              className={inputClass + " mt-1"}
            />
            <span className="mt-1 block text-[10px] text-muted-foreground">
              Set this when the owner&apos;s accounts team needs the legal entity on invoices (e.g. &quot;Bravofit Oxley Pty Ltd&quot;). New Xero contacts are created under this name.
            </span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Contact name</span>
              <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} className={inputClass + " mt-1"} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Contact email</span>
              <input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} className={inputClass + " mt-1"} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Mobile</span>
              <input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} className={inputClass + " mt-1"} />
            </label>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={submit}
              disabled={busy}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${mode === "change" ? "bg-amber-600 hover:bg-amber-500" : "bg-primary hover:bg-primary/90"}`}
            >
              {busy ? "Saving..." : mode === "change" ? "Create new owner & re-point site" : "Save"}
            </button>
            <button onClick={() => setMode("view")} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
