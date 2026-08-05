import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/xero/client";
import { deleteXeroPurchaseOrder } from "@/lib/xero/purchase-orders";

/**
 * Reset a generated PO: delete the DRAFT purchase order in Xero and revert
 * its procurement rows from 'ordered' back to 'order' so staff can re-triage
 * (fix supplier, prices, qty) and regenerate.
 *
 * Body: { xeroPoId: string }
 *
 * Refuses if any row tied to this PO has already been RECEIVED — you can't
 * unwind stock that's physically arrived.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: jobId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { xeroPoId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const xeroPoId = body.xeroPoId?.trim();
  if (!xeroPoId) {
    return NextResponse.json({ error: "xeroPoId is required" }, { status: 400 });
  }

  // All rows tied to this PO on this job
  const { data: rows, error: rowsErr } = await supabase
    .from("job_procurement_items")
    .select("id, status, xero_po_number")
    .eq("job_id", jobId)
    .eq("xero_po_id", xeroPoId);
  if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 });
  if (!rows || rows.length === 0) {
    return NextResponse.json(
      { error: "No procurement rows found for that PO on this job" },
      { status: 404 },
    );
  }

  const received = rows.filter((r) => r.status === "received");
  if (received.length > 0) {
    return NextResponse.json(
      {
        error: `Can't reset — ${received.length} line(s) on this PO are already marked received.`,
      },
      { status: 400 },
    );
  }

  // Guard: refuse if ANOTHER job's rows share this Xero PO id. A cross-linked
  // stamp means deleting the PO here would nuke a live PO that other job is
  // relying on — Xero reuses the numbers of deleted draft POs, so a stale or
  // mis-stamped id can end up pointing at somebody else's order (see the
  // Moorooka/Beveridge PO-0471 incident, 2026-08-05).
  const { data: crossRows, error: crossErr } = await supabase
    .from("job_procurement_items")
    .select("job_id, job:jobs(number)")
    .eq("xero_po_id", xeroPoId)
    .neq("job_id", jobId);
  if (crossErr) return NextResponse.json({ error: crossErr.message }, { status: 500 });
  if (crossRows && crossRows.length > 0) {
    const jobNumbers = Array.from(
      new Set(
        crossRows.map((r) => {
          const job = r.job as { number: string } | { number: string }[] | null;
          return Array.isArray(job) ? job[0]?.number : job?.number;
        }),
      ),
    )
      .filter(Boolean)
      .join(", ");
    return NextResponse.json(
      {
        error: `Can't reset — this Xero PO is also linked to job${jobNumbers.includes(",") ? "s" : ""} ${jobNumbers || "(unknown)"}. Untangle the cross-linked lines first so resetting here can't delete another job's PO.`,
      },
      { status: 409 },
    );
  }

  // Delete the draft PO in Xero first. If this fails (e.g. already billed),
  // we leave the local rows untouched so state stays consistent with Xero.
  try {
    const { client: xero, conn } = await getAuthedClient();
    await deleteXeroPurchaseOrder({
      xero,
      tenantId: conn.tenant_id,
      purchaseOrderID: xeroPoId,
    });
  } catch (err) {
    // If the PO is already DELETED in Xero (deleted by hand, or a prior reset
    // that half-completed), Xero rejects the re-delete with "Deleted
    // PurchaseOrders cannot be updated". That's exactly the end state we want —
    // treat it as success and fall through to revert the local rows so they
    // don't stay stuck as 'ordered' against a PO that no longer exists.
    const alreadyGone = JSON.stringify(err)
      .toLowerCase()
      .includes("deleted purchaseorders cannot be updated");
    if (!alreadyGone) {
      return NextResponse.json(
        {
          error: `Couldn't delete the PO in Xero: ${err instanceof Error ? err.message : String(err)}. It may have been billed — check Xero.`,
        },
        { status: 502 },
      );
    }
  }

  // Revert rows to 'order' and clear the Xero linkage so they can regenerate
  const { error: updErr } = await supabase
    .from("job_procurement_items")
    .update({
      status: "order",
      xero_po_id: null,
      xero_po_number: null,
      ordered_at: null,
    })
    .eq("job_id", jobId)
    .eq("xero_po_id", xeroPoId);
  if (updErr) {
    return NextResponse.json(
      {
        error: `PO deleted in Xero but reverting rows failed: ${updErr.message}. Reset them manually.`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    reverted: rows.length,
    poNumber: rows[0]?.xero_po_number ?? null,
  });
}
