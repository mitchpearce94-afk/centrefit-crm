// Timeline of subs on the affected mandates + Joseph Zhou's sites. Read-only.
import { readFileSync } from "node:fs";
const gc = JSON.parse(readFileSync(new URL("./gc-discovery-output.json", import.meta.url), "utf8"));

const SETS = {
  "Point Cook": "MD01KR0F5BQ9D84Q63Q77V01KC6P",
  "Preston": "MD01KRA8Z82JYDVHKNBQQF4BRDT4",
  "Woodend": "MD01KSHDE8HCNWX9CX2ZWZFPRVKW",
  "Sunshine": "MD01KR3JEQXP2BCYH4TEB455P5ZK",
  "Wantirna": "MD01KR0E7F2NK9V2Y6FTYG3M8ZQK",
  "Jesmond (Zhou)": "MD01K8MZZS2G5A",
  "Newtown (Zhou)": "MD01K8MZZ2RQK7",
  "Glendale (Zhou)": "MD01K8N00JJWQF",
};
for (const [label, mid] of Object.entries(SETS)) {
  console.log(`\n=== ${label} ===`);
  const subs = gc.subscriptions
    .filter((s) => s.links?.mandate === mid)
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  for (const s of subs) {
    console.log(`  created=${(s.created_at ?? "?").slice(0, 16)}  start=${s.start_date}  ${s.status.padEnd(9)} $${(s.amount / 100).toFixed(2).padStart(8)} ${s.interval_unit.padEnd(7)} "${s.name}" ${s.id}`);
  }
}
