import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { NUMBERED_GROUPS } from "@/types/plan-builder";
import { DEVICE_CATALOG } from "@/lib/plan-builder/devices";

/**
 * POST /api/plans/[id]/publish-checklist — materialise the plan's placed
 * devices into plan_items so techs can tick them off on site (Mitchell
 * 2026-08-17). Called fire-and-forget from the plan builder's cloud save.
 *
 * Upserts on (plan_file_id, instance_id) and only supplies metadata columns,
 * so re-publishing refreshes labels/floors/qty but NEVER touches status /
 * installed_* — field progress survives every desktop edit and revision.
 * Devices deleted from the plan are flagged orphaned instead of removed.
 */

const GROUP_PREFIX: Record<string, string> = {
  cameras: "CAM",
  pir: "PIR",
  speakers: "SPK",
  data: "D",
  access_points: "AP",
};

const PREFIX_BY_DEVICE: Record<string, string> = {};
for (const [group, ids] of Object.entries(NUMBERED_GROUPS)) {
  for (const id of ids) PREFIX_BY_DEVICE[id] = GROUP_PREFIX[group] ?? "";
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: planId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: plan, error: planErr } = await supabase
    .from("plan_files")
    .select("id, job_id")
    .eq("id", planId)
    .maybeSingle();
  if (planErr) return NextResponse.json({ error: planErr.message }, { status: 500 });
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const { data: blob, error: dlErr } = await supabase.storage
    .from("plan-files")
    .download(`plans/${planId}.cfp`);
  if (dlErr || !blob) {
    return NextResponse.json({ error: `Couldn't read plan file: ${dlErr?.message ?? "no file"}` }, { status: 500 });
  }

  let cfp: any;
  try {
    cfp = JSON.parse(await blob.text());
  } catch {
    return NextResponse.json({ error: "Plan file is not valid JSON" }, { status: 500 });
  }

  const customNames = new Map<string, string>(
    (cfp.customDevices ?? []).map((d: any) => [d.id, d.name]),
  );
  const catalogById = new Map(DEVICE_CATALOG.map((d) => [d.id, d]));

  const now = new Date().toISOString();
  const rows: any[] = [];
  (cfp.floors ?? []).forEach((floor: any, fi: number) => {
    (floor.devices ?? []).forEach((device: any, di: number) => {
      if (!device?.instanceId || !device?.deviceId) return;
      const def = catalogById.get(device.deviceId);
      const name = def?.name ?? customNames.get(device.deviceId) ?? device.deviceId;
      const isData = device.deviceId === "cat6-data" || device.deviceId === "rg6-coax";
      const qty = isData ? Math.max(1, device.dataCount ?? 1) : 1;
      const prefix = PREFIX_BY_DEVICE[device.deviceId] ?? "";
      let label: string;
      if (prefix && typeof device.labelNum === "number") {
        const tag = qty > 1
          ? `${prefix}${device.labelNum}–${prefix}${device.labelNum + qty - 1}`
          : `${prefix}${device.labelNum}`;
        label = `${tag} · ${name}`;
      } else {
        label = name;
      }
      if (device.provisional) label += " (cable only)";
      rows.push({
        plan_file_id: planId,
        job_id: plan.job_id ?? null,
        floor_id: floor.id ?? null,
        floor_name: floor.name ?? null,
        instance_id: device.instanceId,
        device_id: device.deviceId,
        label,
        qty,
        orphaned: false,
        sort_order: fi * 1000 + di,
        updated_at: now,
      });
    });
  });

  if (rows.length > 0) {
    const { error: upErr } = await supabase
      .from("plan_items")
      .upsert(rows, { onConflict: "plan_file_id,instance_id" });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Devices no longer on the plan: flag, don't delete — a tech may already
  // have ticked them and the office should see the discrepancy, not lose it.
  let orphanQuery = supabase
    .from("plan_items")
    .update({ orphaned: true, updated_at: now })
    .eq("plan_file_id", planId);
  if (rows.length > 0) {
    const keep = rows.map((r) => `"${r.instance_id}"`).join(",");
    orphanQuery = orphanQuery.not("instance_id", "in", `(${keep})`);
  }
  const { error: orphanErr } = await orphanQuery;
  if (orphanErr) return NextResponse.json({ error: orphanErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, items: rows.length });
}
