/**
 * SWMS PDF renderer (Phase C). Mirrors the Rev 2.0 document structure:
 * cover/details page, risk assessment tables (landscape for column room),
 * risk matrix + legislation + competencies + emergency arrangements,
 * approval block, communication & sign-on register (staff signatures
 * auto-applied from their stored profiles — drawn once, per Mitchell's
 * call), sub-contractor table, equipment checklist.
 *
 * Generate → download only. No customer send flow (decision 2026-07-05).
 */

import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import fs from "fs";
import path from "path";
import {
  CF_COMPANY,
  RISK_ASSESSMENT_PREAMBLE,
  RISK_MATRIX_CL_LABELS,
  RISK_MATRIX_LL_LABELS,
  RISK_RATINGS,
  SWMS_APPROVAL_STATEMENT,
  SWMS_COMPETENCIES,
  SWMS_EQUIPMENT,
  SWMS_LEGISLATION,
  SWMS_MONITORING_REVIEW,
  SWMS_SIGNON_STATEMENT,
  SWMS_TEMPLATE_VERSION,
  SWMS_TITLE,
  riskRating,
  swmsEmergencyArrangements,
  type SwmsTaskGroup,
} from "@/lib/swms/spec";

const LOGO_BLUE_PATH = path.join(process.cwd(), "public", "centrefit-logo-blue.png");
const LOGO_BLUE_BUFFER: Buffer | null = (() => {
  try { return fs.readFileSync(LOGO_BLUE_PATH); } catch { return null; }
})();

export interface SwmsSignOnRow {
  name: string;
  role: string;
  signatureDataUrl: string | null;
  date: string; // display string
}

export interface SwmsSubcontractorRow {
  name: string;
  company: string;
  licences: string;
}

export interface SwmsData {
  clientName: string;
  clientAbn: string;
  clientAddress: string;
  clientKeyReps: string;
  workSiteName: string;
  workSiteAddress: string;
  proposedWorkDate: string;
  permitNumber: string;
  author: string;
  generatedDate: string; // display string
  taskGroups: SwmsTaskGroup[];
  nearestHospital: string;
  approver: { name: string; role: string; signatureDataUrl: string | null };
  signOn: SwmsSignOnRow[];
  subcontractors: SwmsSubcontractorRow[];
}

const INK = "#0f172a";
const MUTED = "#64748b";
const FAINT = "#94a3b8";
const LINE = "#e2e8f0";
const BRAND = "#1d4ed8";

const s = StyleSheet.create({
  page: {
    paddingTop: 84,
    paddingBottom: 58,
    paddingHorizontal: 40,
    fontSize: 8.5,
    color: INK,
    fontFamily: "Helvetica",
    lineHeight: 1.45,
  },
  header: {
    position: "absolute", top: 0, left: 0, right: 0,
    paddingTop: 24, paddingHorizontal: 40, paddingBottom: 10,
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end",
    borderBottomWidth: 2, borderBottomColor: INK,
  },
  headerLogo: { height: 28, width: 72, objectFit: "contain" },
  headerKicker: { fontSize: 7, color: FAINT, letterSpacing: 1.4, fontFamily: "Helvetica-Bold" },
  headerTitle: { fontSize: 9.5, fontFamily: "Helvetica-Bold", marginTop: 2 },
  footer: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: 40, paddingBottom: 22, paddingTop: 8,
    flexDirection: "row", justifyContent: "space-between",
    borderTopWidth: 0.75, borderTopColor: LINE,
  },
  footerText: { fontSize: 7, color: FAINT, lineHeight: 1.4 },

  kicker: { fontSize: 8, color: BRAND, fontFamily: "Helvetica-Bold", letterSpacing: 1.6, marginBottom: 6 },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold", letterSpacing: -0.2, lineHeight: 1.3 },
  sectionTitle: {
    fontSize: 10, fontFamily: "Helvetica-Bold", letterSpacing: 0.2,
    paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: INK, marginBottom: 8, marginTop: 16,
  },
  detailRow: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#f1f5f9" },
  detailLabel: { width: 165, fontSize: 8, color: MUTED, fontFamily: "Helvetica-Bold" },
  detailValue: { flex: 1, fontSize: 8.5 },

  // risk table (landscape)
  th: { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  riskHead: { flexDirection: "row", backgroundColor: INK, paddingVertical: 4, paddingHorizontal: 4 },
  riskRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 4, paddingHorizontal: 4 },
  groupBand: {
    backgroundColor: "#eff6ff", borderLeftWidth: 3, borderLeftColor: BRAND,
    paddingVertical: 5, paddingHorizontal: 8, marginTop: 10, marginBottom: 2,
  },
  cellText: { fontSize: 7.5, lineHeight: 1.4 },
  bullet: { fontSize: 7.5, lineHeight: 1.4 },
  riskBadge: { fontSize: 8, fontFamily: "Helvetica-Bold", textAlign: "center" },

  smallText: { fontSize: 7.5, color: MUTED, lineHeight: 1.5 },
  listItem: { fontSize: 8, lineHeight: 1.55 },

  sigCell: { height: 34, justifyContent: "flex-end" },
  sigImg: { height: 30, objectFit: "contain", objectPositionX: 0 },
  tableLine: { borderBottomWidth: 0.5, borderBottomColor: LINE },
});

function Chrome({ data }: { data: SwmsData }) {
  return (
    <>
      <View style={s.header} fixed>
        {LOGO_BLUE_BUFFER ? (
          <Image src={{ data: LOGO_BLUE_BUFFER, format: "png" }} style={s.headerLogo} />
        ) : (
          <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold" }}>Centrefit Group</Text>
        )}
        <View style={{ textAlign: "right" }}>
          <Text style={s.headerKicker}>SAFE WORK METHOD STATEMENT · {SWMS_TEMPLATE_VERSION}</Text>
          <Text style={s.headerTitle}>{data.workSiteName}</Text>
        </View>
      </View>
      <View style={s.footer} fixed>
        <Text style={s.footerText}>
          Safe Work Method Statement — {data.workSiteName}  |  {CF_COMPANY.name} · Permit {data.permitNumber}
        </Text>
        <Text
          style={[s.footerText, { textAlign: "right" }]}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </View>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue}>{value || "—"}</Text>
    </View>
  );
}

const RISK_COLOURS: Record<string, string> = {
  Low: "#15803d",
  Medium: "#b45309",
  High: "#b91c1c",
  Extreme: "#7f1d1d",
};

export async function generateSwmsPdfBuffer(data: SwmsData): Promise<Buffer> {
  const doc = (
    <Document title={`SWMS — ${data.workSiteName} — ${SWMS_TITLE}`} author={CF_COMPANY.name}>
      {/* ── Details page (portrait) ─────────────────────────────────────── */}
      <Page size="A4" style={s.page}>
        <Chrome data={data} />
        <Text style={s.kicker}>OCCUPATIONAL HEALTH AND SAFETY</Text>
        <Text style={s.h1}>Safe Work Method Statement —{"\n"}{SWMS_TITLE}</Text>
        <Text style={{ fontSize: 9, color: MUTED, marginTop: 6 }}>
          Working for and on behalf of: {data.clientName}
        </Text>

        <Text style={s.sectionTitle}>Principal Contractor / PCBU with Management or Control of Workplace (Client)</Text>
        <DetailRow label="Company Name" value={data.clientName} />
        <DetailRow label="Company ABN Number" value={data.clientAbn} />
        <DetailRow label="Company Address" value={data.clientAddress} />
        <DetailRow label="Name of Key Representative" value={data.clientKeyReps} />

        <Text style={s.sectionTitle}>Contractor Performing the Work</Text>
        <DetailRow label="Company Name" value={CF_COMPANY.name} />
        <DetailRow label="Company ACN Number" value={CF_COMPANY.acn} />
        <DetailRow label="Company Address" value={CF_COMPANY.address} />
        <DetailRow label="Company Email Address" value={CF_COMPANY.email} />
        <DetailRow label="Name of Key Representative" value={data.approver.name} />

        <Text style={s.sectionTitle}>Safe Work Method Statement Details</Text>
        <DetailRow label="Work Site" value={data.workSiteName} />
        <DetailRow label="Work Site Address" value={data.workSiteAddress} />
        <DetailRow label="Work Activity Title" value={SWMS_TITLE} />
        <DetailRow label="Proposed Work Date" value={data.proposedWorkDate} />
        <DetailRow label="SWMS Author" value={data.author} />
        <DetailRow label="Related Permit to Work Number" value={data.permitNumber} />
        <DetailRow label="Related Work Approval Number" value="Not applicable" />
        <DetailRow label="SWMS Version / Date" value={`${SWMS_TEMPLATE_VERSION} — ${data.generatedDate}`} />
      </Page>

      {/* ── Risk assessment (landscape) ─────────────────────────────────── */}
      <Page size="A4" orientation="landscape" style={s.page}>
        <Chrome data={data} />
        <Text style={s.kicker}>OCCUPATIONAL HEALTH AND SAFETY</Text>
        <Text style={[s.h1, { fontSize: 13 }]}>Risk Assessment — Tasks, Hazards &amp; Controls</Text>
        <Text style={[s.smallText, { marginTop: 4, marginBottom: 8 }]}>{RISK_ASSESSMENT_PREAMBLE}</Text>

        <View style={s.riskHead} fixed>
          <Text style={[s.th, { width: 26 }]}>NO.</Text>
          <Text style={[s.th, { width: 150 }]}>TASKS (IN SEQUENCE)</Text>
          <Text style={[s.th, { width: 140 }]}>HAZARDS</Text>
          <Text style={[s.th, { flex: 1 }]}>CONTROLS (HIERARCHY OF CONTROLS)</Text>
          <Text style={[s.th, { width: 90 }]}>RESPONSIBLE</Text>
          <Text style={[s.th, { width: 22, textAlign: "center" }]}>LL</Text>
          <Text style={[s.th, { width: 22, textAlign: "center" }]}>CL</Text>
          <Text style={[s.th, { width: 44, textAlign: "center" }]}>RISK</Text>
        </View>

        {data.taskGroups.map((group, gi) => (
          <View key={group.key}>
            <View style={s.groupBand} wrap={false}>
              <Text style={{ fontSize: 8.5, fontFamily: "Helvetica-Bold" }}>
                {gi + 1}.  {group.title}
              </Text>
              <Text style={{ fontSize: 7.5, color: MUTED }}>{group.description}</Text>
            </View>
            {group.hazards.map((h, hi) => {
              const score = h.ll * h.cl;
              const rating = riskRating(score);
              return (
                <View key={hi} style={s.riskRow} wrap={false}>
                  <Text style={[s.cellText, { width: 26, color: FAINT }]}>{gi + 1}.{hi + 1}</Text>
                  <Text style={[s.cellText, { width: 150, color: MUTED }]}>
                    {hi === 0 ? group.title : ""}
                  </Text>
                  <Text style={[s.cellText, { width: 140, paddingRight: 6 }]}>{h.hazard}</Text>
                  <View style={{ flex: 1, paddingRight: 6 }}>
                    {h.controls.map((c, ci) => (
                      <Text key={ci} style={s.bullet}>•  {c}</Text>
                    ))}
                  </View>
                  <Text style={[s.cellText, { width: 90, paddingRight: 4 }]}>{h.responsible}</Text>
                  <Text style={[s.cellText, { width: 22, textAlign: "center" }]}>{h.ll}</Text>
                  <Text style={[s.cellText, { width: 22, textAlign: "center" }]}>{h.cl}</Text>
                  <Text style={[s.riskBadge, { width: 44, color: RISK_COLOURS[rating] }]}>
                    {score}{"\n"}<Text style={{ fontSize: 6.5 }}>{rating}</Text>
                  </Text>
                </View>
              );
            })}
          </View>
        ))}
        <Text style={[s.smallText, { marginTop: 6 }]}>
          LL = Likelihood Level    CL = Consequence Level    Risk = Residual Risk Level (LL × CL)
        </Text>
      </Page>

      {/* ── Matrix, legislation, competencies, emergency (portrait) ───────── */}
      <Page size="A4" style={s.page}>
        <Chrome data={data} />
        <Text style={s.sectionTitle}>Risk Matrix</Text>
        <View style={{ flexDirection: "row", backgroundColor: INK, paddingVertical: 3 }}>
          <Text style={[s.th, { width: 110, paddingLeft: 4 }]}>LL ↓   CL →</Text>
          {RISK_MATRIX_CL_LABELS.map((label, i) => (
            <Text key={label} style={[s.th, { flex: 1, textAlign: "center" }]}>{i + 1} {label}</Text>
          ))}
        </View>
        {[...RISK_MATRIX_LL_LABELS].reverse().map((llLabel, idx) => {
          const ll = 5 - idx;
          return (
            <View key={ll} style={[s.tableLine, { flexDirection: "row", paddingVertical: 3 }]}>
              <Text style={{ width: 110, fontSize: 8, fontFamily: "Helvetica-Bold", paddingLeft: 4 }}>
                {ll} {llLabel}
              </Text>
              {[1, 2, 3, 4, 5].map((cl) => {
                const score = ll * cl;
                return (
                  <Text key={cl} style={{ flex: 1, textAlign: "center", fontSize: 8.5, fontFamily: "Helvetica-Bold", color: RISK_COLOURS[riskRating(score)] }}>
                    {score}
                  </Text>
                );
              })}
            </View>
          );
        })}
        <View style={{ marginTop: 8 }}>
          {RISK_RATINGS.map((r) => (
            <View key={r.rating} style={[s.tableLine, { flexDirection: "row", paddingVertical: 3 }]}>
              <Text style={{ width: 60, fontSize: 8, fontFamily: "Helvetica-Bold" }}>{r.range}</Text>
              <Text style={{ width: 70, fontSize: 8, fontFamily: "Helvetica-Bold", color: RISK_COLOURS[r.rating] }}>{r.rating}</Text>
              <Text style={{ flex: 1, fontSize: 8 }}>{r.action}</Text>
            </View>
          ))}
        </View>

        <Text style={s.sectionTitle}>Applicable Legislation, Codes &amp; Competencies</Text>
        <Text style={[s.smallText, { marginBottom: 4 }]}>
          All activities above have been developed and are managed under the following current Queensland
          legislation and approved codes of practice:
        </Text>
        {SWMS_LEGISLATION.map((l) => (
          <Text key={l} style={s.listItem}>•  {l}</Text>
        ))}
        <Text style={[s.smallText, { marginTop: 8, marginBottom: 4 }]}>
          Competencies &amp; licensing held by personnel performing the work:
        </Text>
        {SWMS_COMPETENCIES.map((c) => (
          <Text key={c} style={s.listItem}>•  {c}</Text>
        ))}

        <Text style={s.sectionTitle}>Emergency Arrangements</Text>
        {swmsEmergencyArrangements(data.workSiteAddress, data.nearestHospital).map((e, i) => (
          <Text key={i} style={s.listItem}>•  {e}</Text>
        ))}

        <Text style={s.sectionTitle}>Monitoring, Review &amp; Approval</Text>
        <Text style={[s.smallText, { marginBottom: 8 }]}>{SWMS_MONITORING_REVIEW}</Text>
        <View wrap={false}>
          <Text style={{ fontSize: 8.5, fontFamily: "Helvetica-Bold" }}>
            Approved by: {data.approver.name} — {data.approver.role}, {CF_COMPANY.name}
          </Text>
          <Text style={[s.smallText, { marginTop: 3 }]}>{SWMS_APPROVAL_STATEMENT}</Text>
          <View style={{ flexDirection: "row", marginTop: 8, alignItems: "flex-end" }}>
            <View style={{ width: 200 }}>
              {data.approver.signatureDataUrl ? (
                <Image src={data.approver.signatureDataUrl} style={s.sigImg} />
              ) : (
                <View style={{ height: 30 }} />
              )}
              <View style={{ borderTopWidth: 0.75, borderTopColor: INK, marginTop: 3, paddingTop: 2 }}>
                <Text style={{ fontSize: 7, color: MUTED, fontFamily: "Helvetica-Bold" }}>SIGNATURE</Text>
              </View>
            </View>
            <Text style={{ marginLeft: 24, fontSize: 8.5 }}>Date: {data.generatedDate}</Text>
          </View>
        </View>
      </Page>

      {/* ── Sign-on + subcontractors + equipment (portrait) ───────────────── */}
      <Page size="A4" style={s.page}>
        <Chrome data={data} />
        <Text style={s.kicker}>OCCUPATIONAL HEALTH AND SAFETY</Text>
        <Text style={[s.h1, { fontSize: 13 }]}>SWMS Communication &amp; Sign-On</Text>
        <Text style={[s.smallText, { marginTop: 4, marginBottom: 8 }]}>{SWMS_SIGNON_STATEMENT}</Text>

        <View style={[s.riskHead]}>
          <Text style={[s.th, { flex: 1 }]}>NAME &amp; ROLE</Text>
          <Text style={[s.th, { width: 170 }]}>SIGNATURE</Text>
          <Text style={[s.th, { width: 70 }]}>DATE</Text>
        </View>
        {data.signOn.map((row, i) => (
          <View key={i} style={[s.riskRow, { alignItems: "flex-end" }]} wrap={false}>
            <Text style={[s.cellText, { flex: 1, fontSize: 8.5 }]}>
              {row.name}{row.role ? ` — ${row.role}` : ""}
            </Text>
            <View style={[s.sigCell, { width: 170 }]}>
              {row.signatureDataUrl ? (
                <Image src={row.signatureDataUrl} style={s.sigImg} />
              ) : (
                <Text style={{ fontSize: 7, color: FAINT }}>(to sign on day of briefing)</Text>
              )}
            </View>
            <Text style={[s.cellText, { width: 70 }]}>{row.date}</Text>
          </View>
        ))}
        {/* blank rows for on-the-day additions */}
        {[0, 1, 2].map((i) => (
          <View key={`blank-${i}`} style={[s.riskRow, { height: 30 }]} />
        ))}

        <Text style={s.sectionTitle}>Approved Sub-Contractor Personnel</Text>
        <Text style={[s.smallText, { marginBottom: 6 }]}>
          Complete for any sub-contracted labour engaged on these works.
        </Text>
        <View style={s.riskHead}>
          <Text style={[s.th, { flex: 1 }]}>NAME (FIRST &amp; LAST)</Text>
          <Text style={[s.th, { width: 130 }]}>COMPANY</Text>
          <Text style={[s.th, { width: 190 }]}>QUALIFICATIONS / LICENCES</Text>
          <Text style={[s.th, { width: 55 }]}>DATE</Text>
        </View>
        {data.subcontractors.map((row, i) => (
          <View key={i} style={s.riskRow} wrap={false}>
            <Text style={[s.cellText, { flex: 1, fontSize: 8.5 }]}>{row.name}</Text>
            <Text style={[s.cellText, { width: 130 }]}>{row.company}</Text>
            <Text style={[s.cellText, { width: 190 }]}>{row.licences}</Text>
            <Text style={[s.cellText, { width: 55 }]} />
          </View>
        ))}
        {[0, 1, 2].map((i) => (
          <View key={`sub-blank-${i}`} style={[s.riskRow, { height: 26 }]} />
        ))}

        <Text style={s.sectionTitle}>Equipment That Will Be Required for These Works</Text>
        {SWMS_EQUIPMENT.map((e) => (
          <View key={e} style={[s.tableLine, { flexDirection: "row", paddingVertical: 3.5 }]}>
            <Text style={{ flex: 1, fontSize: 8.5 }}>{e}</Text>
            <Text style={{ width: 40, fontSize: 8.5, fontFamily: "Helvetica-Bold", color: "#15803d", textAlign: "center" }}>✓</Text>
          </View>
        ))}
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}
