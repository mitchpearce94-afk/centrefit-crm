import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";

/**
 * One-shot test-invoice sender. Creates a $1 AUTHORISED invoice in Xero
 * using the requested branding theme and emails it to Mitchell so he can
 * see what the customer experience (PDF + email body) actually looks like
 * before any real RI fires.
 *
 * GET so it's URL-bar-triggerable. Auth-gated. Side effect: leaves a $1
 * invoice in Xero — Mitchell voids it after viewing.
 *
 * Query params:
 *   ?email=    Recipient email (default: mitchpearce94@gmail.com).
 *   ?theme=    "solutions" (default) or "communications".
 */

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const email = req.nextUrl.searchParams.get("email") ?? "mitchpearce94@gmail.com";
  const themeParam = req.nextUrl.searchParams.get("theme") ?? "solutions";
  const brandingThemeID =
    themeParam === "communications"
      ? process.env.XERO_BRANDING_THEME_COMMUNICATIONS_DD_ID
      : process.env.XERO_BRANDING_THEME_SOLUTIONS_DD_ID;
  if (!brandingThemeID) {
    return NextResponse.json(
      { error: `Branding theme env var not set for "${themeParam}"` },
      { status: 500 },
    );
  }

  const svc = createServiceRoleClient();
  const { client: xero, conn } = await getAuthedClient(svc);
  const tenantId = conn.tenant_id;

  // Find-or-create a stable "test recipient" contact so we don't churn
  // through Xero contacts on repeated test sends. The email is what makes
  // the contact unique for our purposes; we look up by it before creating.
  const contactName = `Test Recipient (${email})`;
  let contactId: string | undefined;
  try {
    const search = await xero.accountingApi.getContacts(
      tenantId,
      undefined,
      `EmailAddress=="${email.replace(/"/g, '\\"')}"`,
    );
    contactId = search.body.contacts?.[0]?.contactID;
  } catch {
    // ignore; fall through to create
  }
  if (!contactId) {
    const created = await xero.accountingApi.createContacts(tenantId, {
      contacts: [{ name: contactName, emailAddress: email }],
    });
    contactId = created.body.contacts?.[0]?.contactID;
    if (!contactId) {
      return NextResponse.json({ error: "Failed to create test contact in Xero" }, { status: 500 });
    }
  }

  // Create an AUTHORISED $1 invoice with the requested branding theme.
  // AUTHORISED is required for emailInvoice to work — DRAFT can't be sent.
  const today = new Date();
  const dueDate = new Date(today.getTime() + 7 * 86400_000);
  const invoicePayload: Record<string, unknown> = {
    type: "ACCREC",
    status: "AUTHORISED",
    contact: { contactID: contactId },
    date: today.toISOString().slice(0, 10),
    dueDate: dueDate.toISOString().slice(0, 10),
    lineAmountTypes: "Exclusive",
    reference: "TEST — please void after viewing",
    brandingThemeID,
    lineItems: [
      {
        description: "Test invoice — Centrefit Solutions DD branding preview. Please void.",
        quantity: 1,
        unitAmount: 1.0,
        accountCode: "200",
        taxType: "OUTPUT",
      },
    ],
  };

  const created = await xero.accountingApi.createInvoices(tenantId, {
    invoices: [invoicePayload],
  });
  const invoice = created.body.invoices?.[0];
  if (!invoice?.invoiceID) {
    return NextResponse.json({ error: "Xero did not return an invoiceID" }, { status: 500 });
  }

  // Email it. requestEmpty body — Xero just sends to the contact's primary
  // email using the branding theme's email template.
  await xero.accountingApi.emailInvoice(tenantId, invoice.invoiceID, {});

  return NextResponse.json({
    sent: true,
    to: email,
    theme: themeParam,
    invoiceID: invoice.invoiceID,
    invoiceNumber: invoice.invoiceNumber ?? null,
    note: "Leaves a $1 AUTHORISED invoice in Xero — void it in the Xero UI once you've viewed the email.",
  });
}
