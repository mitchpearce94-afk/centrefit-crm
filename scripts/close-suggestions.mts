/**
 * Close staff_suggestions rows and email each submitter what was done.
 *   npx tsx scripts/close-suggestions.mts <resolutions.json> [--send]
 * resolutions.json: [{ id, outcome: "done"|"declined"|"noted", resolution, notes? }]
 * Without --send: prints the grouped emails and does NOT touch the DB.
 * Needs node_modules/server-only shim (tsx can't resolve the Next marker).
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { sendSuggestionResolvedEmail } from "../src/lib/emails/suggestion";

const env = Object.fromEntries(fs.readFileSync(".env.gc-probe", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\n$/, "")]; }));
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || env.RESEND_API_KEY;
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const file = process.argv[2]; const SEND = process.argv.includes("--send");
if (!file) { console.error("usage: npx tsx scripts/close-suggestions.mts resolutions.json [--send]"); process.exit(1); }
const resolutions: Array<{ id: string; outcome: "done" | "declined" | "noted"; resolution: string; notes?: string }> = JSON.parse(fs.readFileSync(file, "utf8"));
const ids = resolutions.map((r) => r.id);
const { data: rows, error } = await db.from("staff_suggestions").select("id, staff_name, staff_email, category, body, status").in("id", ids);
if (error) throw error;
const byEmail = new Map<string, { name: string; items: any[] }>();
for (const r of resolutions) {
  const row = rows!.find((x) => x.id === r.id); if (!row) { console.error("missing", r.id); continue; }
  const key = row.staff_email.toLowerCase();
  if (!byEmail.has(key)) byEmail.set(key, { name: row.staff_name, items: [] });
  byEmail.get(key)!.items.push({ suggestionId: row.id, category: row.category, body: row.body, resolution: r.resolution, outcome: r.outcome });
}
for (const [email, g] of byEmail) {
  console.log(`\n=== ${g.name} <${email}> — ${g.items.length} item(s)`);
  for (const i of g.items) console.log(`  [${i.outcome}] #${i.suggestionId.slice(0, 8).toUpperCase()} ${i.category}: ${i.body.slice(0, 70)}…\n      → ${i.resolution}`);
  if (!SEND) continue;
  const res = await sendSuggestionResolvedEmail({ toEmail: email, toName: g.name, items: g.items });
  console.log("  email:", res.ok ? "sent" : "FAILED " + res.error);
}
if (SEND) {
  for (const r of resolutions) {
    // staff_suggestions_status_check allows new / in_progress / done / wont_fix only.
    const status = r.outcome === "done" ? "done" : r.outcome === "declined" ? "wont_fix" : "in_progress";
    const { error: ue } = await db.from("staff_suggestions").update({ status, notes: r.notes ?? r.resolution, updated_at: new Date().toISOString() }).eq("id", r.id);
    console.log(ue ? `row ${r.id.slice(0, 8)} FAILED ${ue.message}` : `row ${r.id.slice(0, 8)} → ${status}`);
  }
}
