"use client";

import { useState } from "react";
import { ActionButton, money, usePost } from "../finance-actions";

interface Item {
  id: string; kind: string; title: string; evidence: Record<string, unknown>; payout_id: string | null; payout_item_id: string | null; gc_customer_id: string | null; created_at: string;
  finance_payouts: { arrival_date: string; provider_payout_id: string } | null;
}
interface Inv { invoice_id: string; invoice_number: string | null; contact_id: string; contact_name: string | null; status: string; date: string | null; total: number | null; amount_due: number | null }
interface Contact { contact_id: string; name: string }

const KIND_LABEL: Record<string, string> = {
  contact_unlinked: "Which Xero contact?",
  invoice_missing: "No invoice to pay",
  invoice_ambiguous: "Several invoices could be it",
};

export function ReviewList({ items, invoices, contacts }: { items: Item[]; invoices: Inv[]; contacts: Contact[] }) {
  if (!items.length) return <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nothing to review. Every payment matched, or a run hasn&apos;t happened yet.</div>;
  const byKind: Record<string, Item[]> = {};
  for (const it of items) (byKind[it.kind] ??= []).push(it);
  return (
    <div className="space-y-6">
      {Object.entries(byKind).map(([kind, list]) => (
        <section key={kind}>
          <h2 className="mb-2 text-sm font-semibold">{KIND_LABEL[kind] ?? kind} <span className="text-muted-foreground">({list.length})</span></h2>
          <div className="space-y-2">
            {list.map((it) => <ReviewCard key={it.id} item={it} invoices={invoices.filter((i) => i.contact_id === (it.evidence.xero_contact_id as string))} contacts={contacts} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function ReviewCard({ item, invoices, contacts }: { item: Item; invoices: Inv[]; contacts: Contact[] }) {
  const { post, busy } = usePost();
  const ev = item.evidence;
  const [contactQuery, setContactQuery] = useState("");
  const [contactId, setContactId] = useState("");
  const [canonical, setCanonical] = useState(String(ev.xero_contact_name ?? ev.description ?? ""));
  const [invoiceId, setInvoiceId] = useState("");
  const hits = contactQuery.length >= 2 ? contacts.filter((c) => c.name.toLowerCase().includes(contactQuery.toLowerCase())).slice(0, 8) : [];
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-medium">{item.title}</div>
        <div className="text-xs text-muted-foreground">{item.finance_payouts ? `payout ${item.finance_payouts.arrival_date}` : ""}</div>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {typeof ev.amount_cents === "number" ? <span className="mr-2">{money(ev.amount_cents as number)}</span> : null}
        {ev.charge_date ? <span className="mr-2">charged {String(ev.charge_date)}</span> : null}
        {ev.description ? <span className="mr-2">“{String(ev.description)}”</span> : null}
        {ev.note ? <div className="mt-1">{String(ev.note)}</div> : null}
        {ev.how ? <div className="mt-1">{String(ev.how)}</div> : null}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        {item.kind === "contact_unlinked" ? (
          <>
            <div className="relative">
              <label className="block text-[11px] uppercase tracking-wide text-muted-foreground">Xero contact</label>
              <input value={contactQuery} onChange={(e) => { setContactQuery(e.target.value); setContactId(""); }} placeholder="type to search…" className="w-64 rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
              {hits.length && !contactId ? (
                <ul className="absolute z-10 mt-1 max-h-56 w-64 overflow-auto rounded-md border border-border bg-card shadow-lg">
                  {hits.map((c) => <li key={c.contact_id}><button type="button" className="block w-full px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => { setContactId(c.contact_id); setContactQuery(c.name); if (!canonical) setCanonical(c.name); }}>{c.name}</button></li>)}
                </ul>
              ) : null}
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-muted-foreground">Canonical name (site)</label>
              <input value={canonical} onChange={(e) => setCanonical(e.target.value)} className="w-56 rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
            </div>
            <button type="button" disabled={!contactId || !canonical || !!busy} onClick={() => post("/api/finance/review", { id: item.id, action: "link_contact", xero_contact_id: contactId, canonical_name: canonical, site_id: ev.site_id ?? null }, item.id, "Linked — re-matching on the next run")} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">Link</button>
          </>
        ) : null}

        {(item.kind === "invoice_missing" || item.kind === "invoice_ambiguous") ? (
          <>
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-muted-foreground">Pay this invoice instead</label>
              <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} className="w-80 rounded-md border border-border bg-background px-2 py-1.5 text-sm">
                <option value="">— choose from {String(ev.xero_contact_name ?? "this contact")} —</option>
                {invoices.map((i) => <option key={i.invoice_id} value={i.invoice_id}>{i.invoice_number} · {i.date} · {money(Math.round(Number(i.total ?? 0) * 100))} · {i.status}{i.status !== "PAID" && i.amount_due != null ? ` (due ${money(Math.round(Number(i.amount_due) * 100))})` : ""}</option>)}
              </select>
            </div>
            <button type="button" disabled={!invoiceId || !!busy} onClick={() => post("/api/finance/review", { id: item.id, action: "link_invoice", invoice_id: invoiceId }, item.id, "Linked")} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">Use it</button>
            <ActionButton url="/api/finance/review" body={{ id: item.id, action: "skip_payment", note: "no invoice — raise one / refund" }} label="Skip this payment" confirm="Leave this payment unposted? It stays out of the payout until you deal with it." okMessage="Skipped" />
          </>
        ) : null}

        <ActionButton url="/api/finance/review" body={{ id: item.id, action: "dismiss" }} label="Dismiss" variant="secondary" okMessage="Dismissed" />
      </div>
    </div>
  );
}
