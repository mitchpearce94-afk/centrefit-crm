"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { XeroContactPicker } from "@/components/xero-contact-picker";

/**
 * Builder card (docs/job-lifecycle-CONTEXT.md D1). The builder is a separate
 * billing party beside the owner: invoices ticked "Bill the builder" go to
 * this entity's own Xero contact. The owner, the recurring plans and the
 * mandates never read anything here.
 */
export interface BuilderInfo {
  name: string | null;
  abn: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  xeroContactId: string | null;
}

const inputClass =
  "w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function BuilderCard({ siteId, builder }: { siteId: string; builder: BuilderInfo }) {
  const router = useRouter();
  const { toast } = useToast();
  const hasBuilder = !!builder.name;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: builder.name ?? "",
    abn: builder.abn ?? "",
    contactName: builder.contactName ?? "",
    email: builder.email ?? "",
    phone: builder.phone ?? "",
    address: builder.address ?? "",
    notes: builder.notes ?? "",
  });
  const [pickingXero, setPickingXero] = useState(false);
  // Linked Xero contact name, looked up lazily so the page never waits on
  // Xero. Keyed by id so a re-link never shows the old name.
  const [xero, setXero] = useState<{ id: string; name: string } | null>(null);
  const xeroName = xero && xero.id === builder.xeroContactId ? xero.name : null;

  useEffect(() => {
    const id = builder.xeroContactId;
    if (!id) return;
    let cancelled = false;
    fetch(`/api/xero/contacts?id=${encodeURIComponent(id)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!cancelled && r.ok && j.contact?.name) setXero({ id, name: j.contact.name });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [builder.xeroContactId]);

  async function save() {
    if (!form.name.trim()) { toast("Builder name is required", "error"); return; }
    setBusy(true);
    const res = await fetch(`/api/sites/${siteId}/builder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { toast(j.error || "Couldn't save the builder", "error"); return; }
    toast("Builder saved");
    setEditing(false);
    router.refresh();
  }

  async function clear() {
    if (!confirm("Remove the builder from this site? Existing invoices keep their billed-to name.")) return;
    setBusy(true);
    const res = await fetch(`/api/sites/${siteId}/builder`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) { toast("Couldn't remove the builder", "error"); return; }
    setForm({ name: "", abn: "", contactName: "", email: "", phone: "", address: "", notes: "" });
    router.refresh();
  }

  async function linkXero(id: string | null) {
    const res = await fetch(`/api/sites/${siteId}/builder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ xeroContactId: id }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { toast(j.error || "Couldn't update the Xero contact", "error"); return; }
    toast(id ? "Xero contact linked" : "Xero contact unlinked");
    setPickingXero(false);
    router.refresh();
  }

  if (!hasBuilder && !editing) {
    return (
      <div className="rounded-lg border border-dashed border-border p-5">
        <h3 className="text-sm font-semibold">Builder</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          No builder on this site. Add one when the builder (not the owner) pays the install invoice.
          The owner stays on the recurring plans and direct debits either way.
        </p>
        <button onClick={() => setEditing(true)} className="mt-3 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
          Add builder
        </button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 space-y-3">
        <h3 className="text-sm font-semibold">{hasBuilder ? "Edit builder" : "Add builder"}</h3>
        <Field label="Builder / company name *"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Unita Group Pty Ltd" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ABN"><input className={inputClass} value={form.abn} onChange={(e) => setForm({ ...form, abn: e.target.value })} /></Field>
          <Field label="Contact person"><input className={inputClass} value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
          <Field label="Invoice email"><input className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="accounts@builder.com.au" /></Field>
          <Field label="Phone"><input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        </div>
        <Field label="Postal / billing address"><input className={inputClass} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
        <Field label="Notes"><textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="PO number required on invoices, who approves, etc." /></Field>
        <div className="flex items-center gap-2 pt-1">
          <button onClick={save} disabled={busy} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {busy ? "Saving…" : "Save builder"}
          </button>
          <button onClick={() => setEditing(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Builder</h3>
          <p className="text-[11px] text-muted-foreground">Bills here when an invoice is ticked “Bill the builder”. Owner billing is untouched.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setEditing(true)} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent">Edit</button>
          <button onClick={clear} disabled={busy} className="rounded-md border border-border px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50">Remove</button>
        </div>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Row label="Company" value={builder.name} />
        <Row label="ABN" value={builder.abn} />
        <Row label="Contact" value={builder.contactName} />
        <Row label="Phone" value={builder.phone} />
        <Row label="Invoice email" value={builder.email} />
        <Row label="Address" value={builder.address} />
        {builder.notes && <div className="sm:col-span-2"><Row label="Notes" value={builder.notes} /></div>}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Xero contact:</span>
        {builder.xeroContactId ? (
          <span className="font-medium">{xeroName ?? "linked"}</span>
        ) : (
          <span className="italic text-muted-foreground">created from the name on the first builder invoice</span>
        )}
        <button onClick={() => setPickingXero(true)} className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent">
          {builder.xeroContactId ? "Change" : "Link existing"}
        </button>
        {builder.xeroContactId && (
          <button onClick={() => linkXero(null)} className="text-[11px] text-muted-foreground hover:text-foreground">Unlink</button>
        )}
      </div>
      {pickingXero && (
        <XeroContactPicker
          title="Link the builder's Xero contact"
          intro="Pick the contact the builder's invoices should go to. Leave unlinked and the first builder invoice creates one from the name above."
          currentId={builder.xeroContactId}
          onClose={() => setPickingXero(false)}
          onPick={(c) => linkXero(c.id)}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}
