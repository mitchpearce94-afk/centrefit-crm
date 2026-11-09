// One-off: Brookside (PF) + Raymond Terrace / Heatherbrae (Snap) — site, job, plan documents.
// Mitchell 9 Nov 2026: "find the brookside plans and the raymond terrace plans and add them to the crm… add a site, create the job as well."
// Idempotent. Run: node scripts/plans-setup-2026-11-09.mjs [--dry]
import { db } from "./_service-db.mjs";
import fs from "fs";
import path from "path";

const DRY = process.argv.includes("--dry");
const PLANS = path.join(process.env.HOME, ".cortex/plans");
const log = (...a) => console.log(...a);
const die = (m) => { console.error("FATAL", m); process.exit(1); };

const mitch = (await db.from("staff").select("id").ilike("email", "mitchell@centrefit.com.au")).data?.[0];
if (!mitch) die("Mitchell staff row not found");
const MITCH = mitch.id;
const idByName = async (table, extra, name) => {
  let q = db.from(table).select("id").eq("name", name);
  for (const [k, v] of Object.entries(extra)) q = q.eq(k, v);
  const { data, error } = await q.maybeSingle();
  if (error) die(`${table} ${name}: ${error.message}`);
  return data?.id ?? null;
};
const DESIGN = await idByName("statuses", {}, "Design Phase") ?? die("status Design Phase");
const CAT_IT = await idByName("categories", { type: "job_type" }, "IT Supply & Install") ?? die("cat IT");
const CAT_SOL = await idByName("categories", { type: "business_unit" }, "Solutions") ?? die("cat Solutions");
const BRAVO_EMAIL = "invoices@bravofit.com.au";
const CORTEX_NOTE = "Created by Cortex 9 Nov 2026 from Mitchell's inbox (plans request).";

async function ensureCustomer(name, fields) {
  const { data } = await db.from("customers").select("id").eq("name", name).limit(1);
  if (data?.[0]) { log("  customer exists", name, data[0].id); return data[0].id; }
  if (DRY) { log("  [dry] create customer", name); return `dry-${name}`; }
  const { data: c, error } = await db.from("customers").insert({ name, type: "commercial", is_active: true, ...fields }).select("id").single();
  if (error) die(`customer ${name}: ${error.message}`);
  log("  + customer", name, c.id); return c.id;
}
async function ensureSite(name, fields) {
  const { data } = await db.from("customer_sites").select("id,notes").eq("name", name).limit(1);
  if (data?.[0]) {
    log("  site exists", name, data[0].id);
    if (fields.__appendNote && !(data[0].notes ?? "").includes(fields.__appendNote.slice(0, 40))) {
      const notes = [data[0].notes, fields.__appendNote].filter(Boolean).join("\n");
      if (!DRY) { const { error } = await db.from("customer_sites").update({ notes }).eq("id", data[0].id); if (error) die(`site note ${name}: ${error.message}`); }
      log("    note appended");
    }
    return data[0].id;
  }
  const { __appendNote, ...ins } = fields;
  if (DRY) { log("  [dry] create site", name, JSON.stringify(ins)); return `dry-site-${name}`; }
  const { data: s, error } = await db.from("customer_sites").insert({ name, ...ins }).select("id").single();
  if (error) die(`site ${name}: ${error.message}`);
  log("  + site", name, s.id); return s.id;
}
async function ensureJob(siteId, customerId, job) {
  const { data } = await db.from("jobs").select("id,number").eq("site_id", siteId).eq("reference", job.reference).limit(1);
  if (data?.[0]) { log("  job exists", data[0].number, job.reference); return data[0]; }
  if (DRY) { log("  [dry] create job", job.reference, job.due_date ?? ""); return { id: "dry-job", number: "CFA?????" }; }
  const { data: j, error } = await db.from("jobs").insert({
    customer_id: customerId, site_id: siteId, status_id: DESIGN, category_1_id: CAT_IT, category_2_id: CAT_SOL, created_by: MITCH, priority: 0,
    reference: job.reference, description: job.description, is_new_build: true, due_date: job.due_date ?? null, opening_date: job.opening_date ?? null, dates_tbc: job.dates_tbc ?? false,
  }).select("id,number").single();
  if (error) die(`job ${job.reference}: ${error.message}`);
  log("  + job", j.number, job.reference); return j;
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
  const { error } = await db.from("site_documents").insert({ site_id: siteId, job_id: jobId, category: "plans", name, storage_path: sp, mime_type: "application/pdf", size_bytes: buf.length, uploaded_by: MITCH });
  if (error) die(`site_documents ${name}: ${error.message}`);
  log("  + doc", name, (buf.length / 1e6).toFixed(1), "MB");
}

// --- 1. Planet Fitness Brookside (new) -------------------------------------
log("\n## Planet Fitness Brookside");
{
  const SP = "https://ddapl.sharepoint.com/:f:/s/DDA/IgAkMJwYoSMTRIjDDnCrRLORAQW9XVICc6z5NzUIzi4V1nw?e=BPM7Lz";
  const cust = await ensureCustomer("Bravofit Brookside Pty Ltd", { billing_email: BRAVO_EMAIL, notes: `Entity name assumed from the Bravofit per-club convention (DD set names the client as Bravo Fit Pty Ltd); confirm ABN/entity before invoicing. ${CORTEX_NOTE}` });
  const site = await ensureSite("Planet Fitness Brookside", {
    customer_id: cust, address: "Brookside Shopping Centre, 159 Osborne Road", suburb: "Mitchelton", state: "QLD", postcode: "4053",
    billing_email: BRAVO_EMAIL, email: BRAVO_EMAIL, invoice_name: "Bravofit Brookside Pty Ltd",
    notes: `New PF club in Brookside Shopping Centre. Store Development: Nicole Donohue (nicole.donohue@bravofit.com.au, +61 409 907 269). Architect: Drew Dickson Architects (DDA), job AP2608, Paul McLean (Paul@dda-australia.com). DD set (updated 5 Nov 2026, progressing to IFC) uploaded under Plans; CAD + PF standard details live in DDA's SharePoint folder (opens without login): ${SP}\nLift: Elevator PM (Bryan Tan, bryan.tan@elevatorpm.com.au) is installing a new lift serving the club + carpark — access-control interface agreed in principle Jul 2026; lift concept PDF with PF/RF comments under Plans. Nicole (Jul 2026): handover roughly mid-2027. ${CORTEX_NOTE}`,
  });
  const job = await ensureJob(site, cust, {
    reference: "New Build", due_date: "2026-11-13", dates_tbc: true,
    description: `Nicole Donohue (5 Nov 2026): "Could you please put together a layout for this club by 13/11/26? I would like to have everything reviewed and incorporated into the final IFC documentation." She offered to talk through the access strategy for the lifts and carpark.\n\nDrawings: DDA DD Issue update 5 Nov 2026 (34 sheets, A000–A5xx) under Plans. Lift access: Bryan Tan (Elevator PM) asked Jul 2026 for a card-reader interface on the new lift serving the club and carpark; Mitchell agreed Centrefit can allow for it — see the lift concept PDF with PF/RF comments.\n\nNext: Cortex/Mitchell draw the security, access, CCTV, data + AV layout on the DD set and return it to Nicole by Thu 13 Nov; then quote. Handover ~mid-2027 (TBC).`,
  });
  await ensureDoc(site, job.id, path.join(PLANS, "brookside/DD-set-2026-11-05/261105-PF Brookside_Club Fitout_DD Issue [2].pdf"));
  await ensureDoc(site, job.id, path.join(PLANS, "brookside/BROOKSIDE LIFT CONCEPT - PF & RF COMMENTS (2 Jul 2026).pdf"));
}

// --- 2. Raymond Terrace / Heatherbrae -------------------------------------------
// Already in the CRM when this ran (9 Nov 11:30): site "Snap Fitness Raymond Terrace" (48dc27e0, customer Malik Hasan Ijaz),
// job CFA05331 New Build, prelim drawings 1923 uploaded. Cortex only appended the site note + filled the empty job description.
log("\ndone", DRY ? "(dry run)" : "");
