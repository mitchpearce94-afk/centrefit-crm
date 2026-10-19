// Send a quote exactly as POST /api/quotes/send does, but from a script (no
// staff session on the mini). Same status flip, token, job mirror + status
// transition, PDF, email body, sender and activity log — the route's code
// paths are imported, not copied, wherever they're pure.
//
//   npx tsx scripts/quote-send.mts CF-2026-0093 a@x.com,b@x.com          # dry: writes the PDF to /tmp, sends nothing, changes nothing
//   npx tsx scripts/quote-send.mts CF-2026-0093 a@x.com,b@x.com --send   # the real thing
import { readFileSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import { Resend } from "resend";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { withLiveSite } from "@/lib/quotes/live-site";
import { generateScopeOfWorks, manualScopeDocument, renderScopeAsText, type ScopeDocument } from "@/lib/quote-engine";
import { generateQuotePdfBuffer, type QuoteForPdf } from "@/lib/quote-pdf";
import { autoTransitionJobStatusServer } from "@/lib/job-status-transitions.server";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";
import { FROM_QUOTES, REPLY_TO_SALES } from "@/lib/emails/from-addresses";
import { logDocumentActivity } from "@/lib/activity/log";

for (const f of [".env.gc-probe", ".env.local"]) {
  try {
    for (const line of readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split("\n")) {
      const i = line.indexOf("="); if (i < 1 || line.trim().startsWith("#")) continue;
      const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/(\\n)+$/, "");
      if (!process.env[k]) process.env[k] = v;
    }
  } catch { /* optional */ }
}
const args = process.argv.slice(2);
const SEND = args.includes("--send");
const [ref, emailArg] = args.filter((a) => !a.startsWith("--"));
if (!ref || !emailArg) { console.error("usage: npx tsx scripts/quote-send.mts <CF-ref> <email[,email]> [--send]"); process.exit(1); }
const email = emailArg.split(",").map((s) => s.trim()).filter(Boolean).join(",");
const recipients = email.split(",");

const fmt = (n: number) => n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const supabase = createServiceRoleClient();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { data: quote, error } = await supabase.from("quotes").select("*, customer:customers(id, name, customer_contacts(name, email, is_primary))").eq("ref", ref).single() as { data: any; error: { message: string } | null };
if (error || !quote) throw new Error(`quote ${ref}: ${error?.message ?? "not found"}`);
if (quote.status !== "draft" && SEND && !args.includes("--resend")) throw new Error(`${ref} is ${quote.status}, not draft — pass --resend to send again`);
{
  const live = await withLiveSite(supabase, quote, { force: quote.status === "draft" });
  quote.site_name = live.site_name; quote.site_address = live.site_address;
}
const pricing = quote.pricing_snapshot as { totalExGST: number; totalIncGST: number; gst: number; pp1?: { total: number }; pp2?: { total: number } } | null;
if (!pricing) throw new Error("no pricing");
const lintFindings = (quote.lint_findings ?? []) as { code: string; severity: string; message: string }[];
const lintOverrides = (quote.lint_overrides ?? {}) as Record<string, string>;
const blocking = lintFindings.filter((f) => f.severity === "error" && !(lintOverrides[`${f.code}|${f.message}`] ?? "").trim());
if (blocking.length) throw new Error(`lint blocks send: ${blocking.map((b) => b.message).join(" · ")}`);

const responseToken: string = (quote.response_token as string | null) ?? crypto.randomBytes(32).toString("hex");
const clientName = quote.customer?.name || quote.client_name;
const isProgress = quote.quote_type === "progress";
const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://crm.centrefit.com.au";
const respondUrl = `${baseUrl}/quote-response/${responseToken}`;

// scope (manual quotes use the authored text verbatim)
const siteInfo = { site_sqm: quote.site_sqm ?? 0, door_count: quote.door_count ?? 0, external_camera_count: quote.external_camera_count ?? 0, concrete_mount_black: quote.concrete_mount_black ?? 0, concrete_mount_white: quote.concrete_mount_white ?? 0, cardio_count: quote.cardio_count ?? 0, tv_count: quote.tv_count ?? 0, ceiling_tv_count: quote.ceiling_tv_count ?? 0, wall_tv_mount_count: quote.wall_tv_mount_count ?? 0, ceiling_tv_mount_count: quote.ceiling_tv_mount_count ?? 0, separate_studio_zone: quote.separate_studio_zone ?? false };
const [{ data: bomRows }, { data: prodRows }, { data: roleRows }] = await Promise.all([
  supabase.from("quote_line_items").select("product_id, quantity").eq("quote_id", quote.id),
  supabase.from("quote_products").select("id, scope_role, name, sku"),
  supabase.from("quote_scope_roles").select("slug, description"),
]);
const roleDescriptions: Record<string, string> = {};
for (const r of roleRows ?? []) if (r.description?.trim()) roleDescriptions[r.slug] = r.description.trim();
const manualScopeText = quote.quote_mode === "manual" ? String(quote.labour_data?.scope_of_works ?? "").trim() : "";
const scope: ScopeDocument = manualScopeText
  ? manualScopeDocument(manualScopeText, quote.labour_data?.ongoing_costs)
  : generateScopeOfWorks((bomRows ?? []).map((r) => ({ product_id: r.product_id ?? null, quantity: Number(r.quantity) || 0 })), (prodRows ?? []) as never, siteInfo, quote.scope_overrides ?? undefined, roleDescriptions, quote.device_counts ?? undefined);

const quoteForPdf: QuoteForPdf = { ref: quote.ref, createdAt: quote.created_at, clientName, siteName: quote.site_name, siteAddress: quote.site_address, isProgress, pricing: pricing as never };
const pdfBuffer = await generateQuotePdfBuffer(quoteForPdf, scope);

const contacts = quote.customer?.customer_contacts ?? [];
const matched = contacts.find((c: { email?: string | null }) => c.email && c.email.toLowerCase() === recipients[0].toLowerCase()) ?? contacts.find((c: { is_primary?: boolean }) => c.is_primary) ?? contacts[0] ?? null;
const firstName = matched?.name?.trim().split(/\s+/)[0] ?? null;
const greeting = firstName ? `Hi ${firstName},` : "Hi,";
const subtitleParts = [quote.site_name, quote.site_address].filter(Boolean);
const emailHtml = emailLayout(`
  ${emailHeader({ rightLabel: "Quotation", rightValue: quote.ref })}
  <tr><td style="padding:32px 32px 12px">
    <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 4px;letter-spacing:-0.3px">Your Centrefit quote is ready</h1>
    <p style="font-size:13px;color:#475569;margin:14px 0 0;line-height:1.6">${greeting}</p>
    <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
      Thanks for the opportunity to quote ${quote.site_name ? `<strong>${quote.site_name}</strong>` : "your project"}. Your detailed quotation is attached as a PDF and is also available online via the link below — including the full scope of works, pricing breakdown, ongoing costs and applicable standards.
    </p>
    <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
      Please review the attached PDF, then click below to view it online and accept or decline.
    </p>
  </td></tr>
  ${subtitleParts.length > 0 ? `
  <tr><td style="padding:0 32px 8px">
    <p style="font-size:11px;color:#94a3b8;margin:0;line-height:1.5">${subtitleParts.join(" · ")}</p>
  </td></tr>` : ""}
  <tr><td align="center" style="padding:28px 32px 8px;text-align:center">
    <a href="${respondUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;text-align:center;padding:14px 28px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px;mso-padding-alt:0">
      View Quote &amp; Respond Online
    </a>
    <p style="font-size:11px;color:#94a3b8;margin:14px 0 0;text-align:center;line-height:1.5">
      You can review the full quote and accept or decline at the link above. Valid for 30 days.
    </p>
  </td></tr>
  ${emailFooter("Reply to this email if you have any questions.")}
`);
const subject = `Quotation ${quote.ref} — ${clientName}${quote.site_name ? ` — ${quote.site_name}` : ""}`;
const filename = `Centrefit-Quote-${quote.ref}.pdf`;

console.log(`${ref} · ${clientName} · ${quote.site_name} · $${fmt(pricing.totalExGST)} ex GST`);
console.log(`  to: ${recipients.join(", ")} · greeting "${greeting}" · subject "${subject}"`);
if (!SEND) {
  const out = `/tmp/${filename}`; writeFileSync(out, pdfBuffer); writeFileSync(`/tmp/${quote.ref}-email.html`, emailHtml);
  console.log(`  DRY — PDF at ${out}, email HTML at /tmp/${quote.ref}-email.html. Nothing sent, nothing changed.`);
  process.exit(0);
}

// ── the real send: same order as the route ──
const { error: upErr } = await supabase.from("quotes").update({ status: "sent", site_name: quote.site_name, site_address: quote.site_address, sent_at: new Date().toISOString(), sent_to_email: email, response_token: responseToken, sent_as_proposal: false }).eq("id", quote.id);
if (upErr) throw new Error(`status update: ${upErr.message}`);
if (quote.job_id) {
  const scopeText = renderScopeAsText(scope);
  const pay = isProgress && pricing.pp1 && pricing.pp2
    ? [`  • Progress Payment 1 (PP1) — On acceptance: $${fmt(pricing.pp1.total)} ex GST`, `  • Progress Payment 2 (PP2) — On completion: $${fmt(pricing.pp2.total)} ex GST`]
    : [`  • Full payment on completion: $${fmt(pricing.totalExGST)} ex GST`];
  await supabase.from("jobs").update({ description: `${scopeText}\n\nPAYMENT TERMS\n${pay.join("\n")}` }).eq("id", quote.job_id);
  await autoTransitionJobStatusServer(quote.job_id, "quote_sent", supabase as never);
}
const { error: sendError } = await new Resend(process.env.RESEND_API_KEY).emails.send({
  from: FROM_QUOTES, replyTo: REPLY_TO_SALES, to: recipients, subject, html: emailHtml,
  headers: { "X-Cf-Doc-Type": "quote", "X-Cf-Doc-Id": quote.id },
  attachments: [{ filename, content: pdfBuffer.toString("base64") }],
});
if (sendError) throw new Error(`resend: ${sendError.message}`);
await logDocumentActivity({ supabase: supabase as never, documentType: "quote", documentId: quote.id, eventType: "quote.sent", metadata: { to: email, ref: quote.ref, via: "scripts/quote-send.mts" } });
console.log(`  SENT ✓`);
