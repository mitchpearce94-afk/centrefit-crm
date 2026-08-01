/**
 * Project Proposal PDF generator (React-PDF / no-Chromium).
 *
 * Dark-story edition — mirrors the web proposal (/proposal/[token]) page for
 * page: constellation cover, statement + stats, who we are, differentiators,
 * support, NBN plans, testimonials, "Let's build it." close — then the
 * existing quote page(s) as clean white paper, so proposal + quote ship as
 * ONE seamless document, and the PDF feels like a printout of the web
 * experience minus the motion.
 *
 * Copy comes from lib/proposal-content.ts (single source shared with the web
 * page); everything client-specific (names, ref, date, address, system list)
 * merges in from the quote + scope.
 */

import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  Font,
  renderToBuffer,
  Svg,
  Line,
  Circle,
  Ellipse,
  Defs,
  RadialGradient,
  Stop,
} from "@react-pdf/renderer";
import React from "react";

// React-PDF hyphenates by default ("com-missioned", "op-erators") which reads
// cheap in a sales document — wrap on whole words only.
Font.registerHyphenationCallback((word) => [word]);
import fs from "fs";
import path from "path";
import type { ScopeDocument } from "@/lib/quote-engine";
import { QuotePage, distinctSiteName, type QuoteForPdf } from "./quote-pdf";
import { formatAuAddress } from "@/lib/format-address";
import {
  COMPANY,
  WHO_WE_ARE,
  DIFFERENTIATORS,
  SUPPORT_CARDS,
  NBN_PLANS,
  OFFERINGS,
  TESTIMONIALS,
} from "./proposal-content";

const loadAsset = (file: string): Buffer | null => {
  try { return fs.readFileSync(path.join(process.cwd(), "public", file)); } catch { return null; }
};
const LOGO_WHITE = loadAsset("centrefit-logo-white.png");

// ── Dark-story palette (mirrors the web proposal) ──────────────────────────

const BG = "#0b1220";          // page background
const PANEL = "#131f35";       // glass panel fill
const PANEL_LIGHT = "#16233c"; // raised panel fill
const BORDER = "#2a3a55";      // panel borders
const HAIRLINE = "#1e293b";    // section rules
const WHITE = "#ffffff";
const SLATE_200 = "#e2e8f0";
const SLATE_300 = "#cbd5e1";
const SLATE_400 = "#94a3b8";
const SLATE_500 = "#64748b";
const SLATE_600 = "#526078";
const BODY = "#b7c3d6";
const BLUE = "#3b82f6";
const BLUE_LIGHT = "#93c5fd";
const WATERMARK = "#121e33";

const SERVICES_STRIP = ["SECURITY", "CCTV", "ACCESS CONTROL", "DATA & WI-FI", "AUDIO", "INTERNET", "24/7 MONITORING"];

// ── Deterministic constellation (static twin of the web canvas) ────────────

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function Constellation({
  width,
  height,
  count,
  seed,
  link = 85,
}: {
  width: number;
  height: number;
  count: number;
  seed: number;
  link?: number;
}) {
  const rand = mulberry32(seed);
  const nodes = Array.from({ length: count }, () => ({
    x: rand() * width,
    y: rand() * height,
    r: 0.7 + rand() * 1.1,
  }));
  const lines: { x1: number; y1: number; x2: number; y2: number; o: number }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
      if (d < link) {
        lines.push({ x1: nodes[i].x, y1: nodes[i].y, x2: nodes[j].x, y2: nodes[j].y, o: (1 - d / link) * 0.32 });
      }
    }
  }
  return (
    <Svg width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }}>
      {lines.map((l, i) => (
        <Line key={`l${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#60a5fa" strokeOpacity={l.o} strokeWidth={0.6} />
      ))}
      {nodes.map((n, i) => (
        <Circle key={`n${i}`} cx={n.x} cy={n.y} r={n.r} fill="#94a3b8" fillOpacity={0.55} />
      ))}
    </Svg>
  );
}

function GlowWash({ width, height, cx, cy, rx, ry, opacity = 0.22 }: { width: number; height: number; cx: number; cy: number; rx: number; ry: number; opacity?: number }) {
  return (
    <Svg width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }}>
      <Defs>
        <RadialGradient id="glow">
          <Stop offset="0%" stopColor={BLUE} stopOpacity={opacity} />
          <Stop offset="100%" stopColor={BLUE} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#glow)" />
    </Svg>
  );
}

// A4 in points.
const A4W = 595.28;
const A4H = 841.89;

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // Shared dark page
  page: {
    backgroundColor: BG,
    paddingTop: 44,
    paddingBottom: 56,
    paddingHorizontal: 48,
    fontSize: 9.5,
    color: SLATE_300,
    fontFamily: "Helvetica",
    lineHeight: 1.5,
  },

  // Cover
  cover: {
    backgroundColor: BG,
    paddingTop: 48,
    paddingBottom: 40,
    paddingHorizontal: 52,
    color: WHITE,
    fontFamily: "Helvetica",
  },
  coverBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  coverLogo: { height: 32, width: 82, objectFit: "contain" },
  coverMetaRight: { alignItems: "flex-end" },
  coverRef: { fontSize: 11, fontFamily: "Helvetica-Bold", color: SLATE_200, letterSpacing: 0.5 },
  coverDate: { fontSize: 8, color: SLATE_500, marginTop: 2 },
  coverCenter: { alignItems: "center", textAlign: "center" },
  coverKicker: { fontSize: 9.5, color: SLATE_400, letterSpacing: 5, fontFamily: "Helvetica-Bold", marginBottom: 16 },
  coverTitle: { fontSize: 40, fontFamily: "Helvetica-Bold", letterSpacing: -0.5, lineHeight: 1.08, textAlign: "center" },
  coverTitleAccent: { color: SLATE_500 },
  coverAddress: { fontSize: 12, color: SLATE_400, marginTop: 12, textAlign: "center" },
  coverRule: { width: 56, height: 3, backgroundColor: BLUE, borderRadius: 2, marginTop: 22, marginBottom: 22 },
  coverLead: { fontSize: 11.5, color: SLATE_300, lineHeight: 1.7, maxWidth: 340, textAlign: "center", marginBottom: 22 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", maxWidth: 420 },
  chip: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 4.5,
    marginHorizontal: 3,
    marginBottom: 7,
    backgroundColor: PANEL,
  },
  chipText: { fontSize: 8.5, color: SLATE_200 },
  coverBottom: {
    flexDirection: "row",
    borderTopWidth: 0.5,
    borderTopColor: BORDER,
    paddingTop: 16,
    marginBottom: 12,
  },
  coverBottomCol: { flex: 1 },
  coverBottomLabel: { fontSize: 7, color: SLATE_500, letterSpacing: 1.4, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  coverBottomValue: { fontSize: 10, fontFamily: "Helvetica-Bold", color: WHITE },
  coverBottomSub: { fontSize: 7.5, color: SLATE_500, marginTop: 1 },
  coverContact: { fontSize: 7.5, color: SLATE_600, textAlign: "center" },

  // Inner page chrome
  innerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
    paddingBottom: 10,
    marginBottom: 26,
  },
  innerLogo: { height: 24, width: 62, objectFit: "contain" },
  innerHeaderRight: { fontSize: 8, color: SLATE_600, letterSpacing: 1.2, fontFamily: "Helvetica-Bold" },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: SLATE_600,
    borderTopWidth: 0.5,
    borderTopColor: HAIRLINE,
    paddingTop: 8,
  },
  watermark: {
    position: "absolute",
    top: 30,
    right: 34,
    fontSize: 150,
    fontFamily: "Helvetica-Bold",
    color: WATERMARK,
  },

  kicker: { fontSize: 8.5, color: SLATE_500, letterSpacing: 2.6, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  h1: { fontSize: 23, fontFamily: "Helvetica-Bold", letterSpacing: -0.3, marginBottom: 14, color: WHITE },
  h2: { fontSize: 14, fontFamily: "Helvetica-Bold", letterSpacing: -0.2, marginBottom: 8, color: WHITE },
  para: { fontSize: 10.5, color: BODY, lineHeight: 1.7, marginBottom: 10, maxWidth: 460 },

  // Statement page
  statementWrap: { flexGrow: 1, justifyContent: "center" },
  statementLine: { fontSize: 46, fontFamily: "Helvetica-Bold", letterSpacing: -1, lineHeight: 1.12, color: WHITE },
  statementGhost: { color: "#33445f" },
  statementBlue: { color: BLUE_LIGHT },
  servicesStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    borderTopWidth: 0.5,
    borderTopColor: HAIRLINE,
    borderBottomWidth: 0.5,
    borderBottomColor: HAIRLINE,
    paddingVertical: 12,
    marginTop: 26,
  },
  serviceItem: { fontSize: 8.5, color: SLATE_600, letterSpacing: 2, fontFamily: "Helvetica-Bold" },
  serviceDot: { fontSize: 8.5, color: BLUE, marginHorizontal: 8 },

  statBand: { flexDirection: "row", marginTop: 30, marginBottom: 8 },
  statTile: { flex: 1, alignItems: "center" },
  statN: { fontSize: 30, fontFamily: "Helvetica-Bold", color: WHITE, lineHeight: 1, marginBottom: 6 },
  statLabel: { fontSize: 6.5, color: SLATE_500, letterSpacing: 1.2, fontFamily: "Helvetica-Bold", lineHeight: 1 },

  // Brands + award
  brandsRow: { flexDirection: "row", marginBottom: 16, marginTop: 6 },
  brandCard: {
    flex: 1,
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginHorizontal: 3,
  },
  brandName: { fontSize: 10, fontFamily: "Helvetica-Bold", color: WHITE },
  brandCount: { fontSize: 8, color: SLATE_500, marginTop: 2 },
  awardBand: {
    backgroundColor: PANEL_LIGHT,
    borderWidth: 1,
    borderColor: "#2e4a77",
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  awardKicker: { fontSize: 7, color: BLUE_LIGHT, letterSpacing: 1.6, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  awardTitle: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: WHITE },
  awardRight: { fontSize: 7.5, color: SLATE_400, textAlign: "right", width: "42%", lineHeight: 1.5 },

  // Differentiator cards
  diffCard: {
    flexDirection: "row",
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 14,
    marginBottom: 9,
  },
  diffNum: { width: 40, fontSize: 19, fontFamily: "Helvetica-Bold", color: "#60a5fa" },
  diffBody: { flex: 1 },
  diffTitle: { fontSize: 11.5, fontFamily: "Helvetica-Bold", marginBottom: 3, color: WHITE },
  diffText: { fontSize: 9.5, color: "#a3b2c7", lineHeight: 1.6 },

  // Support cards + pills
  cardRow: { flexDirection: "row", marginBottom: 18 },
  card: {
    flex: 1,
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: BORDER,
    borderTopWidth: 2,
    borderTopColor: BLUE,
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 4,
  },
  cardTitle: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginBottom: 4, color: WHITE },
  cardText: { fontSize: 8.5, color: "#a3b2c7", lineHeight: 1.55 },
  pillGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  pill: {
    width: "48.7%",
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  pillName: { fontSize: 9.5, fontFamily: "Helvetica-Bold", marginBottom: 2, color: WHITE },
  pillDesc: { fontSize: 8.5, color: "#8fa0b8", lineHeight: 1.45 },

  // NBN
  nbnRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginBottom: 7,
  },
  nbnPlanCol: { width: "34%" },
  nbnSpeedCol: { width: "36%" },
  nbnPriceCol: { width: "30%", alignItems: "flex-end" },
  nbnName: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: WHITE },
  nbnFit: { fontSize: 7.5, color: "#8fa0b8", marginTop: 1, paddingRight: 8 },
  nbnSpeed: { fontSize: 10, fontFamily: "Helvetica-Bold", color: SLATE_200 },
  nbnEvening: { fontSize: 7.5, color: SLATE_500, marginTop: 1 },
  nbnPrice: { fontSize: 14, fontFamily: "Helvetica-Bold", color: WHITE },
  nbnPriceTail: { fontSize: 7, color: SLATE_500, marginTop: 1 },
  nbnFootnote: { fontSize: 7.5, color: SLATE_500, lineHeight: 1.5, marginTop: 6 },
  standardsLine: { fontSize: 7, color: SLATE_600, letterSpacing: 0.4, lineHeight: 1.6, marginTop: 20 },

  // Testimonials
  tGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  tCard: {
    width: "48.7%",
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  tMark: { fontSize: 20, fontFamily: "Helvetica-Bold", color: BLUE, marginBottom: 2 },
  tQuote: { fontSize: 9, color: "#c3cede", lineHeight: 1.6, fontFamily: "Helvetica-Oblique" },
  tWho: { fontSize: 8.5, fontFamily: "Helvetica-Bold", marginTop: 8, color: WHITE },

  // Let's build it
  buildBand: {
    backgroundColor: PANEL_LIGHT,
    borderWidth: 1,
    borderColor: "#2e4a77",
    borderRadius: 12,
    padding: 24,
    marginTop: 14,
    alignItems: "center",
  },
  buildKicker: { fontSize: 7.5, color: SLATE_500, letterSpacing: 2.4, fontFamily: "Helvetica-Bold", marginBottom: 10 },
  buildTitle: { fontSize: 30, fontFamily: "Helvetica-Bold", color: WHITE, letterSpacing: -0.5, marginBottom: 10 },
  buildText: { fontSize: 9.5, color: BODY, lineHeight: 1.6, textAlign: "center", maxWidth: 380 },
});

// ── Shared pieces ──────────────────────────────────────────────────────────

function InnerHeader({ refText }: { refText: string }) {
  return (
    <View style={s.innerHeader} fixed>
      {LOGO_WHITE ? (
        <Image src={LOGO_WHITE} style={s.innerLogo} />
      ) : (
        <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold", color: WHITE }}>Centrefit Group</Text>
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

function Watermark({ n }: { n: string }) {
  return <Text style={s.watermark} fixed>{n}</Text>;
}

function ServicesStrip() {
  return (
    <View style={s.servicesStrip}>
      {SERVICES_STRIP.map((sv, i) => (
        <React.Fragment key={sv}>
          <Text style={s.serviceItem}>{sv}</Text>
          {i < SERVICES_STRIP.length - 1 && <Text style={s.serviceDot}>·</Text>}
        </React.Fragment>
      ))}
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

      {/* ── Cover — constellation + centred hero ── */}
      <Page size="A4" style={s.cover}>
        <Constellation width={A4W} height={A4H} count={46} seed={7} />
        <GlowWash width={A4W} height={A4H} cx={455} cy={120} rx={280} ry={210} opacity={0.2} />
        <GlowWash width={A4W} height={A4H} cx={90} cy={730} rx={240} ry={190} opacity={0.12} />

        <View style={s.coverBar}>
          {LOGO_WHITE ? (
            <Image src={LOGO_WHITE} style={s.coverLogo} />
          ) : (
            <Text style={{ fontSize: 16, fontFamily: "Helvetica-Bold" }}>Centrefit Group</Text>
          )}
          <View style={s.coverMetaRight}>
            <Text style={s.coverRef}>{quote.ref}</Text>
            <Text style={s.coverDate}>{dateStr}</Text>
          </View>
        </View>

        <View style={{ flexGrow: 1 }} />

        <View style={s.coverCenter}>
          <Text style={s.coverKicker}>PROJECT PROPOSAL</Text>
          <Text style={s.coverTitle}>{quote.clientName}</Text>
          {!!siteName && <Text style={[s.coverTitle, s.coverTitleAccent]}>{siteName}</Text>}
          {!!siteAddress && <Text style={s.coverAddress}>{siteAddress}</Text>}
          <View style={s.coverRule} />
          <Text style={s.coverLead}>
            A complete technology fit-out — designed, installed, commissioned and supported by
            one team.
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
        </View>

        <View style={{ flexGrow: 1.3 }} />

        <View style={s.coverBottom}>
          <View style={s.coverBottomCol}>
            <Text style={s.coverBottomLabel}>REFERENCE</Text>
            <Text style={s.coverBottomValue}>{quote.ref}</Text>
          </View>
          <View style={s.coverBottomCol}>
            <Text style={s.coverBottomLabel}>DATE</Text>
            <Text style={s.coverBottomValue}>{dateStr}</Text>
          </View>
          <View style={s.coverBottomCol}>
            <Text style={s.coverBottomLabel}>PREPARED BY</Text>
            <Text style={s.coverBottomValue}>{COMPANY.legal}</Text>
            <Text style={s.coverBottomSub}>{COMPANY.abn}</Text>
          </View>
        </View>
        <Text style={s.coverContact}>
          {COMPANY.web}   ·   {COMPANY.phone}   ·   {COMPANY.email}   ·   {COMPANY.suburb}
        </Text>
      </Page>

      {/* ── Statement + stats + services ── */}
      <Page size="A4" style={s.page}>
        <Constellation width={A4W} height={A4H} count={34} seed={21} />
        <GlowWash width={A4W} height={A4H} cx={480} cy={640} rx={260} ry={220} opacity={0.14} />
        <InnerHeader refText={quote.ref} />

        <View style={s.statementWrap}>
          <Text style={s.statementLine}>One team.</Text>
          <Text style={[s.statementLine, s.statementGhost]}>End to end.</Text>
          <Text style={[s.statementLine, s.statementBlue]}>Around the clock.</Text>

          <View style={s.statBand}>
            {COMPANY.stats.map((st, i) => (
              <View key={i} style={s.statTile}>
                <Text style={s.statN}>{st.n}</Text>
                <Text style={s.statLabel}>{st.label}</Text>
              </View>
            ))}
          </View>

          <ServicesStrip />
        </View>
        <Footer />
      </Page>

      {/* ── Who we are ── */}
      <Page size="A4" style={s.page}>
        <Watermark n="01" />
        <GlowWash width={A4W} height={A4H} cx={470} cy={140} rx={250} ry={190} opacity={0.12} />
        <InnerHeader refText={quote.ref} />
        <Text style={s.kicker}>WHO WE ARE</Text>
        <Text style={s.h1}>Technology for spaces where people gather.</Text>
        {WHO_WE_ARE.map((p, i) => (
          <Text key={i} style={s.para}>{p}</Text>
        ))}

        <Text style={[s.kicker, { marginTop: 18 }]}>WHO WE&apos;VE BUILT FOR</Text>
        <View style={s.brandsRow}>
          {COMPANY.brands.map((b, i) => (
            <View key={i} style={s.brandCard}>
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
        <Watermark n="02" />
        <InnerHeader refText={quote.ref} />
        <Text style={s.kicker}>WHY CENTREFIT</Text>
        <Text style={s.h1}>What we do differently.</Text>
        {DIFFERENTIATORS.map((d, i) => (
          <View key={i} style={s.diffCard}>
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
        <Watermark n="03" />
        <InnerHeader refText={quote.ref} />
        <Text style={s.kicker}>AFTER THE INSTALL</Text>
        <Text style={s.h1}>Support that doesn&apos;t clock off.</Text>
        <Text style={s.para}>
          The installation is where most contractors finish. It&apos;s where we start — every
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
        <Footer />
      </Page>

      {/* ── NBN plans ── */}
      <Page size="A4" style={s.page}>
        <Watermark n="04" />
        <GlowWash width={A4W} height={A4H} cx={480} cy={110} rx={250} ry={180} opacity={0.14} />
        <InnerHeader refText={quote.ref} />
        <Text style={s.kicker}>CONNECTIVITY</Text>
        <Text style={s.h1}>Business internet, managed by us.</Text>
        <Text style={s.para}>
          We&apos;re an internet provider as well as an integrator — one team for the connection,
          the network and everything running on it. Every plan is business-grade NBN with no
          lock-in and no setup fee, supported in Australia by the people who built your site.
        </Text>

        <View style={{ marginTop: 4 }}>
          {NBN_PLANS.map((p, i) => (
            <View key={i} style={s.nbnRow}>
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
        <Text style={s.standardsLine}>
          ALL WORKS CARRIED OUT TO AUSTRALIAN STANDARDS   ·   {COMPANY.standards}
        </Text>
        <Footer />
      </Page>

      {/* ── Testimonials + Let's build it ── */}
      <Page size="A4" style={s.page}>
        <Watermark n="05" />
        <GlowWash width={A4W} height={A4H} cx={300} cy={700} rx={280} ry={200} opacity={0.15} />
        <InnerHeader refText={quote.ref} />
        <Text style={s.kicker}>WHAT OUR CLIENTS SAY</Text>
        <Text style={s.h1}>Don&apos;t take our word for it.</Text>
        <View style={s.tGrid}>
          {TESTIMONIALS.map((t, i) => (
            <View key={i} style={s.tCard}>
              <Text style={s.tMark}>{"“"}</Text>
              <Text style={s.tQuote}>{t.quote}</Text>
              <Text style={s.tWho}>— {t.who}</Text>
            </View>
          ))}
        </View>

        <View style={s.buildBand}>
          <Text style={s.buildKicker}>YOUR QUOTATION FOLLOWS</Text>
          <Text style={s.buildTitle}>Let&apos;s build it.</Text>
          <Text style={s.buildText}>
            The pages that follow set out the full scope of works and your investment
            for {siteLabel}. Questions at any point — call {COMPANY.phone} and talk directly
            to the team who&apos;ll build it.
          </Text>
        </View>
        <Footer />
      </Page>

      {/* ── The quote — clean white paper, unchanged ── */}
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
