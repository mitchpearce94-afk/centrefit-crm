import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { cortexGate, ok, bad } from "@/lib/cortex-api/auth";
import { one } from "@/lib/cortex-api/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/cortex/search?q=caboolture — customers, sites and staff matching a name, for resolving what Mark said. */
export async function GET(req: NextRequest) {
  const denied = cortexGate(req);
  if (denied) return denied;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return bad("q must be at least 2 characters");
  const like = `%${q}%`;
  const db = createServiceRoleClient();
  const [customers, sites, staff] = await Promise.all([
    db.from("customers").select("id, name, type").eq("is_active", true).ilike("name", like).order("name").limit(15),
    db.from("customer_sites").select("id, name, suburb, state, customer:customers(name)").or(`name.ilike.${like},suburb.ilike.${like},address.ilike.${like}`).order("name").limit(25),
    db.from("staff").select("id, display_name, email, role").eq("is_active", true).or(`display_name.ilike.${like},email.ilike.${like}`).limit(10),
  ]);
  return ok({
    customers: customers.data ?? [],
    sites: (sites.data ?? []).map((s) => ({ id: s.id, name: s.name, suburb: s.suburb, state: s.state, customer: one(s.customer as { name: string } | { name: string }[] | null)?.name ?? null })),
    staff: (staff.data ?? []).map((s) => ({ id: s.id, name: s.display_name, email: s.email, role: s.role })),
  });
}
