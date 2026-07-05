import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";
import { brisbaneDateISO } from "@/lib/dates";

/**
 * One-shot test-invoice sender. Creates a $1 AUTHORISED invoice in Xero
 * using the requested branding theme and emails it to an INTERNAL viewer so
 * the team can see what the customer experience (PDF + email body) actually
 * looks like before any real RI fires.
 *
 * Hardened 2026-06-01 (audit): POST only (not URL-bar / prefetch triggerable),
 * admin-gated at the middleware layer, and the recipient is restricted to an
 * internal allow-list so this can never be used to spray branded invoice
 * emails to arbitrary/customer addresses (the no-customer-send hard rule).
 *
 * Body (JSON):
 *   { "email": "...", "theme": "solutions" | "communications" }
 *   email — optional, MUST be an internal address; defaults to the env
 *           XERO_TEST_INVOICE_RECIPIENT or mitchpearce94@gmail.com.
 */

// Only these recipients may ever receive the test invoice. Anything else is
// rejected outright — no free-text customer addresses on a path that calls
// emailInvoice.
const DEFAULT_TEST_RECIPIENT =
  process.env.XERO_TEST_INVOICE_RECIPIENT ?? "mitchpearce94@gmail.com";

function isAllowedRecipient(email: string): boolean {
  const e = email.trim().toLowerCase();
  return e === DEFAULT_TEST_RECIPIENT.toLowerCase() || e.endsWith("@centrefit.com.au");
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { email?: string; theme?: string };
  const email = (body.email ?? DEFAULT_TEST_RECIPIENT).trim();
  if (!isAllowedRecipient(email)) {
    return NextResponse.json(
      { error: "Recipient must be an internal @centrefit.com.au address. Refusing to send a branded invoice externally." },
      { status: 400 },
    );
  }
  const themeParam = body.theme ?? "solutions";
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
    date: brisbaneDateISO(today),
    dueDate: brisbaneDateISO(dueDate),
    lineAmountTypes: "Exclusive",
    reference: "TEST — please void after viewing",
    brandingThemeID,
    lineItems: [
      {
        description: "Test invoice — branding preview. Please void.",
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
