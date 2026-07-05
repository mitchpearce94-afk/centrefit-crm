import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { generateSwmsPdfBuffer, type SwmsData, type SwmsSubcontractorRow } from "@/lib/swms/pdf";
import { SWMS_TASK_GROUPS, nearestHospital } from "@/lib/swms/spec";

/**
 * SWMS generator (Phase C). Generate → download PDF only — staff email it
 * to the builder themselves; there is NO customer send flow (Mitchell
 * 2026-07-05). A copy is stored under the SWMS heading on the site's
 * Documentation tab so it can be re-downloaded later.
 *
 * Auto-fill: PCBU = site owner (respecting invoice_name), key reps from
 * site contacts, permit number = job number, proposed dates = job
 * rough-in → fit-off, sign-on register from the selected staff with their
 * stored profile signatures, nearest ED from site lat/lng (overridable).
 */

function fmtDate(d: string | null): string | null {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: siteId } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    jobId?: string;
    taskGroupKeys?: string[];
    staffIds?: string[];
    subcontractors?: SwmsSubcontractorRow[];
    proposedWorkDate?: string;
    hospitalOverride?: string;
    approverStaffId?: string;
    keyRepsOverride?: string;
    /** PCBU is usually the BUILDER — modal-supplied details win over the site owner. */
    pcbu?: { name?: string; abn?: string; address?: string; keyReps?: string };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const groupKeys = body.taskGroupKeys?.length
    ? body.taskGroupKeys
    : SWMS_TASK_GROUPS.map((g) => g.key);
  const taskGroups = SWMS_TASK_GROUPS.filter((g) => groupKeys.includes(g.key));
  if (taskGroups.length === 0) {
    return NextResponse.json({ error: "At least one task group is required" }, { status: 400 });
  }

  const sb = createServiceRoleClient();
  const approverId = body.approverStaffId || user.id;
  const staffIds = Array.from(new Set([...(body.staffIds ?? []), approverId, user.id]));

  const [siteResult, contactsResult, staffResult, jobResult] = await Promise.all([
    sb
      .from("customer_sites")
      .select("*, customer:customers!customer_id(id, name, abn)")
      .eq("id", siteId)
      .single(),
    sb
      .from("customer_contacts")
      .select("name, is_primary")
      .eq("site_id", siteId)
      .order("is_primary", { ascending: false })
      .limit(4),
    sb
      .from("staff")
      .select("id, display_name, role, signature_data")
      .in("id", staffIds),
    body.jobId
      ? sb
          .from("jobs")
          .select("id, number, rough_in_date, fit_off_end_date, fit_off_date, job_staff(staff_id, role)")
          .eq("id", body.jobId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (siteResult.error || !siteResult.data) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }
  const site = siteResult.data as Record<string, unknown> & {
    customer: { id: string; name: string; abn: string | null } | null;
  };
  const customer = Array.isArray(site.customer) ? site.customer[0] ?? null : site.customer;
  const job = jobResult.data as
    | { number: string | null; rough_in_date: string | null; fit_off_end_date: string | null; fit_off_date: string | null; job_staff?: { staff_id: string; role: string | null }[] }
    | null;

  const staffById = new Map(
    ((staffResult.data ?? []) as { id: string; display_name: string | null; role: string | null; signature_data: string | null }[]).map(
      (r) => [r.id, r],
    ),
  );
  const me = staffById.get(user.id);
  const approver = staffById.get(approverId);
  const jobRoleByStaff = new Map((job?.job_staff ?? []).map((r) => [r.staff_id, r.role]));

  const siteAddress = [site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(", ");

  // Proposed work date: explicit → job rough-in → fit-off → placeholder.
  const roughIn = fmtDate(job?.rough_in_date ?? null);
  const fitOff = fmtDate(job?.fit_off_end_date ?? job?.fit_off_date ?? null);
  const proposedWorkDate =
    body.proposedWorkDate?.trim() ||
    (roughIn && fitOff ? `${roughIn} – ${fitOff}` : roughIn || "To be confirmed");

  // Nearest ED from site coordinates unless overridden.
  let hospitalLine = body.hospitalOverride?.trim() || "";
  if (!hospitalLine) {
    const lat = Number(site.lat);
    const lng = Number(site.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0) {
      const h = nearestHospital(lat, lng);
      hospitalLine = `${h.name}, ${h.address}`;
    } else {
      hospitalLine = "Confirm and record nearest emergency department prior to first shift";
    }
  }

  const generatedDate = new Date().toLocaleDateString("en-AU", { day: "2-digit", month: "2-digit", year: "numeric" });

  const signOn = (body.staffIds ?? [])
    .map((id) => staffById.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({
      name: r.display_name ?? "Staff",
      role: jobRoleByStaff.get(r.id) || r.role || "",
      signatureDataUrl: r.signature_data,
      date: generatedDate,
    }));

  const data: SwmsData = {
    clientName:
      body.pcbu?.name?.trim() ||
      ((site.invoice_name as string | null) ?? customer?.name ?? (site.name as string)),
    clientAbn: body.pcbu?.abn?.trim() || (customer?.abn ?? ""),
    clientAddress: body.pcbu?.address?.trim() || siteAddress,
    clientKeyReps:
      body.pcbu?.keyReps?.trim() ||
      body.keyRepsOverride?.trim() ||
      (contactsResult.data ?? []).map((c) => c.name).filter(Boolean).join(", "),
    workSiteName: site.name as string,
    workSiteAddress: siteAddress,
    proposedWorkDate,
    permitNumber: job?.number ?? "Not applicable",
    author: me?.display_name ?? "Centrefit Group",
    generatedDate,
    taskGroups,
    nearestHospital: hospitalLine,
    approver: {
      name: approver?.display_name ?? me?.display_name ?? "Centrefit Group",
      role: approver?.role === "admin" ? "Director" : "Installation Manager",
      signatureDataUrl: approver?.signature_data ?? null,
    },
    signOn,
    subcontractors: (body.subcontractors ?? []).filter((r) => r.name?.trim()),
  };

  let pdf: Buffer;
  try {
    pdf = await generateSwmsPdfBuffer(data);
  } catch (err) {
    return NextResponse.json(
      { error: `PDF render failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  // Store a copy under the SWMS heading, then hand the file back for download.
  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = `SWMS - ${site.name}${job?.number ? ` - ${job.number}` : ""} - ${stamp}.pdf`;
  const storagePath = `sites/${siteId}/swms/${Date.now()}-swms${job?.number ? `-${job.number}` : ""}.pdf`;
  const { error: uploadError } = await sb.storage
    .from("site-documents")
    .upload(storagePath, pdf, { contentType: "application/pdf" });
  if (!uploadError) {
    await sb.from("site_documents").insert({
      site_id: siteId,
      job_id: body.jobId ?? null,
      category: "swms",
      name: fileName,
      storage_path: storagePath,
      mime_type: "application/pdf",
      size_bytes: pdf.length,
      status: "file",
      uploaded_by: user.id,
    });
  }

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName.replace(/[^\w.\- ()]/g, "_")}"`,
    },
  });
}
