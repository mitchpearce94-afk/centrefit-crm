import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/xero/client";
import { fetchXeroInvoicePdf } from "@/lib/xero/invoices";
import { captureXeroRateLimit, isXeroRateLimited } from "@/lib/xero/rate-limit";

/**
 * GET /api/invoices/[id]/pdf — the invoice as Xero renders it right now,
 * drafts included (docs/billing-contact-CONTEXT.md D2: preview is the real
 * paper). Streams inline for a browser tab. Staff only.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: staffRow } = await supabase.from("staff").select("is_active").eq("id", user.id).maybeSingle();
  if (!staffRow?.is_active) return NextResponse.json({ error: "Staff only" }, { status: 403 });

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, xero_invoice_id, xero_invoice_number")
    .eq("id", id)
    .maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (!invoice.xero_invoice_id) return NextResponse.json({ error: "Invoice is not linked to Xero yet" }, { status: 400 });

  const limited = await isXeroRateLimited(supabase);
  if (limited) return NextResponse.json({ error: "Xero quota exhausted — try again shortly", rateLimited: true }, { status: 429 });

  try {
    const { client, conn } = await getAuthedClient();
    const pdf = await fetchXeroInvoicePdf(client, conn.tenant_id, invoice.xero_invoice_id);
    const filename = `${(invoice.xero_invoice_number ?? invoice.id.slice(0, 8)).replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    await captureXeroRateLimit(supabase, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Couldn't fetch the PDF from Xero: ${message}` }, { status: 502 });
  }
}
