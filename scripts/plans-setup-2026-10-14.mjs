// One-off: set up sites / jobs / plan documents for the 14 Oct 2026 plans+quotes batch.
// Idempotent: every create checks for an existing row first. Run: node scripts/plans-setup-2026-10-14.mjs [--dry]
import { db } from "./_service-db.mjs";
import fs from "fs";
import path from "path";

const DRY = process.argv.includes("--dry");
const OUT = path.join(process.env.HOME, ".cortex/outbox/plans-2026-10-14");
const log = (...a) => console.log(...a);
const die = (m) => { console.error("FATAL", m); process.exit(1); };

// --- lookups -------------------------------------------------------------
const staffRows = (await db.from("staff").select("*").ilike("email", "mitchell@centrefit.com.au")).data ?? [];
const mitch = staffRows[0];
if (!mitch) die("Mitchell staff row not found");
const MITCH = mitch.id;
log("Mitchell staff id", MITCH, Object.keys(mitch).filter((k) => /user|auth/.test(k)).map((k) => `${k}=${mitch[k]}`).join(" "));

const idByName = async (table, extra, name) => {
  let q = db.from(table).select("id").eq("name", name);
  for (const [k, v] of Object.entries(extra)) q = q.eq(k, v);
  const { data, error } = await q.maybeSingle();
  if (error) die(`${table} ${name}: ${error.message}`);
  return data?.id ?? null;
};
const STATUS = {};
for (const n of ["Design Phase", "Lead"]) STATUS[n] = await idByName("statuses", {}, n) ?? die(`status ${n}`);
const CAT_IT = await idByName("categories", { type: "job_type" }, "IT Supply & Install") ?? die("cat IT");
const CAT_SOL = await idByName("categories", { type: "business_unit" }, "Solutions") ?? die("cat Solutions");

const W360_CUSTOMER = "9292dad6-2f2c-4d8d-ac67-ac9deebabc7f"; // Workspace 360 (linked to Xero contact aa1bc05c)
const W360_XERO = "aa1bc05c-d31b-4712-b6a8-8d3e560aa561";
const BRAVO_EMAIL = "invoices@bravofit.com.au";
const CORTEX_NOTE = "Created by Cortex 14 Oct 2026 from the plans/quotes request batch.";

// --- helpers -------------------------------------------------------------
async function ensureCustomer(name, fields) {
  const { data } = await db.from("customers").select("id").eq("name", name).limit(1);
  if (data?.[0]) { log("  customer exists", name, data[0].id); return data[0].id; }
  if (DRY) { log("  [dry] create customer", name); return `dry-${name}`; }
  const { data: c, error } = await db.from("customers").insert({ name, type: "commercial", is_active: true, ...fields }).select("id").single();
  if (error) die(`customer ${name}: ${error.message}`);
  log("  + customer", name, c.id);
  return c.id;
}
async function ensureSite(name, fields) {
  const { data } = await db.from("customer_sites").select("id").eq("name", name).limit(1);
  if (data?.[0]) {
    log("  site exists", name, data[0].id);
    if (fields.__update) {
      if (!DRY) { const { error } = await db.from("customer_sites").update(fields.__update).eq("id", data[0].id); if (error) die(`site update ${name}: ${error.message}`); }
      log("    updated", JSON.stringify(fields.__update));
    }
    return data[0].id;
  }
  const { __update, ...ins } = fields;
  if (DRY) { log("  [dry] create site", name, JSON.stringify(ins)); return `dry-site-${name}`; }
  const { data: s, error } = await db.from("customer_sites").insert({ name, ...ins }).select("id").single();
  if (error) die(`site ${name}: ${error.message}`);
  log("  + site", name, s.id);
  return s.id;
}
async function ensureJob(siteId, customerId, job) {
  const { data } = await db.from("jobs").select("id,number").eq("site_id", siteId).eq("reference", job.reference).limit(1);
  if (data?.[0]) { log("  job exists", data[0].number, job.reference); return data[0]; }
  if (DRY) { log("  [dry] create job", job.reference); return { id: `dry-job`, number: "CFA?????" }; }
  const { data: j, error } = await db.from("jobs").insert({
    customer_id: customerId, site_id: siteId, status_id: STATUS[job.status ?? "Design Phase"],
    category_1_id: CAT_IT, category_2_id: CAT_SOL, created_by: MITCH, priority: 0,
    reference: job.reference, description: job.description, is_new_build: !!job.is_new_build,
    due_date: job.due_date ?? null, opening_date: job.opening_date ?? null,
  }).select("id,number").single();
  if (error) die(`job ${job.reference}: ${error.message}`);
  log("  + job", j.number, job.reference);
  return j;
}
async function ensureDoc(siteId, jobId, file) {
  const name = path.basename(file);
  const { data } = await db.from("site_documents").select("id").eq("site_id", siteId).eq("name", name).limit(1);
  if (data?.[0]) { log("  doc exists", name); return; }
  const buf = fs.readFileSync(file);
  const safe = name.replace(/[^\w.\- ()]/g, "_");
  const sp = `sites/${siteId}/plans/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  if (DRY) { log("  [dry] upload", name, (buf.length / 1e6).toFixed(1), "MB"); return; }
  const { error: upErr } = await db.storage.from("site-documents").upload(sp, buf, { contentType: "application/pdf" });
  if (upErr) die(`upload ${name}: ${upErr.message}`);
  const { error } = await db.from("site_documents").insert({
    site_id: siteId, job_id: jobId, category: "plans", name, storage_path: sp,
    mime_type: "application/pdf", size_bytes: buf.length, uploaded_by: MITCH,
  });
  if (error) die(`site_documents ${name}: ${error.message}`);
  log("  + doc", name, (buf.length / 1e6).toFixed(1), "MB");
}

// --- 1. Snap Fitness Biggera Waters (site + CFA05232 already exist) ----------
log("\n## Snap Fitness Biggera Waters");
{
  const siteId = await ensureSite("Snap Fitness Biggera Waters", { __update: { address: "Shop T1-40b Metro Markets, 33-47 Hollywell Road", postcode: "4216" } });
  const { data: j } = await db.from("jobs").select("id,number").eq("number", "CFA05232").single();
  if (!DRY) await db.from("jobs").update({ description: "Working drawings (DWG set 1902, 12 Oct 2026) received from Andrew Hulse 13 Oct via Mark. FelixGate site. Andrew asked what other new-build scope Centrefit covers besides electrical. Plans + quote to follow." }).eq("id", j.id);
  await ensureDoc(siteId, j.id, path.join(OUT, "biggera/1902 Snap Biggera Waters - Working Drawings 261012.pdf"));
}

// --- 2. Planet Fitness Broadmeadows ----------------------------------------
log("\n## Planet Fitness Broadmeadows");
{
  const link = fs.readFileSync(path.join(OUT, "broadmeadows/link.txt"), "utf8").trim().replace(/&xsdata.*$/, "").replace(/\?e=.*$/, "");
  const cust = await ensureCustomer("Bravofit Broadmeadows Pty Ltd", { billing_email: BRAVO_EMAIL, notes: `Entity name assumed from the Bravofit per-club convention; confirm ABN/entity before invoicing. ${CORTEX_NOTE}` });
  const site = await ensureSite("Planet Fitness Broadmeadows", {
    customer_id: cust, suburb: "Broadmeadows", state: "VIC", postcode: "3047", billing_email: BRAVO_EMAIL, email: BRAVO_EMAIL,
    invoice_name: "Bravofit Broadmeadows Pty Ltd",
    notes: `RFQ from Jade White (Store Development Manager, 0411 220 335) 9 Oct 2026. Tender docs in Jade's SharePoint folder (needs Mitchell's browser login): ${link}\nStreet address to come from the tender drawings. Handover planned 19 Nov 2026, likely slipping to early 2027.`,
  });
  await ensureJob(site, cust, {
    reference: "New Build", is_new_build: true, due_date: "2026-10-17",
    description: `RFQ – Planet Fitness Broadmeadows (Jade White, 9 Oct 2026): "send across proposal at your earliest". Tender docs: ${link}\nHandover 19 Nov 2026, very likely to shift into early 2027. Drawings not yet in the CRM — download from the SharePoint folder and upload under Plans.`,
  });
}

// --- 3. Planet Fitness Parafield (no drawings yet) ---------------------------
log("\n## Planet Fitness Parafield");
{
  const cust = await ensureCustomer("Bravofit Parafield Pty Ltd", { billing_email: BRAVO_EMAIL, notes: `Entity name assumed from the Bravofit per-club convention; confirm ABN/entity before invoicing. ${CORTEX_NOTE}` });
  const site = await ensureSite("Planet Fitness Parafield", {
    customer_id: cust, suburb: "Parafield", state: "SA", postcode: "5106", billing_email: BRAVO_EMAIL, email: BRAVO_EMAIL,
    invoice_name: "Bravofit Parafield Pty Ltd",
    notes: "Intro from Nicole Donohue 14 Oct 2026 (Parafield was not on Centrefit's quoted-clubs list). Store Development contact: Kay Theodore <kay.theodore@bravofit.com.au>. Drawings not yet received.",
  });
  await ensureJob(site, cust, {
    reference: "New Build", is_new_build: true, status: "Lead",
    description: "Remaining 2026 club. Nicole Donohue introduced Mitchell to Kay Theodore 14 Oct 2026. Waiting on drawings from Kay before plans + quote. Move to Design Phase once drawings land.",
  });
}

// --- 4/5/6. Reformer Pilates retrofits: PF Tuggerah / Chermside / Casula -----
const tenderText = "Bravo Fit Reformer Pilates retrofit tender (DDA P2701 Rev A, 2 Oct 2026). Centrefit is the nominated security & access control vendor; builders tendering must price our scope. URBN Group (Cherry Rose Aceron, cherry@urbngroup.au; estimating@urbngroup.au) wants our quotation by FRI 16 Oct; Bravo Fit tender closes 19 Oct (contact David Bennet). All three clubs to be complete by 11 Dec 2026. Scope: security & access control — card readers, exit buttons, emergency releases, commissioning.";
const retro = [
  { club: "Tuggerah", state: "NSW", postcode: "2259", suburb: "Tuggerah", address: "Bryant Dr & Wyong Rd", sheets: "A201–A206",
    extra: " Also: Elite PEM (Shayne Parkes, electrical) asked Mark 13 Oct for PTE button, emergency exit door release and card reader pricing plus any Centrefit commissioning cost; Mark: plans first, Elite likely does the rough-in." },
  { club: "Chermside", state: "QLD", postcode: "4032", suburb: "Chermside", address: "725 Webster Road", sheets: "A101, A102, A105, A106", existing: true },
  { club: "Casula", state: "NSW", postcode: "2170", suburb: "Casula", address: "Shop 17A Crossroads Homemaker Centre, Cnr Beech Rd & Camden Valley Way", sheets: "A001–A006" },
];
for (const r of retro) {
  log(`\n## Planet Fitness ${r.club} (Reformer Pilates retrofit)`);
  let cust, site;
  if (r.existing) {
    const { data } = await db.from("customer_sites").select("id,customer_id").eq("name", `Planet Fitness ${r.club}`).single();
    site = data.id; cust = data.customer_id; log("  site exists", site);
  } else {
    cust = await ensureCustomer(`Bravofit ${r.club} Pty Ltd`, { billing_email: BRAVO_EMAIL, notes: `Entity name assumed from the Bravofit per-club convention; confirm ABN/entity before invoicing. ${CORTEX_NOTE}` });
    site = await ensureSite(`Planet Fitness ${r.club}`, {
      customer_id: cust, address: r.address, suburb: r.suburb, state: r.state, postcode: r.postcode, billing_email: BRAVO_EMAIL, email: BRAVO_EMAIL,
      invoice_name: `Bravofit ${r.club} Pty Ltd`, notes: `Existing operating club. ${CORTEX_NOTE}`,
    });
  }
  const job = await ensureJob(site, cust, {
    reference: "Reformer Pilates retrofit – security & access control", due_date: "2026-10-16",
    description: `${tenderText} Drawings for this club: sheets ${r.sheets}.${r.extra ?? ""}`,
  });
  await ensureDoc(site, job.id, path.join(OUT, `urbn/P2701 Pilates Rollout - PF ${r.club} tender drawings Rev A.pdf`));
  await ensureDoc(site, job.id, path.join(OUT, "urbn/Bravo Fit - Reformer Pilates Retrofit Tender Request.pdf"));
}

// --- 7. Snap Fitness Windsor (Workspace 360) ---------------------------------
log("\n## Snap Fitness Windsor");
{
  const site = await ensureSite("Snap Fitness Windsor", {
    customer_id: W360_CUSTOMER, address: "Tenancy 02, Cnr Raleigh & Punt Road", suburb: "Windsor", state: "VIC", postcode: "3181",
    billing_email: "finance@workspace360.com.au", email: "reuben.crick@workspace360.com.au", invoice_name: "Workspace 360", xero_contact_id: W360_XERO,
    notes: `Workspace360 fit-out (Reuben Crick, Head of Commercial & Estimating, 0419 101 092). Bills to the single Xero contact "Workspace 360". ${CORTEX_NOTE}`,
  });
  const job = await ensureJob(site, W360_CUSTOMER, {
    reference: "New Build", is_new_build: true, due_date: "2026-10-20",
    description: "Reuben Crick (Workspace360) 13 Oct 2026: quote for security & AV works, wanted by Tue 20 Oct. Mark replied 13 Oct: final draft done, sent to our electrician for pricing. Drawings: 1904 Snap Windsor Preliminary rev B (9 Oct) + Sandro Caruso 3D pack (267357).",
  });
  await ensureDoc(site, job.id, path.join(OUT, "windsor/1904 Snap Windsor - Preliminary rev B 261009.pdf"));
  await ensureDoc(site, job.id, path.join(OUT, "windsor/267357 Snap Windsor - 3D render pack.pdf"));
}
log("\nDONE", DRY ? "(dry run)" : "");
