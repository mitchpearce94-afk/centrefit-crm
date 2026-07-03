// Site-first migration step 1 (site-first-CONTEXT D2): split multi-site
// customers into per-site backing records.
//  - keeper site (most billing weight) keeps the ORIGINAL customer row —
//    GC/Xero couplings and null-site docs stay put.
//  - every other site gets a new backing customer (owner fields copied,
//    xero_contact_id = site's contact, else owner's), contacts moved/copied,
//    jobs/quotes/invoices/recurring_plans re-pointed via site_id,
//    nbn_enquiries re-pointed via their linked recurring plan.
// --dry to preview. Writes a full log to scripts/site-first-split-log.md.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry");
const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const DOC_TABLES = ["jobs", "quotes", "invoices", "recurring_plans"];
const log = [];
const say = (s) => { console.log(s); log.push(s); };

// Multi-site active customers (recomputed post-merge).
const { data: customers } = await sb
  .from("customers")
  .select("id, name, type, abn, notes, is_active, xero_contact_id, billing_email, customer_sites(id, name, suburb, xero_contact_id, billing_email, created_at)")
  .eq("is_active", true);
const multi = (customers ?? []).filter((c) => (c.customer_sites ?? []).length > 1);

say(`${DRY ? "[DRY RUN] " : ""}${multi.length} multi-site owners to split\n`);

async function countDocs(siteId) {
  const out = {};
  for (const t of DOC_TABLES) {
    const { count } = await sb.from(t).select("*", { count: "exact", head: true }).eq("site_id", siteId);
    out[t] = count ?? 0;
  }
  return out;
}

for (const owner of multi) {
  const sites = [];
  for (const s of owner.customer_sites) {
    const docs = await countDocs(s.id);
    const weight = docs.recurring_plans * 100 + docs.invoices * 10 + docs.jobs + docs.quotes;
    sites.push({ ...s, docs, weight });
  }
  sites.sort((a, b) => b.weight - a.weight || new Date(a.created_at) - new Date(b.created_at));
  const keeper = sites[0];
  say(`═ ${owner.name} (${sites.length} sites) — keeper: ${keeper.name} [w${keeper.weight}]`);

  for (const s of sites.slice(1)) {
    const label = `${s.name}${s.suburb ? ` — ${s.suburb}` : ""}`;
    if (DRY) {
      say(`  [dry] new backing customer for "${label}" (docs: ${JSON.stringify(s.docs)})`);
      continue;
    }
    // 1. New backing customer.
    const { data: created, error: insErr } = await sb.from("customers").insert({
      name: owner.name,
      type: owner.type,
      abn: owner.abn,
      notes: owner.notes,
      is_active: true,
      xero_contact_id: s.xero_contact_id ?? owner.xero_contact_id,
      billing_email: s.billing_email ?? owner.billing_email,
    }).select("id").single();
    if (insErr) { say(`  FAIL insert for ${label}: ${insErr.message}`); continue; }
    const newId = created.id;

    // 2. Contacts: site-specific rows move; general (null-site) rows are copied.
    const { data: movedContacts } = await sb.from("customer_contacts")
      .update({ customer_id: newId }).eq("customer_id", owner.id).eq("site_id", s.id).select("id");
    const { data: generalContacts } = await sb.from("customer_contacts")
      .select("*").eq("customer_id", owner.id).is("site_id", null);
    let copied = 0;
    for (const gc of generalContacts ?? []) {
      const { id: _drop, created_at: _c, updated_at: _u, ...rest } = gc;
      const { error } = await sb.from("customer_contacts").insert({ ...rest, customer_id: newId });
      if (!error) copied++;
    }

    // 3. Re-point the site itself, then its documents.
    const { error: siteErr } = await sb.from("customer_sites").update({ customer_id: newId }).eq("id", s.id);
    if (siteErr) { say(`  FAIL site re-point for ${label}: ${siteErr.message}`); continue; }
    const moved = {};
    for (const t of DOC_TABLES) {
      const { data } = await sb.from(t).update({ customer_id: newId })
        .eq("site_id", s.id).eq("customer_id", owner.id).select("id");
      moved[t] = data?.length ?? 0;
    }

    // 4. NBN enquiries follow their recurring plan.
    const { data: plansOfNew } = await sb.from("recurring_plans").select("id").eq("customer_id", newId);
    let nbnCount = 0;
    if ((plansOfNew ?? []).length > 0) {
      const { data } = await sb.from("nbn_enquiries").update({ customer_id: newId })
        .eq("customer_id", owner.id)
        .in("recurring_plan_id", plansOfNew.map((p) => p.id))
        .select("id");
      nbnCount = data?.length ?? 0;
    }

    say(`  ${label} → ${newId.slice(0, 8)} | contacts moved ${movedContacts?.length ?? 0} copied ${copied} | docs ${JSON.stringify(moved)} | nbn ${nbnCount}`);
  }
}

// Verification: no active customer should have >1 site any more.
const { data: after } = await sb
  .from("customers")
  .select("id, name, customer_sites(id)")
  .eq("is_active", true);
const still = (after ?? []).filter((c) => (c.customer_sites ?? []).length > 1);
say(`\nVerify: ${still.length} active customers still multi-site${still.length ? " — " + still.map((c) => c.name).join(", ") : " ✓"}`);

writeFileSync(new URL("./site-first-split-log.md", import.meta.url), log.join("\n"));
console.log("\nLog → scripts/site-first-split-log.md");
