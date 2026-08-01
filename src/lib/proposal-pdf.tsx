/**
 * Project Proposal PDF generator (React-PDF / no-Chromium).
 *
 * Renders the full Centrefit proposal — dark cover, who we are, what we do
 * differently, ongoing support, testimonials — then appends the existing
 * quote page(s) so proposal + quote ship as ONE seamless document. Replaces
 * the old Canva "Project Proposal" PDF (blue-swoosh template, old logo).
 *
 * Copy is deliberately hardcoded here (single source of truth, no CMS);
 * everything client-specific (names, ref, date, system list) merges in from
 * the quote + scope. Company stats live in COMPANY below so bumping "100+"
 * is a one-line change.
 */

import { Document, Page, View, Text, Image, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import React from "react";

// React-PDF hyphenates by default ("com-missioned", "op-erators") which reads
// cheap in a sales document — wrap on whole words only.
Font.registerHyphenationCallback((word) => [word]);
import fs from "fs";
import path from "path";
import type { ScopeDocument } from "@/lib/quote-engine";
import { QuotePage, distinctSiteName, type QuoteForPdf } from "./quote-pdf";
import { formatAuAddress } from "@/lib/format-address";

const loadAsset = (file: string): Buffer | null => {
  try { return fs.readFileSync(path.join(process.cwd(), "public", file)); } catch { return null; }
};
const LOGO_WHITE = loadAsset("centrefit-logo-white.png");
const LOGO_BLUE = loadAsset("centrefit-logo-blue.png");

// Copy lives in proposal-content.ts — the single source of truth shared with
// the web proposal page (/proposal/[token]) so the two can never drift.
import {
  COMPANY,
  WHO_WE_ARE,
  DIFFERENTIATORS,
  SUPPORT_CARDS,
  NBN_PLANS,
  OFFERINGS,
  TESTIMONIALS,
} from "./proposal-content";

// ── Styles ─────────────────────────────────────────────────────────────────

const SLATE = "#0f172a";
const INK = "#334155";
const MUTED = "#64748b";
const FAINT = "#94a3b8";
const LINE = "#e2e8f0";
const WASH = "#f8fafc";

const s = StyleSheet.create({
  // Cover
  cover: {
    backgroundColor: SLATE,
    paddingTop: 52,
    paddingBottom: 40,
    paddingHorizontal: 52,
    color: "#ffffff",
    fontFamily: "Helvetica",
  },
  coverLogo: { height: 34, width: 87, objectFit: "contain" },
  coverKicker: { fontSize: 10, color: FAINT, letterSpacing: 4, fontFamily: "Helvetica-Bold", marginBottom: 12 },
  coverTitle: { fontSize: 34, fontFamily: "Helvetica-Bold", letterSpacing: -0.5, lineHeight: 1.15 },
  coverTitleAccent: { color: "#cbd5e1" },
  coverAddress: { fontSize: 11, color: FAINT, marginTop: 8 },
  coverRule: { width: 46, height: 3, backgroundColor: "#ffffff", marginTop: 18, marginBottom: 18 },
  coverLead: { fontSize: 11, color: "#cbd5e1", lineHeight: 1.7, width: "85%", marginBottom: 18 },
  chipRow: { flexDirection: "row", flexWrap: "wrap" },
  chip: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 6,
  },
  chipText: { fontSize: 8.5, color: LINE },
  coverMeta: {
    flexDirection: "row",
    borderTopWidth: 0.5,
    borderTopColor: "#334155",
    paddingTop: 16,
    marginBottom: 14,
  },
  coverMetaCol: { flex: 1 },
  coverMetaLabel: { fontSize: 7.5, color: MUTED, letterSpacing: 1.4, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  coverMetaValue: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  coverMetaSub: { fontSize: 8, color: FAINT, marginTop: 1 },
  coverContact: { fontSize: 8, color: FAINT },

  // Inner pages
  page: {
    paddingTop: 44,
    paddingBottom: 54,
    paddingHorizontal: 48,
    fontSize: 9.5,
    color: SLATE,
    fontFamily: "Helvetica",
    lineHeight: 1.5,
  },
  innerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    paddingBottom: 10,
    marginBottom: 24,
  },
  innerLogo: { height: 26, width: 67, objectFit: "contain" },
  innerHeaderRight: { fontSize: 8, color: FAINT, letterSpacing: 1.2, fontFamily: "Helvetica-Bold" },

  kicker: { fontSize: 8.5, color: SLATE, letterSpacing: 2.2, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  h1: { fontSize: 22, fontFamily: "Helvetica-Bold", letterSpacing: -0.3, marginBottom: 14 },
  h2: { fontSize: 14, fontFamily: "Helvetica-Bold", letterSpacing: -0.2, marginBottom: 8 },
  para: { fontSize: 10.5, color: INK, lineHeight: 1.7, marginBottom: 10, width: "94%" },

  statBand: {
    flexDirection: "row",
    backgroundColor: WASH,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 6,
    marginTop: 8,
    marginBottom: 16,
  },
  statTile: { flex: 1, flexDirection: "column", alignItems: "center" },
  statTileDivider: { borderLeftWidth: 1, borderLeftColor: LINE },
  statN: { fontSize: 23, fontFamily: "Helvetica-Bold", color: SLATE, lineHeight: 1, marginBottom: 5 },
  statLabel: { fontSize: 7, color: MUTED, letterSpacing: 1, fontFamily: "Helvetica-Bold", lineHeight: 1 },

  brandsLabel: { fontSize: 8, color: FAINT, letterSpacing: 1.4, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  brandsRow: { flexDirection: "row", marginBottom: 16 },
  brandCol: { flex: 1 },
  brandName: { fontSize: 10.5, fontFamily: "Helvetica-Bold" },
  brandCount: { fontSize: 8.5, color: MUTED, marginTop: 1 },

  awardBand: {
    backgroundColor: SLATE,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  awardKicker: { fontSize: 7, color: FAINT, letterSpacing: 1.6, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  awardTitle: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  awardRight: { fontSize: 8, color: FAINT, textAlign: "right", width: "45%", lineHeight: 1.5 },

  diffRow: { flexDirection: "row", paddingBottom: 13, marginBottom: 13, borderBottomWidth: 0.5, borderBottomColor: LINE },
  diffRowLast: { flexDirection: "row" },
  diffNum: { width: 36, fontSize: 15, fontFamily: "Helvetica-Bold", color: FAINT },
  diffBody: { flex: 1 },
  diffTitle: { fontSize: 11.5, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  diffText: { fontSize: 9.5, color: INK, lineHeight: 1.6 },

  cardRow: { flexDirection: "row", marginBottom: 18 },
  card: {
    flex: 1,
    backgroundColor: WASH,
    borderWidth: 1,
    borderColor: LINE,
    borderTopWidth: 2,
    borderTopColor: SLATE,
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 4,
  },
  cardTitle: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  cardText: { fontSize: 8.5, color: INK, lineHeight: 1.55 },

  pillGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  pill: {
    width: "48.7%",
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
  },
  pillName: { fontSize: 9.5, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  pillDesc: { fontSize: 8.5, color: MUTED, lineHeight: 1.45 },

  nbnTable: {
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 8,
    overflow: "hidden",
    marginTop: 4,
    marginBottom: 10,
  },
  nbnRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: LINE,
  },
  nbnRowLast: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  nbnPlanCol: { width: "34%" },
  nbnSpeedCol: { width: "36%" },
  nbnPriceCol: { width: "30%", alignItems: "flex-end" },
  nbnName: { fontSize: 10.5, fontFamily: "Helvetica-Bold" },
  nbnFit: { fontSize: 8, color: MUTED, marginTop: 1, paddingRight: 8 },
  nbnSpeed: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  nbnEvening: { fontSize: 8, color: MUTED, marginTop: 1 },
  nbnPrice: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  nbnPriceTail: { fontSize: 7.5, color: FAINT, marginTop: 1 },
  nbnFootnote: { fontSize: 8, color: FAINT, lineHeight: 1.5 },

  complianceStrip: { marginTop: 6 },
  complianceLabel: { fontSize: 7.5, color: FAINT, letterSpacing: 1.2, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  complianceLine: { fontSize: 7.5, color: FAINT, lineHeight: 1.5 },

  tGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  tCard: {
    width: "48.7%",
    backgroundColor: WASH,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
  },
  tMark: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#cbd5e1", marginBottom: 2 },
  tQuote: { fontSize: 9, color: INK, lineHeight: 1.6, fontFamily: "Helvetica-Oblique" },
  tWho: { fontSize: 8.5, fontFamily: "Helvetica-Bold", marginTop: 8 },

  transition: {
    backgroundColor: SLATE,
    borderRadius: 8,
    padding: 18,
    marginTop: 10,
  },
  transitionKicker: { fontSize: 7.5, color: FAINT, letterSpacing: 2, fontFamily: "Helvetica-Bold", marginBottom: 5 },
  transitionText: { fontSize: 11.5, fontFamily: "Helvetica-Bold", color: "#ffffff", lineHeight: 1.5 },
  transitionSub: { fontSize: 8.5, color: FAINT, marginTop: 5 },

  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: FAINT,
    borderTopWidth: 0.5,
    borderTopColor: LINE,
    paddingTop: 8,
  },
});

// ── Shared pieces ──────────────────────────────────────────────────────────

function InnerHeader({ refText }: { refText: string }) {
  return (
    <View style={s.innerHeader} fixed>
      {LOGO_BLUE ? (
        <Image src={LOGO_BLUE} style={s.innerLogo} />
      ) : (
        <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold", color: "#1d4486" }}>Centrefit Group</Text>
      )}
      <Text style={s.innerHeaderRight}>PROJECT PROPOSAL · {refText}</Text>
    </View>
  );
}

function Footer() {
  return (
    <View style={s.footer} fixed>
      <Text>{COMPANY.legal} · {COMPANY.abn} · {COMPANY.suburb}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

// ── Document ───────────────────────────────────────────────────────────────

export function ProposalDocument({ quote, scope }: { quote: QuoteForPdf; scope: ScopeDocument }) {
  const dateStr = new Date(quote.createdAt).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  // Franchise quotes often duplicate the client name into site_name — only
  // append the site when it adds information, so merge fields never double up.
  const siteName = distinctSiteName(quote);
  const siteLabel = siteName ? `${quote.clientName} ${siteName}` : quote.clientName;
  const siteAddress = formatAuAddress(quote.siteAddress);
  const systems = scope.systems.map((sys) => sys.name);

  return (
    <Document title={`Proposal ${quote.ref} — ${siteLabel}`} author="Centrefit Group">

      {/* ── Cover ── */}
      <Page size="A4" style={s.cover}>
        {LOGO_WHITE ? (
          <Image src={LOGO_WHITE} style={s.coverLogo} />
        ) : (
          <Text style={{ fontSize: 16, fontFamily: "Helvetica-Bold" }}>Centrefit Group</Text>
        )}

        <View style={{ flexGrow: 1 }} />

        <Text style={s.coverKicker}>PROJECT PROPOSAL</Text>
        <Text style={s.coverTitle}>{quote.clientName}</Text>
        {!!siteName && (
          <Text style={[s.coverTitle, s.coverTitleAccent]}>{siteName}</Text>
        )}
        {!!siteAddress && <Text style={s.coverAddress}>{siteAddress}</Text>}
        <View style={s.coverRule} />
        <Text style={s.coverLead}>
          A complete technology fit-out for {siteLabel} — designed, installed, commissioned
          and supported by one team.
        </Text>
        {systems.length > 0 && (
          <View style={s.chipRow}>
            {systems.map((name, i) => (
              <View key={i} style={s.chip}>
                <Text style={s.chipText}>{name}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ flexGrow: 1.4 }} />

        <View style={s.coverMeta}>
          <View style={s.coverMetaCol}>
            <Text style={s.coverMetaLabel}>REFERENCE</Text>
            <Text style={s.coverMetaValue}>{quote.ref}</Text>
          </View>
          <View style={s.coverMetaCol}>
            <Text style={s.coverMetaLabel}>DATE</Text>
            <Text style={s.coverMetaValue}>{dateStr}</Text>
          </View>
          <View style={s.coverMetaCol}>
            <Text style={s.coverMetaLabel}>PREPARED BY</Text>
            <Text style={s.coverMetaValue}>{COMPANY.legal}</Text>
            <Text style={s.coverMetaSub}>{COMPANY.abn}</Text>
          </View>
        </View>
        <Text style={s.coverContact}>
          {COMPANY.web}   ·   {COMPANY.phone}   ·   {COMPANY.email}   ·   {COMPANY.suburb}
        </Text>
      </Page>

      {/* ── Who we are ── */}
      <Page size="A4" style={s.page}>
        <InnerHeader refText={quote.ref} />
        <Text style={s.kicker}>WHO WE ARE</Text>
        <Text style={s.h1}>Technology for spaces where people gather.</Text>
        {WHO_WE_ARE.map((p, i) => (
          <Text key={i} style={s.para}>{p}</Text>
        ))}

        <View style={s.statBand}>
          {COMPANY.stats.map((st, i) => (
            <View key={i} style={i === 0 ? s.statTile : [s.statTile, s.statTileDivider]}>
              <Text style={s.statN}>{st.n}</Text>
              <Text style={s.statLabel}>{st.label}</Text>
            </View>
          ))}
        </View>

        <Text style={s.brandsLabel}>WHO WE'VE BUILT FOR</Text>
        <View style={s.brandsRow}>
          {COMPANY.brands.map((b, i) => (
            <View key={i} style={s.brandCol}>
              <Text style={s.brandName}>{b.name}</Text>
              <Text style={s.brandCount}>{b.count}</Text>
            </View>
          ))}
        </View>

        <View style={s.awardBand}>
          <View>
            <Text style={s.awardKicker}>AWARDED</Text>
            <Text style={s.awardTitle}>{COMPANY.award}</Text>
          </View>
          <Text style={s.awardRight}>{COMPANY.licences}</Text>
        </View>
        <Footer />
      </Page>

      {/* ── What we do differently ── */}
      <Page size="A4" style={s.page}>
        <InnerHeader refText={quote.ref} />
        <Text style={s.kicker}>WHY CENTREFIT</Text>
        <Text style={s.h1}>What we do differently.</Text>
        {DIFFERENTIATORS.map((d, i) => (
          <View key={i} style={i === DIFFERENTIATORS.length - 1 ? s.diffRowLast : s.diffRow}>
            <Text style={s.diffNum}>{String(i + 1).padStart(2, "0")}</Text>
            <View style={s.diffBody}>
              <Text style={s.diffTitle}>{d.title}</Text>
              <Text style={s.diffText}>{d.body}</Text>
            </View>
          </View>
        ))}
        <Footer />
      </Page>

      {/* ── Support & beyond ── */}
      <Page size="A4" style={s.page}>
        <InnerHeader refText={quote.ref} />
        <Text style={s.kicker}>AFTER THE INSTALL</Text>
        <Text style={s.h1}>Support that doesn't clock off.</Text>
        <Text style={s.para}>
          The installation is where most contractors finish. It's where we start — every
          Centrefit site is backed by the team that built it.
        </Text>
        <View style={s.cardRow}>
          {SUPPORT_CARDS.map((c, i) => (
            <View key={i} style={s.card}>
              <Text style={s.cardTitle}>{c.title}</Text>
              <Text style={s.cardText}>{c.body}</Text>
            </View>
          ))}
        </View>

        <Text style={s.kicker}>BEYOND THIS PROPOSAL</Text>
        <Text style={s.h2}>One relationship, the whole stack.</Text>
        <Text style={[s.para, { marginBottom: 12 }]}>
          Services we can bundle into this project now, or add at any time down the track:
        </Text>
        <View style={s.pillGrid}>
          {OFFERINGS.map((o, i) => (
            <View key={i} style={s.pill}>
              <Text style={s.pillName}>{o.name}</Text>
              <Text style={s.pillDesc}>{o.desc}</Text>
            </View>
          ))}
        </View>

        <View style={s.complianceStrip}>
          <Text style={s.complianceLabel}>ALL WORKS CARRIED OUT TO AUSTRALIAN STANDARDS</Text>
          <Text style={s.complianceLine}>{COMPANY.standards}</Text>
        </View>
        <Footer />
      </Page>

      {/* ── NBN plans ── */}
      <Page size="A4" style={s.page}>
        <InnerHeader refText={quote.ref} />
        <Text style={s.kicker}>CONNECTIVITY</Text>
        <Text style={s.h1}>Business internet, managed by us.</Text>
        <Text style={s.para}>
          We're an internet provider as well as an integrator — one team for the connection,
          the network and everything running on it. Every plan is business-grade NBN with no
          lock-in and no setup fee, supported in Australia by the people who built your site.
        </Text>

        <View style={s.nbnTable}>
          {NBN_PLANS.map((p, i) => (
            <View key={i} style={i === NBN_PLANS.length - 1 ? s.nbnRowLast : s.nbnRow}>
              <View style={s.nbnPlanCol}>
                <Text style={s.nbnName}>{p.name}</Text>
                <Text style={s.nbnFit}>{p.fit}</Text>
              </View>
              <View style={s.nbnSpeedCol}>
                <Text style={s.nbnSpeed}>{p.speed} Mbps</Text>
                <Text style={s.nbnEvening}>Typical evening {p.evening} Mbps</Text>
              </View>
              <View style={s.nbnPriceCol}>
                <Text style={s.nbnPrice}>{p.price}</Text>
                <Text style={s.nbnPriceTail}>per month inc GST</Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={s.nbnFootnote}>
          Speeds shown as download / upload. Typical evening speeds measured 7–11pm. Static IP
          and 4G failover available on request. Where a plan is included in this proposal, the
          connection, hardware and configuration are covered in the scope of works.
        </Text>
        <Footer />
      </Page>

      {/* ── Testimonials + transition into the quote ── */}
      <Page size="A4" style={s.page}>
        <InnerHeader refText={quote.ref} />
        <Text style={s.kicker}>WHAT OUR CLIENTS SAY</Text>
        <Text style={s.h1}>Don't take our word for it.</Text>
        <View style={s.tGrid}>
          {TESTIMONIALS.map((t, i) => (
            <View key={i} style={s.tCard}>
              <Text style={s.tMark}>{"“"}</Text>
              <Text style={s.tQuote}>{t.quote}</Text>
              <Text style={s.tWho}>— {t.who}</Text>
            </View>
          ))}
        </View>

        <View style={s.transition}>
          <Text style={s.transitionKicker}>YOUR QUOTATION FOLLOWS</Text>
          <Text style={s.transitionText}>
            The pages that follow set out the full scope of works and your investment
            for {siteLabel}.
          </Text>
          <Text style={s.transitionSub}>
            Questions at any point — call {COMPANY.phone} and talk directly to the team
            who'll build it.
          </Text>
        </View>
        <Footer />
      </Page>

      {/* ── The quote, unchanged ── */}
      <QuotePage quote={quote} scope={scope} />
    </Document>
  );
}

// ── Public API: render to Buffer ───────────────────────────────────────────

export async function generateProposalPdfBuffer(
  quote: QuoteForPdf,
  scope: ScopeDocument,
): Promise<Buffer> {
  return renderToBuffer(<ProposalDocument quote={quote} scope={scope} />);
}
