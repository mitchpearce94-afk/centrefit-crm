import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** GET /api/dd-migration/sites?q= — site picker for linking an unmatched RI. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ sites: [] });
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const { data } = await supabase
    .from("customer_sites")
    .select("id, name, suburb, invoice_name, customers(name)")
    .or(`name.ilike.${like},invoice_name.ilike.${like},suburb.ilike.${like}`)
    .order("name")
    .limit(15);
  const sites = (data ?? []).map((s) => {
    const cust = Array.isArray(s.customers) ? s.customers[0] : s.customers;
    return { id: s.id, name: s.name, suburb: s.suburb, owner: cust?.name ?? null };
  });
  return NextResponse.json({ sites });
}
