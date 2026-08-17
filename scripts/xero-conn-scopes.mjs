// READ-ONLY: show stored Xero connection scopes (row metadata + decoded JWT)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\r|\n/g, "").trim()];
    }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const res = await sb.from("xero_connections")
  .select("id, tenant_id, access_token, refresh_token, expires_at")
  .order("updated_at", { ascending: false })
  .limit(1)
  .single();
if (res.error || !res.data) {
  console.error("query failed. status:", res.status, "error:", JSON.stringify(res.error));
  process.exit(1);
}
for (const c of [res.data]) {
  console.log(`conn ${c.id}  tenant_id=${c.tenant_id}  expires=${c.expires_at}`);
  try {
    const payload = JSON.parse(Buffer.from(c.access_token.split(".")[1], "base64url").toString());
    console.log(`  JWT scopes: ${Array.isArray(payload.scope) ? payload.scope.join(" ") : payload.scope}`);
  } catch (e) { console.log("  JWT decode failed:", e.message); }
}
