"use client";

import { useState } from "react";
import type { WorksheetRow } from "@/lib/finance/contacts";
import { ActionButton, money, usePost } from "../finance-actions";

interface Contact { contact_id: string; name: string }
interface Site { id: string; name: string }

const SUGGESTION: Record<string, { label: string; cls: string }> = {
  ok: { label: "Linked", cls: "bg-emerald-500/15 text-emerald-400" },
  key: { label: "Key it", cls: "bg-sky-500/15 text-sky-400" },
  "re-point": { label: "Re-point", cls: "bg-amber-500/15 text-amber-400" },
  split: { label: "Pick one", cls: "bg-amber-500/15 text-amber-400" },
  "no-carrier": { label: "No invoices found", cls: "bg-red-500/15 text-red-400" },
};

export function ContactsWorksheet({ rows, contacts, sites }: { rows: WorksheetRow[]; contacts: Contact[]; sites: Site[] }) {
  const [filter, setFilter] = useState<"todo" | "all">("todo");
  const shown = rows.filter((r) => filter === "all" || (r.status !== "linked" && r.status !== "ignored"));
  const linked = rows.filter((r) => r.status === "linked").length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{rows.length} GoCardless customers with a live mandate · {linked} linked</span>
        <span className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setFilter(filter === "todo" ? "all" : "todo")} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">{filter === "todo" ? "Show all" : "Show to-do"}</button>
          <ActionButton url="/api/finance/contacts" body={{ action: "refresh" }} label="Refresh from GoCardless" busyLabel="Refreshing…" okMessage="GoCardless customers refreshed" />
        </span>
      </div>
      {!rows.length ? <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No customers yet — press Refresh from GoCardless, then Run now on Payouts to fill the Xero mirror.</div> : null}
      <div className="space-y-2">
        {shown.map((r) => <Row key={r.gc_customer_id} r={r} contacts={contacts} sites={sites} />)}
      </div>
    </div>
  );
}

function Row({ r, contacts, sites }: { r: WorksheetRow; contacts: Contact[]; sites: Site[] }) {
  const { post, busy } = usePost();
  const best = r.candidates.find((c) => c.invoices > 0) ?? r.candidates[0];
  const [contactId, setContactId] = useState(r.xero_contact_id ?? best?.contact_id ?? "");
  const [query, setQuery] = useState("");
  const [canonical, setCanonical] = useState(r.canonical_name ?? r.crm_site ?? r.gc_name);
  const [siteId, setSiteId] = useState(r.crm_site_id ?? "");
  const hits = query.length >= 2 ? contacts.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8) : [];
  const chosen = contacts.find((c) => c.contact_id === contactId)?.name ?? r.candidates.find((c) => c.contact_id === contactId)?.name ?? "";
  const s = SUGGESTION[r.suggestion] ?? SUGGESTION.key;
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
        <span className="font-medium">{r.gc_name}</span>
        <span className="text-xs text-muted-foreground">{r.gc_email ?? ""} · {r.active_subs} sub{r.active_subs === 1 ? "" : "s"}{r.monthly_cents ? ` · ${money(r.monthly_cents)}/mo` : ""}{r.crm_site ? ` · CRM site “${r.crm_site}”` : " · no CRM site"}</span>
      </div>
      {r.candidates.length ? (
        <ul className="mt-2 grid gap-1 text-xs md:grid-cols-2">
          {r.candidates.map((c) => (
            <li key={c.contact_id}>
              <button type="button" onClick={() => { setContactId(c.contact_id); setQuery(""); }} className={`w-full rounded-md border px-2 py-1 text-left hover:bg-accent ${contactId === c.contact_id ? "border-primary bg-primary/10" : "border-border"}`}>
                <span className="font-medium">{c.name}</span>
                <span className="ml-2 text-muted-foreground">{c.invoices ? `${c.invoices} inv · ${money(Math.round(c.total * 100))} · last ${c.last} · ${c.amounts.join("/")}` : "no invoices since June"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <div className="mt-2 text-xs text-muted-foreground">No Xero contact looks like this customer. Search below.</div>}
      {r.status !== "linked" ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="relative">
            <label className="block text-[11px] uppercase tracking-wide text-muted-foreground">Xero contact</label>
            <input value={query || chosen} onChange={(e) => { setQuery(e.target.value); setContactId(""); }} placeholder="search Xero contacts…" className="w-64 rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
            {hits.length && !contactId ? (
              <ul className="absolute z-10 mt-1 max-h-56 w-64 overflow-auto rounded-md border border-border bg-card shadow-lg">
                {hits.map((c) => <li key={c.contact_id}><button type="button" className="block w-full px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => { setContactId(c.contact_id); setQuery(""); }}>{c.name}</button></li>)}
              </ul>
            ) : null}
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-muted-foreground">Canonical name</label>
            <input value={canonical} onChange={(e) => setCanonical(e.target.value)} className="w-56 rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-muted-foreground">CRM site</label>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-56 rounded-md border border-border bg-background px-2 py-1.5 text-sm">
              <option value="">— none —</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button type="button" disabled={!contactId || !canonical.trim() || !!busy} onClick={() => post("/api/finance/contacts", { action: "decide", gc_customer_id: r.gc_customer_id, xero_contact_id: contactId, canonical_name: canonical.trim(), site_id: siteId || null }, r.gc_customer_id, "Linked")} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">Link</button>
          {!r.active_subs ? <ActionButton url="/api/finance/contacts" body={{ action: "ignore", gc_customer_id: r.gc_customer_id, canonical_name: canonical }} label="Ignore (dormant)" okMessage="Ignored" /> : null}
        </div>
      ) : (
        <div className="mt-2 text-xs text-emerald-400">Linked to “{r.candidates.find((c) => c.contact_id === r.xero_contact_id)?.name ?? chosen}” as “{r.canonical_name}”.</div>
      )}
    </div>
  );
}
