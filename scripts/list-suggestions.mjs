// READ-ONLY: list staff suggestions — today's first, then any other open ones.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").replace(/\r|\n/g, "").trim()];
    }),
);
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data, error } = await svc
  .from("staff_suggestions")
  .select("*")
  .order("created_at", { ascending: false })
  .limit(30);
if (error) { console.error(error.message); process.exit(1); }
for (const s of data) {
  const today = (s.created_at ?? "").startsWith("2026-08-1") ? "" : "";
  console.log(`--- ${s.created_at?.slice(0, 16)}  status=${s.status ?? "?"}  id=${s.id}`);
  for (const [k, v] of Object.entries(s)) {
    if (["id", "created_at", "status"].includes(k) || v == null || v === "") continue;
    console.log(`    ${k}: ${String(v).slice(0, 500)}`);
  }
}
console.log(`\n(${data.length} most recent shown)`);
