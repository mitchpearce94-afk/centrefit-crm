// Site-first migration: merge the 7 duplicate site/customer cases
// (2026-07-03, per split-list review). Every move is by pinned ID; sites are
// deleted only after verifying zero remaining references; customers are
// deactivated, never deleted. --dry to preview.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry");
const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const SITE_REF_TABLES = ["jobs", "quotes", "invoices", "recurring_plans", "customer_contacts", "site_assets", "site_key_info_photos"];
const CUST_REF_TABLES = ["jobs", "quotes", "invoices", "recurring_plans", "customer_contacts", "nbn_enquiries", "nbn_orders", "pipeline_deals", "plan_files", "customer_sites"];

async function count(table, col, id) {
  const { count: n, error } = await sb.from(table).select("*", { count: "exact", head: true }).eq(col, id);
  if (error) throw new Error(`${table}.${col} count: ${error.message}`);
  return n ?? 0;
}

async function move(table, where, patch, label) {
  if (DRY) {
    let q = sb.from(table).select("*", { count: "exact", head: true });
    for (const [k, v] of Object.entries(where)) q = v === null ? q.is(k, null) : q.eq(k, v);
    const { count: n } = await q;
    console.log(`  [dry] ${label}: would update ${n ?? 0} ${table} rows`);
    return;
  }
  let q = sb.from(table).update(patch);
  for (const [k, v] of Object.entries(where)) q = v === null ? q.is(k, null) : q.eq(k, v);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`${label}: ${error.message}`);
  console.log(`  ${label}: moved ${data?.length ?? 0} ${table} rows`);
}

async function deleteSite(siteId, name) {
  for (const t of SITE_REF_TABLES) {
    const n = await count(t, "site_id", siteId);
    if (n > 0) {
      // In dry mode earlier moves haven't run, so refs that WILL move still
      // show — warn instead of aborting. Live mode stays strict.
      if (DRY) { console.log(`  [dry] delete site "${name}" — ${n} ${t} refs remain pre-move (must be 0 live)`); continue; }
      throw new Error(`refuse to delete site ${name} (${siteId}) — ${n} ${t} rows still reference it`);
    }
  }
  if (DRY) { console.log(`  [dry] delete site "${name}" (${siteId})`); return; }
  const { error } = await sb.from("customer_sites").delete().eq("id", siteId);
  if (error) throw new Error(`delete site ${name}: ${error.message}`);
  console.log(`  deleted site "${name}" (${siteId})`);
}

async function deactivateCustomer(custId, name) {
  for (const t of CUST_REF_TABLES) {
    const n = await count(t, "customer_id", custId);
    if (n > 0) console.log(`  note: customer "${name}" still has ${n} ${t} rows (left in place)`);
  }
  if (DRY) { console.log(`  [dry] deactivate customer "${name}" (${custId})`); return; }
  const { error } = await sb.from("customers").update({ is_active: false }).eq("id", custId);
  if (error) throw new Error(`deactivate ${name}: ${error.message}`);
  console.log(`  deactivated customer "${name}" (${custId})`);
}

const step = (n, title) => console.log(`\n═ M${n} ${title}`);

try {
  step(1, "Atlan Stormwater — drop empty duplicate site+customer");
  for (const t of ["customer_contacts", "nbn_enquiries", "nbn_orders", "pipeline_deals", "plan_files"]) {
    await move(t, { customer_id: "9e8e423e-40c2-430f-802f-699e3a34e55f" }, { customer_id: "415caec9-a19c-4edc-b759-b79365a507f3" }, `${t} dupe→survivor`);
  }
  await deleteSite("c1ce0192-c2d2-43a3-86b4-0f36a9bc2e18", "Atlan Stormwater (empty dupe)");
  await deactivateCustomer("9e8e423e-40c2-430f-802f-699e3a34e55f", "Atlan Stormwater (dupe)");

  step(2, "Glen Waverley — keep plan-bearing site, take canonical name");
  await deleteSite("510d39f6-5fae-4d4c-abce-c839963536dc", "Snap Fitness Glen Waverley (empty)");
  if (!DRY) {
    const { error } = await sb.from("customer_sites").update({ name: "Snap Fitness Glen Waverley" }).eq("id", "069aa102-c3c9-4a8e-8e1e-477ce12ed6bc");
    if (error) throw new Error(`rename SF Glen Waverley: ${error.message}`);
    console.log(`  renamed site "SF Glen Waverley" → "Snap Fitness Glen Waverley"`);
  } else console.log(`  [dry] rename site "SF Glen Waverley" → "Snap Fitness Glen Waverley"`);

  step(3, "Beveridge — fold standalone customers into Workspace 360's site");
  await move("jobs", { site_id: "59f277f7-6931-41c6-89d1-bdd98643c812" }, { site_id: "d0403222-d51e-43c5-8adb-54af9cbc3c4e", customer_id: "feb2e6b2-df0e-423c-b208-8c324e6affcb" }, "jobs standalone→W360");
  for (const dupeCust of ["61cd75e0-a2ed-476d-a290-60f02cb88834", "9ccc1ea4-fbb3-47e3-a4f0-1263cb3d5637"]) {
    for (const t of ["customer_contacts", "nbn_enquiries", "nbn_orders", "pipeline_deals", "plan_files", "jobs", "quotes", "invoices"]) {
      await move(t, { customer_id: dupeCust }, { customer_id: "feb2e6b2-df0e-423c-b208-8c324e6affcb" }, `${t} ${dupeCust.slice(0, 8)}→W360`);
    }
  }
  await deleteSite("59f277f7-6931-41c6-89d1-bdd98643c812", "Snap Fitness Beveridge (standalone)");
  await deleteSite("0b41b8b0-cb1c-4b54-88c3-b878e8d1ae34", "Snap Fitness Beveridge — Beveridge");
  await deactivateCustomer("61cd75e0-a2ed-476d-a290-60f02cb88834", "Snap Fitness Beveridge (dupe 1)");
  await deactivateCustomer("9ccc1ea4-fbb3-47e3-a4f0-1263cb3d5637", "Snap Fitness Beveridge (dupe 2)");

  step(4, "Croydon — fold standalone customer into Workspace 360's site");
  await move("jobs", { customer_id: "ad352982-330d-464a-8066-78a566ab2a53" }, { customer_id: "feb2e6b2-df0e-423c-b208-8c324e6affcb", site_id: "8c981381-bf83-4f17-b1ed-0d04cb53aa97" }, "jobs standalone→W360 Croydon");
  for (const t of ["customer_contacts", "nbn_enquiries", "nbn_orders", "pipeline_deals", "plan_files", "quotes", "invoices"]) {
    await move(t, { customer_id: "ad352982-330d-464a-8066-78a566ab2a53" }, { customer_id: "feb2e6b2-df0e-423c-b208-8c324e6affcb" }, `${t} standalone→W360`);
  }
  await deleteSite("9e3e032c-08a3-4c8b-83f7-e391466915b5", "Snap Fitness Croydon (standalone, empty)");
  await deactivateCustomer("ad352982-330d-464a-8066-78a566ab2a53", "Snap Fitness Croydon (dupe)");

  step(5, "Helensvale — drop Rob Purcell's empty duplicate site (history stays on standalone)");
  await deleteSite("c7abb890-3439-4150-8a03-70be7eb1f38a", "Snap Fitness Helensvale (Purcell, empty)");

  step(6, "Wollert — consolidate onto the plan-bearing site");
  for (const t of ["jobs", "quotes", "invoices"]) {
    await move(t, { site_id: "289e1b0f-2113-4ad6-bad6-2cfa2b3fb441" }, { site_id: "eead4649-2f20-4abb-80c1-96ee91586ba6" }, `${t} dupe-site→survivor`);
  }
  await deleteSite("289e1b0f-2113-4ad6-bad6-2cfa2b3fb441", "Snap Fitness Wollert (June dupe)");

  step(7, "Beaumont Hills — fold inactive standalone customer's docs into Patel's site");
  for (const t of ["jobs", "invoices"]) {
    await move(t, { customer_id: "f335fc72-6dd5-4989-bfd1-bb883380256b" }, { customer_id: "6b577390-be3f-4a81-8e7c-daa355deaa80", site_id: "37b09904-b224-45b8-826d-ad0ddd21abfd" }, `${t} standalone→Patel`);
  }
  await move("customer_contacts", { customer_id: "f335fc72-6dd5-4989-bfd1-bb883380256b" }, { customer_id: "6b577390-be3f-4a81-8e7c-daa355deaa80", site_id: "37b09904-b224-45b8-826d-ad0ddd21abfd" }, "contacts standalone→Patel");

  console.log(`\nAll merges ${DRY ? "previewed (dry)" : "done"}.`);
} catch (e) {
  console.error(`\nABORTED: ${e.message}`);
  process.exit(1);
}
