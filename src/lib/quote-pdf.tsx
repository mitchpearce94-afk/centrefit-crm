/**
 * Quote PDF generator (React-PDF / no-Chromium).
 *
 * Renders the full quote document — header, summary, system-card scope of
 * works, by-others blocks, hard exclusion, ongoing costs, pricing, progress
 * payments, standards, footer — to a binary PDF buffer suitable for email
 * attachment or direct download.
 *
 * Layout mirrors the in-CRM HTML preview but is rebuilt using @react-pdf
 * components because puppeteer+chromium is too heavy for serverless.
 */

import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import fs from "fs";
import path from "path";
import type {
  ScopeDocument,
  ScopeSystemBlock,
  ScopeByOthersBlock,
  ScopeOngoingCost,
} from "@/lib/quote-engine";

// Load the brand logo once at module init. Files in /public are available on
// Vercel serverless via process.cwd().
const LOGO_BLUE_PATH = path.join(process.cwd(), "public", "centrefit-logo-blue.png");
const LOGO_BLUE_BUFFER: Buffer | null = (() => {
  try { return fs.readFileSync(LOGO_BLUE_PATH); } catch { return null; }
})();

// ── Fonts ──────────────────────────────────────────────────────────────────
// React-PDF defaults to Helvetica which renders fine but doesn't include
// emoji / extended unicode. We don't need extended chars so we stick with
// the default to keep the bundle small.

// ── Types ──────────────────────────────────────────────────────────────────

export interface QuoteForPdf {
  ref: string;
  createdAt: string;
  clientName: string;
  siteName: string | null;
  siteAddress: string | null;
  isProgress: boolean;
  pricing: {
    totalExGST: number;
    totalIncGST: number;
    gst: number;
    fullPriceExGST?: number;
    discount?: { percent: number; amount: number };
    pp1?: { total: number };
    pp2?: { total: number };
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Strip <strong> wrappers from an item string into a list of segments so we
 * can apply bold styling within React-PDF (which doesn't render HTML).
 */
function tokenize(text: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  const re = /<strong>(.*?)<\/strong>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out;
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 50,
    paddingHorizontal: 40,
    fontSize: 9.5,
    color: "#0f172a",
    fontFamily: "Helvetica",
    lineHeight: 1.5,
  },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottomWidth: 2,
    borderBottomColor: "#0f172a",
    paddingBottom: 12,
    marginBottom: 18,
  },
  brandLogo: {
    height: 40,
    width: 102,             // logo aspect ratio is ~2.56:1 (1200/468)
    objectFit: "contain",
  },
  docMeta: { textAlign: "right" },
  docTitle: { fontSize: 8.5, color: "#94a3b8", letterSpacing: 1.2, fontFamily: "Helvetica-Bold" },
  docRef: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 2 },
  docDate: { fontSize: 9, color: "#475569", marginTop: 1 },

  // Title
  docH1: { fontSize: 18, fontFamily: "Helvetica-Bold", letterSpacing: -0.3, marginBottom: 6 },

  // Client band
  clientBand: {
    flexDirection: "row",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 6,
    padding: 12,
    marginTop: 8,
    marginBottom: 18,
  },
  clientCol: { flex: 1 },
  clientLabel: { fontSize: 7.5, color: "#94a3b8", letterSpacing: 1.2, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  clientStrong: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  clientValue: { fontSize: 9, color: "#475569", marginTop: 1 },

  // Summary card
  summaryCard: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
  },
  summaryLead: { fontSize: 10, lineHeight: 1.55, marginBottom: 10 },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 6 },
  summaryRow: {
    width: "50%",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    paddingRight: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e2e8f0",
    borderBottomStyle: "dashed",
    fontSize: 9,
  },
  summaryRowName: { color: "#0f172a" },
  summaryRowQty: { color: "#475569", fontFamily: "Helvetica-Bold" },

  // Section heading
  sectionDivider: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingBottom: 4,
    marginTop: 12,
    marginBottom: 8,
  },
  sectionH: { fontSize: 9.5, fontFamily: "Helvetica-Bold", letterSpacing: 1.3, color: "#0f172a" },
  sectionSub: { fontSize: 8, color: "#94a3b8" },

  // System block
  systemBlock: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    marginBottom: 8,
    overflow: "hidden",
  },
  systemHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  systemHeadLeft: { flexDirection: "row", alignItems: "center" },
  iconPill: {
    width: 20,
    height: 20,
    backgroundColor: "#0f172a",
    color: "#ffffff",
    textAlign: "center",
    paddingTop: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    borderRadius: 5,
    marginRight: 8,
  },
  systemName: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  systemCounts: { fontSize: 8, color: "#475569", textAlign: "right" },
  systemCountsStrong: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  systemBody: { paddingHorizontal: 12, paddingVertical: 8 },
  systemLead: { fontSize: 9.5, marginBottom: 6, lineHeight: 1.55 },
  bulletRow: { flexDirection: "row", marginVertical: 1.5, paddingLeft: 4 },
  bullet: { color: "#047857", fontSize: 11, marginRight: 6, marginTop: 1 },
  bulletText: { fontSize: 9, color: "#475569", flex: 1, lineHeight: 1.4 },

  // By Others
  byOthersHead: {
    backgroundColor: "#fef3c7",
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: 1,
    borderColor: "#fde68a",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  byOthersHeadText: { fontSize: 9, color: "#92400e", letterSpacing: 1.1, fontFamily: "Helvetica-Bold" },
  byOthersBody: {
    backgroundColor: "#fffbeb",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#fde68a",
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  byOthersBlock: { marginBottom: 8 },
  byOthersBullet: { color: "#b45309" },
  byOthersText: { color: "#78350f" },

  // Hard exclusion
  hardExclusion: {
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    textAlign: "center",
    color: "#991b1b",
    fontFamily: "Helvetica-Bold",
    fontSize: 9.5,
    letterSpacing: 0.5,
    marginBottom: 8,
  },

  // Ongoing costs
  notesBlock: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  notesH3: { fontSize: 9, fontFamily: "Helvetica-Bold", letterSpacing: 1.1, marginBottom: 6 },
  notesItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e2e8f0",
    borderBottomStyle: "dashed",
  },
  notesItemLast: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  notesDesc: { fontSize: 9, color: "#475569" },
  notesPrice: { fontSize: 9, fontFamily: "Helvetica-Bold" },

  // Pricing
  pricingBox: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 12,
  },
  pricingTop: { padding: 16, backgroundColor: "#f8fafc" },
  pricingRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  pricingLabel: { fontSize: 10, color: "#64748b" },
  pricingValue: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  pricingTotal: {
    backgroundColor: "#0f172a",
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  pricingTotalLabel: { color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 11, letterSpacing: 0.5 },
  pricingTotalValue: { color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 18 },

  // Progress payments
  paymentRow: { flexDirection: "row", marginBottom: 12 },
  paymentBox: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 6,
    padding: 12,
    marginHorizontal: 4,
  },
  paymentLabel: { fontSize: 8, color: "#64748b", letterSpacing: 1, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  paymentValue: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  paymentTail: { fontSize: 8, color: "#94a3b8" },

  // Standards & assumptions
  standardsBlock: { marginTop: 10 },
  standardsLine: { fontSize: 8, color: "#94a3b8", lineHeight: 1.4 },
  standardsLabel: { fontSize: 8, color: "#94a3b8", letterSpacing: 1, fontFamily: "Helvetica-Bold", marginBottom: 4 },

  assumptionsBlock: { marginTop: 8, marginBottom: 8 },
  assumptionRow: { flexDirection: "row", marginVertical: 1, paddingLeft: 4 },
  assumptionDash: { color: "#94a3b8", marginRight: 6 },
  assumptionText: { fontSize: 8.5, color: "#475569", flex: 1, lineHeight: 1.4 },

  // Validity
  validity: {
    fontSize: 9,
    color: "#94a3b8",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 4,
  },

  // Footer
  pageFooter: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: "#94a3b8",
    borderTopWidth: 0.5,
    borderTopColor: "#e2e8f0",
    paddingTop: 8,
  },
});

// ── Component pieces ───────────────────────────────────────────────────────

function BulletItem({ html, bulletColor = "#047857", textColor = "#475569" }: { html: string; bulletColor?: string; textColor?: string }) {
  const segments = tokenize(html);
  return (
    <View style={styles.bulletRow}>
      <Text style={[styles.bullet, { color: bulletColor }]}>•</Text>
      <Text style={[styles.bulletText, { color: textColor }]}>
        {segments.map((seg, i) => (
          <Text key={i} style={seg.bold ? { fontFamily: "Helvetica-Bold", color: "#0f172a" } : {}}>
            {seg.text}
          </Text>
        ))}
      </Text>
    </View>
  );
}

function SystemBlock({ sys }: { sys: ScopeSystemBlock }) {
  return (
    <View style={styles.systemBlock} wrap={false}>
      <View style={styles.systemHead}>
        <View style={styles.systemHeadLeft}>
          <Text style={styles.iconPill}>{sys.iconLabel}</Text>
          <Text style={styles.systemName}>{sys.name}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          {!!sys.countSummary && <Text style={styles.systemCountsStrong}>{sys.countSummary}</Text>}
          {!!sys.subSummary && <Text style={styles.systemCounts}>{sys.subSummary}</Text>}
        </View>
      </View>
      <View style={styles.systemBody}>
        {!!sys.lead && <Text style={styles.systemLead}>{sys.lead}</Text>}
        {sys.items.map((item, i) => (
          <BulletItem key={i} html={item} />
        ))}
      </View>
    </View>
  );
}

function ByOthersBlock({ blk }: { blk: ScopeByOthersBlock }) {
  return (
    <View style={styles.byOthersBlock} wrap={false}>
      <View style={styles.byOthersHead}>
        <Text style={styles.byOthersHeadText}>{blk.name.toUpperCase()}</Text>
      </View>
      <View style={styles.byOthersBody}>
        {blk.items.map((item, i) => (
          <BulletItem key={i} html={item} bulletColor="#b45309" textColor="#78350f" />
        ))}
      </View>
    </View>
  );
}

function OngoingCosts({ items }: { items: ScopeOngoingCost[] }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.notesBlock} wrap={false}>
      <Text style={styles.notesH3}>ONGOING COSTS</Text>
      {items.map((c, i) => (
        <View key={c.id} style={i === items.length - 1 ? styles.notesItemLast : styles.notesItem}>
          <Text style={styles.notesDesc}>{c.desc}</Text>
          <Text style={styles.notesPrice}>{c.price}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Main document ──────────────────────────────────────────────────────────

export function QuoteDocument({ quote, scope }: { quote: QuoteForPdf; scope: ScopeDocument }) {
  const dateStr = new Date(quote.createdAt).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <Document title={`Quote ${quote.ref}`} author="Centrefit Group">
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          {LOGO_BLUE_BUFFER ? (
            <Image src={LOGO_BLUE_BUFFER} style={styles.brandLogo} />
          ) : (
            <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold", color: "#1d4486" }}>Centrefit Group</Text>
          )}
          <View style={styles.docMeta}>
            <Text style={styles.docTitle}>QUOTATION</Text>
            <Text style={styles.docRef}>{quote.ref}</Text>
            <Text style={styles.docDate}>{dateStr}</Text>
          </View>
        </View>

        {/* Title + Client */}
        <Text style={styles.docH1}>
          {quote.clientName}
          {quote.siteName ? ` — ${quote.siteName}` : ""}
        </Text>
        <View style={styles.clientBand}>
          <View style={styles.clientCol}>
            <Text style={styles.clientLabel}>PREPARED FOR</Text>
            <Text style={styles.clientStrong}>{quote.clientName}</Text>
            {!!quote.siteAddress && <Text style={styles.clientValue}>{quote.siteAddress}</Text>}
          </View>
          <View style={[styles.clientCol, { alignItems: "flex-end" }]}>
            <Text style={styles.clientLabel}>PREPARED BY</Text>
            <Text style={styles.clientStrong}>Centrefit Group Pty Ltd</Text>
            <Text style={styles.clientValue}>ABN 55 168 413 161 · (07) 3188 5115</Text>
          </View>
        </View>

        {/* Executive summary */}
        {(scope.summary.lead || scope.summary.rows.length > 0) && (
          <View style={styles.summaryCard} wrap={false}>
            {!!scope.summary.lead && <Text style={styles.summaryLead}>{scope.summary.lead}</Text>}
            {scope.summary.rows.length > 0 && (
              <View style={styles.summaryGrid}>
                {scope.summary.rows.map((row, i) => (
                  <View key={i} style={styles.summaryRow}>
                    <Text style={styles.summaryRowName}>{row.name}</Text>
                    <Text style={styles.summaryRowQty}>{row.qty}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Included by Centrefit */}
        {scope.systems.length > 0 && (
          <>
            <View style={styles.sectionDivider}>
              <Text style={styles.sectionH}>INCLUDED BY CENTREFIT</Text>
              <Text style={styles.sectionSub}>Supply · install · commission · train</Text>
            </View>
            {scope.systems.map((sys) => (
              <SystemBlock key={sys.id} sys={sys} />
            ))}
          </>
        )}

        {/* By the Customer's Trades */}
        {scope.byOthers.length > 0 && (
          <>
            <View style={styles.sectionDivider}>
              <Text style={styles.sectionH}>BY THE CUSTOMER'S TRADES</Text>
              <Text style={styles.sectionSub}>Items the gym's electrician / locksmith handles</Text>
            </View>
            {scope.byOthers.map((blk) => (
              <ByOthersBlock key={blk.id} blk={blk} />
            ))}
          </>
        )}

        {/* Hard exclusion */}
        {!!scope.hardExclusion && <Text style={styles.hardExclusion}>{scope.hardExclusion}</Text>}

        {/* Ongoing costs */}
        <OngoingCosts items={scope.ongoingCosts} />

        {/* Pricing */}
        <View style={styles.sectionDivider}>
          <Text style={styles.sectionH}>PRICING</Text>
        </View>
        <View style={styles.pricingBox} wrap={false}>
          <View style={styles.pricingTop}>
            {!!quote.pricing.discount && quote.pricing.discount.percent > 0 && (
              <>
                <View style={styles.pricingRow}>
                  <Text style={styles.pricingLabel}>Subtotal (ex GST)</Text>
                  <Text style={[styles.pricingValue, { color: "#94a3b8", textDecoration: "line-through" }]}>
                    ${fmtMoney(quote.pricing.fullPriceExGST ?? 0)}
                  </Text>
                </View>
                <View style={styles.pricingRow}>
                  <Text style={[styles.pricingLabel, { color: "#16a34a" }]}>{quote.pricing.discount.percent}% Discount</Text>
                  <Text style={[styles.pricingValue, { color: "#16a34a" }]}>
                    -${fmtMoney(quote.pricing.discount.amount)}
                  </Text>
                </View>
              </>
            )}
            <View style={styles.pricingRow}>
              <Text style={styles.pricingLabel}>Total (ex GST)</Text>
              <Text style={styles.pricingValue}>${fmtMoney(quote.pricing.totalExGST)}</Text>
            </View>
            <View style={styles.pricingRow}>
              <Text style={styles.pricingLabel}>GST (10%)</Text>
              <Text style={styles.pricingValue}>${fmtMoney(quote.pricing.gst)}</Text>
            </View>
          </View>
          <View style={styles.pricingTotal}>
            <Text style={styles.pricingTotalLabel}>TOTAL (INC GST)</Text>
            <Text style={styles.pricingTotalValue}>${fmtMoney(quote.pricing.totalIncGST)}</Text>
          </View>
        </View>

        {/* Progress payments */}
        {quote.isProgress && quote.pricing.pp1 && quote.pricing.pp2 && (
          <>
            <View style={styles.sectionDivider}>
              <Text style={styles.sectionH}>PROGRESS PAYMENTS</Text>
            </View>
            <View style={styles.paymentRow}>
              <View style={styles.paymentBox}>
                <Text style={styles.paymentLabel}>PAYMENT 1 — DUE ON ACCEPTANCE</Text>
                <Text style={styles.paymentValue}>${fmtMoney(quote.pricing.pp1.total * 1.1)}</Text>
                <Text style={styles.paymentTail}>inc GST</Text>
              </View>
              <View style={styles.paymentBox}>
                <Text style={styles.paymentLabel}>PAYMENT 2 — DUE ON COMPLETION</Text>
                <Text style={styles.paymentValue}>${fmtMoney(quote.pricing.pp2.total * 1.1)}</Text>
                <Text style={styles.paymentTail}>inc GST</Text>
              </View>
            </View>
          </>
        )}

        {/* Assumptions */}
        {scope.assumptions.length > 0 && (
          <View style={styles.assumptionsBlock} wrap={false}>
            <Text style={styles.standardsLabel}>ASSUMPTIONS</Text>
            {scope.assumptions.map((a, i) => (
              <View key={i} style={styles.assumptionRow}>
                <Text style={styles.assumptionDash}>–</Text>
                <Text style={styles.assumptionText}>{a}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Validity */}
        <Text style={styles.validity}>This quotation is valid for 30 days from the date of issue.</Text>

        {/* Standards */}
        {scope.standards.length > 0 && (
          <View style={styles.standardsBlock} wrap={false}>
            <Text style={styles.standardsLabel}>STANDARDS &amp; CODES OF PRACTICE</Text>
            <Text style={styles.standardsLine}>{scope.standards.join(" · ")}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.pageFooter} fixed>
          <Text>Centrefit Group Pty Ltd · ABN 55 168 413 161 · Lawnton QLD 4501</Text>
          <Text
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

// ── Public API: render to Buffer ───────────────────────────────────────────

export async function generateQuotePdfBuffer(
  quote: QuoteForPdf,
  scope: ScopeDocument,
): Promise<Buffer> {
  return renderToBuffer(<QuoteDocument quote={quote} scope={scope} />);
}
