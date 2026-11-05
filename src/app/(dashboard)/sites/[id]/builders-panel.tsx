"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { XeroContactPicker } from "@/components/xero-contact-picker";

/**
 * Builders on a site (docs/job-lifecycle-CONTEXT.md D9). As many as tender
 * for the site; each is a separate billing party with its own Xero contact.
 * The owner, the recurring plans and the mandates never read anything here.
 */
export interface BuilderInfo {
  id: string;
  name: string;
  abn: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  xeroContactId: string | null;
}

type Form = { name: string; abn: string; contactName: string; email: string; phone: string; address: string; notes: string };
const emptyForm: Form = { name: "", abn: "", contactName: "", email: "", phone: "", address: "", notes: "" };
const inputClass =
  "w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function BuildersPanel({ siteId, builders }: { siteId: string; builders: BuilderInfo[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [busy, setBusy] = useState(false);

  function startEdit(b: BuilderInfo | null) {
    setForm(b ? { name: b.name, abn: b.abn ?? "", contactName: b.contactName ?? "", email: b.email ?? "", phone: b.phone ?? "", address: b.address ?? "", notes: b.notes ?? "" } : emptyForm);
    setEditing(b ? b.id : "new");
  }

  async function save() {
    if (!form.name.trim()) { toast("Builder name is required", "error"); return; }
    setBusy(true);
    const isNew = editing === "new";
    const res = await fetch(isNew ? `/api/sites/${siteId}/builders` : `/api/sites/${siteId}/builders/${editing}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { toast(j.error || "Couldn't save the builder", "error"); return; }
    toast(isNew ? "Builder added" : "Builder saved");
    setEditing(null);
    router.refresh();
  }

  async function remove(b: BuilderInfo) {
    if (!confirm(`Remove ${b.name} from this site? Existing invoices keep their billed-to name.`)) return;
    setBusy(true);
    const res = await fetch(`/api/sites/${siteId}/builders/${b.id}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { toast(j.error || "Couldn't remove the builder", "error"); return; }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Builders</h3>
          <p className="text-[11px] text-muted-foreground">
            Everyone who might pay for the install. Tender a quote to any of them; whoever accepts is invoiced. The owner stays on the recurring plans and direct debits.
          </p>
        </div>
        {editing === null && (
          <button onClick={() => startEdit(null)} className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
            Add builder
          </button>
        )}
      </div>

      {editing === "new" && (
        <BuilderForm form={form} setForm={setForm} busy={busy} onSave={save} onCancel={() => setEditing(null)} title="Add builder" />
      )}

      {builders.length === 0 && editing === null && (
        <div className="rounded-lg border border-dashed border-border p-5 text-xs text-muted-foreground">
          No builders on this site yet.
        </div>
      )}

      {builders.map((b) =>
        editing === b.id ? (
          <BuilderForm key={b.id} form={form} setForm={setForm} busy={busy} onSave={save} onCancel={() => setEditing(null)} title={`Edit ${b.name}`} />
        ) : (
          <BuilderCard key={b.id} siteId={siteId} builder={b} busy={busy} onEdit={() => startEdit(b)} onRemove={() => remove(b)} />
        ),
      )}
    </div>
  );
}

function BuilderCard({ siteId, builder, busy, onEdit, onRemove }: { siteId: string; builder: BuilderInfo; busy: boolean; onEdit: () => void; onRemove: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pickingXero, setPickingXero] = useState(false);
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

  async function linkXero(id: string | null) {
    const res = await fetch(`/api/sites/${siteId}/builders/${builder.id}`, {
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

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold">{builder.name}</p>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={onEdit} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent">Edit</button>
          <button onClick={onRemove} disabled={busy} className="rounded-md border border-border px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50">Remove</button>
        </div>
      </div>
      <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <Row label="ABN" value={builder.abn} />
        <Row label="Contact" value={builder.contactName} />
        <Row label="Invoice email" value={builder.email} />
        <Row label="Phone" value={builder.phone} />
        <Row label="Address" value={builder.address} />
        {builder.notes && <div className="sm:col-span-2"><Row label="Notes" value={builder.notes} /></div>}
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Xero contact:</span>
        {builder.xeroContactId ? (
          <span className="font-medium">{xeroName ?? "linked"}</span>
        ) : (
          <span className="italic text-muted-foreground">created from the name on the first invoice</span>
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
          title={`Link ${builder.name}'s Xero contact`}
          intro="Pick the contact this builder's invoices should go to. Leave unlinked and the first invoice creates one from the name."
          currentId={builder.xeroContactId}
          onClose={() => setPickingXero(false)}
          onPick={(c) => linkXero(c.id)}
        />
      )}
    </div>
  );
}

function BuilderForm({ form, setForm, busy, onSave, onCancel, title }: { form: Form; setForm: (f: Form) => void; busy: boolean; onSave: () => void; onCancel: () => void; title: string }) {
  return (
    <div className="rounded-lg border border-primary/40 bg-card p-4 space-y-3">
      <h4 className="text-sm font-semibold">{title}</h4>
      <Field label="Builder / company name *"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Unita Group Pty Ltd" autoFocus /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ABN"><input className={inputClass} value={form.abn} onChange={(e) => setForm({ ...form, abn: e.target.value })} /></Field>
        <Field label="Contact person"><input className={inputClass} value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
        <Field label="Email (quotes + invoices)"><input className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="estimating@builder.com.au" /></Field>
        <Field label="Phone"><input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
      </div>
      <Field label="Postal / billing address"><input className={inputClass} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
      <Field label="Notes"><textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="PO number required on invoices, who approves, etc." /></Field>
      <div className="flex items-center gap-2 pt-1">
        <button onClick={onSave} disabled={busy} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {busy ? "Saving…" : "Save builder"}
        </button>
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
      </div>
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
