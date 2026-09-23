import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { requireProductsManager } from "@/lib/products/guard";

/** Per-template device supply (quoting-v2, locked 23 Sep): centrefit | customer. */
export async function POST(req: NextRequest) {
  const gate = await requireProductsManager();
  if (!gate.ok) return gate.response;
  const b = (await req.json().catch(() => null)) as { template_id?: string; device_type?: string; supplied_by?: string } | null;
  if (!b?.template_id || !b.device_type || !["centrefit", "customer"].includes(String(b.supplied_by))) return NextResponse.json({ error: "template_id, device_type and supplied_by required" }, { status: 400 });
  const svc = createServiceRoleClient();
  const { error } = await svc.from("quote_template_device_supply").upsert({ template_id: b.template_id, device_type: b.device_type, supplied_by: b.supplied_by, note: `set in Settings → Rules → Coverage` }, { onConflict: "template_id,device_type" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
