import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToFile } from "@react-pdf/renderer";

const h = React.createElement;

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 44, paddingHorizontal: 40, fontSize: 9.5, fontFamily: "Helvetica", color: "#0f172a", lineHeight: 1.4 },
  h1: { fontSize: 19, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  sub: { fontSize: 9, color: "#64748b", marginBottom: 14 },
  secWrap: { marginTop: 14, marginBottom: 4 },
  sec: { fontSize: 12, fontFamily: "Helvetica-Bold", color: "#0f172a", marginBottom: 2 },
  secNote: { fontSize: 8.5, color: "#64748b", marginBottom: 6 },
  row: { flexDirection: "row", marginBottom: 6, paddingBottom: 6, borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0" },
  num: { width: 16, fontFamily: "Helvetica-Bold", color: "#3b82f6" },
  body: { flex: 1 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  test: { fontSize: 8.5, color: "#475569", marginTop: 1.5 },
  tag: { fontSize: 8, color: "#94a3b8", marginTop: 1.5 },
  footer: { position: "absolute", bottom: 22, left: 40, right: 40, fontSize: 8, color: "#94a3b8", textAlign: "center", borderTopWidth: 0.5, borderTopColor: "#e2e8f0", paddingTop: 6 },
});

const shipped = [
  ["Admin routes locked down", "Log in as a NON-admin and try to hit /api/admin/* — should 403. Admins unaffected.", "security"],
  ["Test-invoice endpoint hardened", "send-test-invoice is now POST + only sends to @centrefit.com.au addresses.", "security"],
  ["Password reset = confirmation link", "Forgot password -> you get a LINK (not a temp password). Old password keeps working until you click + set a new one. Link dies after 1h / one use.", "security — please test end to end"],
  ["Pricing tables admin-only", "As a non-admin you can't change billing rates / labour timings / product or recurring-service catalogues.", "security"],
  ["Quote product search crash fixed", "Manual quote -> search products -> no more 'toLowerCase' white-screen.", "#1"],
  ["Manual scope renders in the PDF", "Make a MANUAL quote, write a scope with bold + bullets + line breaks, download/preview the PDF — should show real formatting, not <p> tags, and keep your line breaks.", "#18"],
  ["Recurring contact = site name only", "New recurring plan -> Xero/GoCardless contact reads 'Snap Fitness Preston', not 'Owner - Snap Fitness Preston'. (Existing contacts unchanged.)", "#3"],
  ["Recurring email -> site billing email", "Recurring DD notice goes to the site's billing_email first, then customer, then contact.", "#5"],
  ["Recurring invoices marked sent in Xero", "After a recurring child invoice lands, Xero shows it as 'sent' (so you know the customer was notified).", "#4"],
  ["Yearly recurring children ingested", "Mixed monthly+yearly plans: the yearly invoice now shows in the CRM instead of vanishing.", "audit bug"],
  ["Open Job link always shows", "Scheduler -> open an appointment for a COMPLETED / ready-to-invoice job -> 'Open Job' link is still there.", "#10/#11"],
  ["Assets grouped by category", "Site -> Assets tab -> items grouped under Security / CCTV / Data / Wi-Fi Details / etc, not one long list.", "#8"],
  ["Wi-Fi as one group", "Wi-Fi networks collapse into a single 'Wi-Fi Details' group, not separate boxes.", "#9"],
  ["Key Info copy buttons", "Site -> Key Info -> copy icon next to each credential + Wi-Fi SSID/password.", "#16"],
  ["Site billing email on customer form", "Customer -> add/edit a site -> there's now a Billing email field (matches the site-detail form).", "#15 core"],
  ["Electrical contractor colour", "Scheduler -> electrical contractor is slate-grey, easy to tell from Michael's red.", "#12"],
  ["Website NBN -> communications@", "Website NBN order form notification now lands in communications@ (decoupled env var NBN_NOTIFICATION_EMAIL).", "#17 — check Vercel env"],
  ["Reminder audit trail fixed", "A non-admin sending an invoice reminder now records a history row (was silently dropped).", "audit"],
  ["Notifications restored for Sue & Lily", "Their muted preference rows were reset to defaults — they should receive bell + email again. Have them confirm.", "today's bug"],
];

const verified = [
  ["PIR count is correct (13)", "Snap Fitness Beverley Hills shows 13 PIRs (duress pendants excluded). The old '18' was pre-fix. No change needed.", "#2"],
  ["Timezone is Brisbane", "Server time pinned to Australia/Brisbane. No change needed.", "#22"],
  ["Staff colours / default-all-staff", "Already shipped in the 25/05 batch. Flip Mark<->Mitch if Sue still sees them reversed.", "#13/14"],
];

const notShipped = [
  ["Auto overdue-reminder cadence", "NEEDS YOUR SIGN-OFF — it emails customers (3d before / due / +3 / +7). Won't wire the cron until you OK cadence + copy. Manual reminders work today.", "#6/#7"],
  ["Invoice status-per-column view", "Sort like quotes + a column per status. Safe UI, not built yet.", "#7"],
  ["Add-site button on Sites tab", "Needs a customer-picker modal. The data half (billing_email parity) is done.", "#15"],
  ["Operational-table RLS floor", "60 always-true write policies on customers/invoices/quotes/jobs/recurring_plans. Deferred — needs a permission-mapped migration, not a blind blast (would lock out field staff). Config/pricing tables ARE locked.", "audit"],
  ["Job-description rich text", "Deferred — it feeds the customer invoice narrative as plain text, so needs an HTML->text guard first.", "#18 extra"],
];

const newToday = [
  ["BUG: recurring not charging in GoCardless", "Mandate + invoice created but no subscription/payment in GoCardless = no money pulled. Next on my list to investigate.", "Mitchell"],
  ["Ad-hoc invoice -> site name not customer", "Same fix as recurring, for ad-hoc invoices raised off a job.", "Mitchell"],
  ["Ad-hoc invoice -> single 'Parts Used' line", "Collapse line items into one 'Parts Used' description.", "Sue"],
  ["Recurring yearly date picker", "MyAlarm yearly sub needs its own bill date (differs from monthly) when migrating in.", "Mitchell"],
  ["Ad-hoc PO from job procurement tab", "Button -> popup to pick parts -> draft PO -> purchasing sends to Xero. (Supersedes the old #23.)", "Mitchell"],
  ["Picking list <-> assets", "Connect admin picking list to the assets list + auto-fill makes/models.", "Michael"],
];

function Section({ title, note, items, startNum }) {
  return h(View, null,
    h(View, { style: s.secWrap }, h(Text, { style: s.sec }, title), note ? h(Text, { style: s.secNote }, note) : null),
    ...items.map((it, i) =>
      h(View, { style: s.row, key: i, wrap: false },
        h(Text, { style: s.num }, startNum ? `${startNum + i}` : "•"),
        h(View, { style: s.body },
          h(Text, { style: s.title }, it[0]),
          h(Text, { style: s.test }, `Test: ${it[1]}`),
          it[2] ? h(Text, { style: s.tag }, it[2]) : null,
        ),
      ),
    ),
  );
}

const doc = h(Document, null,
  h(Page, { size: "A4", style: s.page },
    h(Text, { style: s.h1 }, "Centrefit CRM — Session Smoke-Test List"),
    h(Text, { style: s.sub }, "2026-06-02  ·  audit + suggestion batch  ·  all SHIPPED items are live on crm.centrefit.com.au"),
    Section({ title: `Shipped & live (${shipped.length})`, note: "Each should already work in production — verify with the test step.", items: shipped, startNum: 1 }),
    Section({ title: `Verified already correct — no change (${verified.length})`, note: null, items: verified, startNum: null }),
    Section({ title: `Not shipped yet / needs a decision (${notShipped.length})`, note: null, items: notShipped, startNum: null }),
    Section({ title: `New suggestions today — triaged, not started (${newToday.length})`, note: "Captured from the suggestion box; the GoCardless one is a live bug.", items: newToday, startNum: null }),
    h(Text, { style: s.footer, fixed: true }, "Generated by Claude · full audit report at docs/audit-2026-06-01.md"),
  ),
);

const out = process.argv[2];
await renderToFile(doc, out);
console.log("WROTE " + out);
