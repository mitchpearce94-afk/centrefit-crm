// 2026-07-04 — Mitchell: "emails and phone numbers for all the snap fitness's".
// Scrapes each club's official snapfitness.com/au/gyms/<slug>/ page (server-
// rendered) for the public phone + @snapfitness.com.au email, then fills
// customer_sites.phone / .email — ONLY where currently empty, never overwrites.
// Run with --dry to preview without writing.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry");
const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { data: sites, error } = await supabase
  .from("customer_sites")
  .select("id, name, suburb, phone, email")
  .ilike("name", "snap fitness%")
  .order("name");
if (error) { console.error(error.message); process.exit(1); }
const targets = sites.filter((s) => !s.phone?.trim() || !s.email?.trim());
console.log(`${sites.length} Snap sites, ${targets.length} missing phone and/or email${DRY ? " [DRY RUN]" : ""}\n`);

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
// Sites where suburb-based slugs resolve to the WRONG club (e.g. Northshore's
// suburb "Townsville" hits the Townsville CBD club). Handle these by hand.
const EXCLUDE = new Set(["Snap Fitness Northshore"]);

function slugCandidates(site) {
  const base = site.name.replace(/^snap fitness\s*/i, "");
  const out = new Set();
  const push = (v) => { const sl = slugify(v); if (sl) out.add(sl); };
  push(base);
  push(base.replace(/'/g, "")); // St Mary's → st-marys, not st-mary-s
  push(base.replace(/\bmt\b/i, "mount"));
  push(base.replace(/\bmount\b/i, "mt"));
  push(base.replace(/\bst\b/i, "saint"));
  if (site.suburb) push(site.suburb);
  return [...out];
}

async function fetchClub(slug) {
  const res = await fetch(`https://www.snapfitness.com/au/gyms/${slug}/`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    redirect: "follow",
  });
  if (!res.ok) return null;
  const html = await res.text();
  // The not-found page still returns 200 on some routes — detect it.
  if (/Page not found/i.test(html) && !/tel:/i.test(html)) return null;
  const decode = (s) => s.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
  const c = decode(html);
  const email =
    c.match(/mailto:([a-zA-Z0-9._%+-]+@snapfitness[a-zA-Z0-9.-]*)/)?.[1]?.toLowerCase() ?? null;
  const phone =
    c.match(/tel:([+0-9 ()-]{8,16})/)?.[1]?.trim() ??
    c.match(/"(?:phone|telephone)"\s*:\s*"([+0-9 ()-]{8,16})"/i)?.[1]?.trim() ?? null;
  return { email, phone };
}

const results = [];
for (const site of targets) {
  if (EXCLUDE.has(site.name)) {
    console.log(`SKIP  ${site.name} — excluded (suburb slug hits the wrong club)`);
    continue;
  }
  let found = null;
  let usedSlug = null;
  for (const slug of slugCandidates(site)) {
    try {
      found = await fetchClub(slug);
    } catch { found = null; }
    if (found && (found.phone || found.email)) { usedSlug = slug; break; }
    await sleep(250);
  }
  if (!found || (!found.phone && !found.email)) {
    results.push({ site: site.name, ok: false });
    console.log(`MISS  ${site.name} (tried: ${slugCandidates(site).join(", ")})`);
    await sleep(250);
    continue;
  }
  const patch = {};
  if (!site.phone?.trim() && found.phone) patch.phone = found.phone.replace(/\s+/g, " ").trim();
  if (!site.email?.trim() && found.email) patch.email = found.email;
  if (Object.keys(patch).length === 0) {
    results.push({ site: site.name, ok: true, note: "nothing to fill" });
  } else if (DRY) {
    console.log(`[dry] ${site.name}  ${patch.phone ?? "(keep phone)"}  ${patch.email ?? "(keep email)"}  [${usedSlug}]`);
    results.push({ site: site.name, ok: true, ...patch });
  } else {
    patch.updated_at = new Date().toISOString();
    const { error: upErr } = await supabase.from("customer_sites").update(patch).eq("id", site.id);
    if (upErr) {
      console.log(`FAIL  ${site.name}: ${upErr.message}`);
      results.push({ site: site.name, ok: false });
    } else {
      console.log(`OK    ${site.name}  ${patch.phone ?? "(kept)"}  ${patch.email ?? "(kept)"}  [${usedSlug}]`);
      results.push({ site: site.name, ok: true, ...patch });
    }
  }
  await sleep(350);
}

const hits = results.filter((r) => r.ok).length;
const misses = results.filter((r) => !r.ok);
console.log(`\nDone: ${hits}/${targets.length} resolved, ${misses.length} misses`);
if (misses.length > 0) console.log(`Misses: ${misses.map((m) => m.site).join(" | ")}`);
