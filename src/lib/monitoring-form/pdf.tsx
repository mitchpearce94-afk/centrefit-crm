/**
 * Security Monitoring Response Instructions — signed PDF renderer.
 *
 * @react-pdf (same no-Chromium approach as quote-pdf.tsx). Renders the
 * customer's signed instructions as the branded document of record: client
 * details, call list, iFob users, opening hours, the SELECTED response for
 * each alarm category, fees, liability schedule, the on-glass signature and
 * the e-sign audit block (one signature + section-view log replaces per-page
 * initialling — Mitchell-approved model, documentation-CONTEXT.md Phase B).
 * The CF-use-only zone/area schedule prints on the final page, as on the
 * paper form.
 *
 * PIN handling: this PDF (stored in the private site-documents bucket) is
 * the full-fidelity record — new/changed PINs print in full for the control
 * room, unchanged re-issue PINs stay masked. The site profile in Postgres
 * only ever stores masked PINs.
 */

import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import fs from "fs";
import path from "path";
import {
  ANNUAL_SERVICING_TEXT,
  AUTHORISATION_TEXT,
  CF_ABN,
  CF_ADDRESS,
  CF_ASIAL_MEMBERSHIP,
  CF_CONTROL_ROOM_PHONE,
  CF_SECURITY_LICENCE,
  CF_SERVICE_PHONE,
  CF_SUPPORT_EMAIL,
  DAY_LABELS,
  FORM_SECTIONS,
  LIABILITY_CLAUSES,
  OPTION_GROUPS,
  SIM_SUPPLY_INTRO,
  TEMPLATE_VERSION,
  WEEK_DAYS,
  calcFeeTotals,
  fmtAud,
  type MonitoringFormData,
  type MonitoringPrefill,
} from "@/lib/monitoring-form/spec";

const LOGO_BLUE_PATH = path.join(process.cwd(), "public", "centrefit-logo-blue.png");
const LOGO_BLUE_BUFFER: Buffer | null = (() => {
  try { return fs.readFileSync(LOGO_BLUE_PATH); } catch { return null; }
})();

export interface MonitoringPdfInput {
  prefill: MonitoringPrefill;
  formData: MonitoringFormData;
  signerName: string;
  signerPosition: string;
  signatureDataUrl: string;
  recipientEmail: string;
  requestId: string;
  sentAt: string | null;
  viewedAt: string | null;
  signedAt: string;
  signerIp: string;
  signerUserAgent: string | null;
}

function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-AU", {
    timeZone: "Australia/Brisbane",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }) + " AEST";
}

const BRAND = "#1d4ed8";
const INK = "#0f172a";
const MUTED = "#64748b";
const FAINT = "#94a3b8";
const LINE = "#e2e8f0";

const s = StyleSheet.create({
  page: {
    paddingTop: 92,
    paddingBottom: 64,
    paddingHorizontal: 42,
    fontSize: 9,
    color: INK,
    fontFamily: "Helvetica",
    lineHeight: 1.5,
  },
  // Fixed chrome
  header: {
    position: "absolute", top: 0, left: 0, right: 0,
    paddingTop: 26, paddingHorizontal: 42, paddingBottom: 12,
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end",
    borderBottomWidth: 2, borderBottomColor: INK,
  },
  headerLogo: { height: 32, width: 82, objectFit: "contain" },
  headerRight: { textAlign: "right" },
  headerKicker: { fontSize: 7.5, color: FAINT, letterSpacing: 1.4, fontFamily: "Helvetica-Bold" },
  headerTitle: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginTop: 2 },
  footer: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: 42, paddingBottom: 26, paddingTop: 10,
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
    borderTopWidth: 0.75, borderTopColor: LINE,
  },
  footerText: { fontSize: 7, color: FAINT, lineHeight: 1.4 },

  // Title block
  h1: { fontSize: 17, fontFamily: "Helvetica-Bold", letterSpacing: -0.3, lineHeight: 1.25 },
  subKicker: { fontSize: 8, color: BRAND, fontFamily: "Helvetica-Bold", letterSpacing: 1.6, marginBottom: 6 },
  intro: { fontSize: 8, color: MUTED, marginTop: 8, lineHeight: 1.55 },

  // Sections
  section: { marginTop: 18 },
  sectionTitle: {
    fontSize: 10.5, fontFamily: "Helvetica-Bold", letterSpacing: 0.2,
    paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: INK, marginBottom: 8,
  },
  sectionIntro: { fontSize: 8, color: MUTED, marginBottom: 8, lineHeight: 1.5 },

  // Detail grid
  detailRow: { flexDirection: "row", paddingVertical: 3.5, borderBottomWidth: 0.5, borderBottomColor: "#f1f5f9" },
  detailLabel: { width: 130, fontSize: 8, color: MUTED, fontFamily: "Helvetica-Bold" },
  detailValue: { flex: 1, fontSize: 9 },

  // Tables
  th: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: MUTED, letterSpacing: 0.4 },
  tableHead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 3, marginBottom: 2 },
  tr: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#f1f5f9" },

  // Selected option card
  optionCard: {
    borderWidth: 1.25, borderColor: BRAND, borderRadius: 6,
    backgroundColor: "#eff6ff", padding: 10, marginTop: 2,
  },
  optionBadgeRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  optionBadge: {
    fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#ffffff",
    backgroundColor: BRAND, borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2, marginRight: 6,
  },
  optionLabel: { fontSize: 9.5, fontFamily: "Helvetica-Bold" },
  optionLine: { fontSize: 8.5, color: "#334155", lineHeight: 1.5 },
  naCard: {
    borderWidth: 0.75, borderColor: LINE, borderRadius: 6,
    backgroundColor: "#f8fafc", padding: 10, marginTop: 2,
  },
  warning: {
    marginTop: 6, backgroundColor: "#fffbeb", borderWidth: 0.75, borderColor: "#fde68a",
    borderRadius: 5, padding: 8, fontSize: 7.5, color: "#92400e", lineHeight: 1.45,
  },

  smallText: { fontSize: 7.5, color: MUTED, lineHeight: 1.5 },

  // Audit block
  auditBox: { marginTop: 14, borderWidth: 1, borderColor: INK, borderRadius: 6, padding: 12 },
  auditTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", letterSpacing: 1, marginBottom: 6 },
  auditRow: { flexDirection: "row", paddingVertical: 2 },
  auditLabel: { width: 120, fontSize: 7.5, color: MUTED, fontFamily: "Helvetica-Bold" },
  auditValue: { flex: 1, fontSize: 7.5 },
});

function Chrome({ prefill }: { prefill: MonitoringPrefill }) {
  return (
    <>
      <View style={s.header} fixed>
        {LOGO_BLUE_BUFFER ? (
          <Image src={{ data: LOGO_BLUE_BUFFER, format: "png" }} style={s.headerLogo} />
        ) : (
          <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold" }}>Centrefit Group</Text>
        )}
        <View style={s.headerRight}>
          <Text style={s.headerKicker}>SECURITY MONITORING RESPONSE INSTRUCTIONS</Text>
          <Text style={s.headerTitle}>{prefill.siteName} · Version {prefill.docVersion}</Text>
        </View>
      </View>
      <View style={s.footer} fixed>
        <Text style={s.footerText}>
          Centrefit Group Pty Ltd · ABN {CF_ABN} · {CF_ADDRESS}{"\n"}
          Security Licence {CF_SECURITY_LICENCE} · ASIAL Membership {CF_ASIAL_MEMBERSHIP} · Control Room 24/7 {CF_CONTROL_ROOM_PHONE}
        </Text>
        <Text
          style={[s.footerText, { textAlign: "right" }]}
          render={({ pageNumber, totalPages }) =>
            `${TEMPLATE_VERSION} · Signed electronically\nPage ${pageNumber} of ${totalPages}`
          }
        />
      </View>
    </>
  );
}

function Section({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {intro ? <Text style={s.sectionIntro}>{intro}</Text> : null}
      {children}
    </View>
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

export async function generateMonitoringFormPdfBuffer(input: MonitoringPdfInput): Promise<Buffer> {
  const { prefill, formData } = input;
  const { details, selections } = formData;
  const totals = calcFeeTotals(selections, formData.ifobUsers, prefill.fees);

  const callRows = formData.callList.filter((r) => r.name.trim() || r.phone.trim());
  const ifobRows = formData.ifobUsers.filter((r) => r.name.trim());
  const sectionTimes = FORM_SECTIONS.map((sec) => ({
    title: sec.title,
    at: formData.sectionsViewed[sec.key] ?? null,
  }));

  const doc = (
    <Document
      title={`Security Monitoring Response Instructions v${prefill.docVersion} — ${prefill.siteName}`}
      author="Centrefit Group Pty Ltd"
    >
      <Page size="A4" style={s.page}>
        <Chrome prefill={prefill} />

        <Text style={s.subKicker}>COMMERCIAL CLIENTS · {TEMPLATE_VERSION}</Text>
        <Text style={s.h1}>Client Information &amp; Security Monitoring{"\n"}Response Instructions</Text>
        <Text style={s.intro}>
          This document records the client&apos;s specific instructions detailing the response required to the
          various alarm signals and communications the associated electronic security system is capable of
          sending. All additional costs associated with the actioning of these alarms, such as the dispatch
          of a patrol officer, remain the sole responsibility of the client. If the details on this form
          change at any time, the client must immediately notify Centrefit Group in writing — call
          {" "}{CF_SERVICE_PHONE} or email {CF_SUPPORT_EMAIL} and a fresh form will be issued.
        </Text>

        <Section title="Client Details">
          <DetailRow label="Client / Entity Name" value={details.clientName} />
          <DetailRow label="Billing Contact" value={details.billingContactName} />
          <DetailRow label="ABN" value={details.abn} />
          <DetailRow label="Facility Name" value={details.facilityName} />
          <DetailRow label="Facility Address" value={details.facilityAddress} />
          <DetailRow label="Facility Phone" value={details.facilityPhone} />
          <DetailRow label="Billing Address" value={details.billingAddress} />
          <DetailRow label="Nearest Cross Street" value={details.nearestCrossStreet} />
          <DetailRow label="Email" value={details.email} />
          <DetailRow label="New Client" value={details.newClient ? "Yes" : "No"} />
          <DetailRow
            label="Commencement Date"
            value={details.commencementDate ? new Date(details.commencementDate).toLocaleDateString("en-AU") : ""}
          />
        </Section>

        <Section
          title="Alarm Response Call List"
          intro="Call list recipients MUST be prepared to answer their mobiles after hours. Called in the order listed."
        >
          <View style={s.tableHead}>
            <Text style={[s.th, { width: 24 }]}>#</Text>
            <Text style={[s.th, { flex: 1 }]}>NAME</Text>
            <Text style={[s.th, { width: 140 }]}>PHONE NUMBER</Text>
          </View>
          {callRows.length === 0 ? (
            <Text style={s.smallText}>No call list contacts provided.</Text>
          ) : (
            callRows.map((r, i) => (
              <View key={i} style={s.tr}>
                <Text style={{ width: 24, color: FAINT }}>{i + 1}</Text>
                <Text style={{ flex: 1 }}>{r.name}</Text>
                <Text style={{ width: 140 }}>{r.phone}</Text>
              </View>
            ))
          )}
        </Section>

        <Section
          title="iFob App Access"
          intro="Users identified by unique 4-digit PIN. PINs shown as ***X were already held on file and are unchanged."
        >
          <View style={s.tableHead}>
            <Text style={[s.th, { width: 24 }]}>#</Text>
            <Text style={[s.th, { flex: 1 }]}>USER FULL NAME</Text>
            <Text style={[s.th, { width: 70 }]}>UNIQUE PIN</Text>
            <Text style={[s.th, { width: 70 }]}>APP ACCESS</Text>
          </View>
          {ifobRows.length === 0 ? (
            <Text style={s.smallText}>No iFob users provided.</Text>
          ) : (
            ifobRows.map((r, i) => (
              <View key={i} style={s.tr}>
                <Text style={{ width: 24, color: FAINT }}>{i + 1}</Text>
                <Text style={{ flex: 1 }}>{r.name}</Text>
                <Text style={{ width: 70 }}>{r.pin || "—"}</Text>
                <Text style={{ width: 70 }}>{r.app_access ? "Yes" : "No"}</Text>
              </View>
            ))
          )}
        </Section>

        <Section
          title="Hours of Earliest Opening & Latest Closing"
          intro="All after hours openings are challenged after 15 minutes of disarming the alarm."
        >
          <View style={s.tableHead}>
            <Text style={[s.th, { width: 90 }]}>TIME SCHEDULE</Text>
            {WEEK_DAYS.map((d) => (
              <Text key={d} style={[s.th, { flex: 1, textAlign: "center" }]}>{DAY_LABELS[d].toUpperCase()}</Text>
            ))}
          </View>
          {details.facility247 ? (
            <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: BRAND, marginTop: 4 }}>
              24/7 FACILITY — no opening hours schedule applies.
            </Text>
          ) : (
            <>
              {([
                { label: "Opening Time", field: "open" as const },
                { label: "Closing Time", field: "close" as const },
                { label: "Cleaner Times", field: "cleaner" as const },
                { label: "24 Hour Facility", field: "h24" as const },
              ]).map((rowDef) => (
                <View key={rowDef.field} style={s.tr}>
                  <Text style={{ width: 90, fontFamily: "Helvetica-Bold", fontSize: 8 }}>{rowDef.label}</Text>
                  {WEEK_DAYS.map((d) => {
                    const day = formData.openingHours[d];
                    const raw = rowDef.field === "h24" ? (day?.h24 ? "Yes" : "") : day?.[rowDef.field] ?? "";
                    return (
                      <Text key={d} style={{ flex: 1, textAlign: "center", fontSize: 8 }}>
                        {day?.h24 && rowDef.field !== "h24" ? "24hr" : raw || "—"}
                      </Text>
                    );
                  })}
                </View>
              ))}
            </>
          )}
        </Section>

        {/* Response instructions — the SELECTED option per category */}
        {OPTION_GROUPS.map((group) => {
          const selected = selections[group.key];
          const notApplicable = group.optional247 && details.facility247;
          const opt = group.options.find((o) => o.value === selected);
          return (
            <Section key={group.key} title={group.title} intro={group.intro}>
              {notApplicable ? (
                <View style={s.naCard}>
                  <Text style={{ fontSize: 8.5, color: MUTED, fontFamily: "Helvetica-Bold" }}>
                    Not applicable — this facility operates 24/7.
                  </Text>
                </View>
              ) : opt ? (
                <View style={s.optionCard} wrap={false}>
                  <View style={s.optionBadgeRow}>
                    <Text style={s.optionBadge}>SELECTED</Text>
                    <Text style={s.optionLabel}>{opt.label}</Text>
                  </View>
                  {opt.lines.map((line, i) => (
                    <Text key={i} style={s.optionLine}>•  {line}</Text>
                  ))}
                  {group.key === "vav" && opt.value !== "C3" && prefill.fees.vav ? (
                    <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold", color: BRAND, marginTop: 4 }}>
                      VAV subscription ${fmtAud(prefill.fees.vav.priceExGst)} ex GST
                      (${fmtAud(prefill.fees.vav.priceIncGst)} inc) per month applies.
                    </Text>
                  ) : null}
                </View>
              ) : (
                <View style={s.naCard}>
                  <Text style={{ fontSize: 8.5, color: MUTED }}>No option selected.</Text>
                </View>
              )}
              {group.warning && !notApplicable ? <Text style={s.warning}>{group.warning}</Text> : null}

              {/* SIM supply block sits after Hold Up, matching the paper form order */}
              {group.key === "holdup" ? (
                <View style={{ marginTop: 14 }}>
                  <Text style={[s.sectionTitle, { fontSize: 9.5 }]}>Duress Intercom SIM Card</Text>
                  <Text style={s.sectionIntro}>{SIM_SUPPLY_INTRO}</Text>
                  <View style={s.optionCard} wrap={false}>
                    <View style={s.optionBadgeRow}>
                      <Text style={s.optionBadge}>SELECTED</Text>
                      <Text style={s.optionLabel}>
                        {selections.sim_supply === "centrefit"
                          ? "Centrefit to supply SIM card"
                          : selections.sim_supply === "client"
                            ? "Client will purchase SIM card"
                            : "No option selected"}
                      </Text>
                    </View>
                    {selections.sim_supply === "centrefit" && prefill.fees.sim ? (
                      <Text style={s.optionLine}>
                        Supplied at ${fmtAud(prefill.fees.sim.priceExGst)} ex GST
                        (${fmtAud(prefill.fees.sim.priceIncGst)} inc) per month.
                      </Text>
                    ) : null}
                    {selections.sim_supply === "client" ? (
                      <Text style={s.optionLine}>SIM card phone number: {details.simPhone || "—"}</Text>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </Section>
          );
        })}

        <Section title="Fees & Ongoing Costs" intro="Based on the options selected in this document. Prices from the Centrefit services catalogue at time of issue.">
          {totals.lines.map((line) => (
            <View key={line.fee.code} style={s.tr}>
              <Text style={{ flex: 1 }}>{line.label}</Text>
              <Text style={{ width: 220, textAlign: "right", fontFamily: "Helvetica-Bold" }}>
                ${fmtAud(line.fee.priceExGst)} ex GST (${fmtAud(line.fee.priceIncGst)} inc) / {line.fee.frequency === "monthly" ? "month" : "year"}
              </Text>
            </View>
          ))}
          <View style={[s.tr, { borderBottomWidth: 0, marginTop: 4 }]}>
            <Text style={{ flex: 1, fontFamily: "Helvetica-Bold", fontSize: 10 }}>Monthly total</Text>
            <Text style={{ width: 220, textAlign: "right", fontFamily: "Helvetica-Bold", fontSize: 10 }}>
              ${fmtAud(totals.monthlyExGst)} ex GST (${fmtAud(totals.monthlyIncGst)} inc)
            </Text>
          </View>
          {totals.yearlyExGst > 0 ? (
            <View style={[s.tr, { borderBottomWidth: 0 }]}>
              <Text style={{ flex: 1, fontFamily: "Helvetica-Bold" }}>Plus annually</Text>
              <Text style={{ width: 220, textAlign: "right", fontFamily: "Helvetica-Bold" }}>
                ${fmtAud(totals.yearlyExGst)} ex GST (${fmtAud(totals.yearlyIncGst)} inc)
              </Text>
            </View>
          ) : null}
          {prefill.fees.nbn ? (
            <Text style={[s.smallText, { marginTop: 6 }]}>
              An internet service is required prior to system installation. Client-supplied, or Centrefit
              Communications can supply a business NBN plan ({prefill.fees.nbn.name}) at
              ${fmtAud(prefill.fees.nbn.priceExGst)} ex GST (${fmtAud(prefill.fees.nbn.priceIncGst)} inc)/month ongoing — Bronze SLA remote support and VPN access included.
            </Text>
          ) : null}
        </Section>

        <Section title="Annual Servicing of Security System">
          <Text style={s.smallText}>{ANNUAL_SERVICING_TEXT}</Text>
        </Section>

        <Section title="Liability Exclusion Schedule">
          {LIABILITY_CLAUSES.map((clause, i) => (
            <Text key={i} style={[s.smallText, { marginBottom: 5 }]}>
              {i + 1}.  {clause}
            </Text>
          ))}
        </Section>

        {/* Authorisation + signature */}
        <View style={s.section} wrap={false}>
          <Text style={s.sectionTitle}>Authorisation</Text>
          <Text style={{ fontSize: 8.5, fontFamily: "Helvetica-Bold", color: "#334155", lineHeight: 1.55 }}>
            {AUTHORISATION_TEXT}
          </Text>
          <View style={{ flexDirection: "row", marginTop: 14, alignItems: "flex-end" }}>
            <View style={{ width: 220 }}>
              <Image src={input.signatureDataUrl} style={{ height: 56, objectFit: "contain", objectPositionX: 0 }} />
              <View style={{ borderTopWidth: 0.75, borderTopColor: INK, marginTop: 4, paddingTop: 3 }}>
                <Text style={{ fontSize: 7.5, color: MUTED, fontFamily: "Helvetica-Bold" }}>SIGNED</Text>
              </View>
            </View>
            <View style={{ flex: 1, paddingLeft: 24 }}>
              <DetailRow label="Print Name" value={input.signerName} />
              <DetailRow label="Position" value={input.signerPosition} />
              <DetailRow label="Date" value={fmtStamp(input.signedAt)} />
            </View>
          </View>

          {/* E-sign audit block */}
          <View style={s.auditBox}>
            <Text style={s.auditTitle}>ELECTRONIC SIGNATURE AUDIT TRAIL</Text>
            <View style={s.auditRow}><Text style={s.auditLabel}>Document</Text><Text style={s.auditValue}>Security Monitoring Response Instructions · Version {prefill.docVersion} · Template {TEMPLATE_VERSION}</Text></View>
            <View style={s.auditRow}><Text style={s.auditLabel}>Reference</Text><Text style={s.auditValue}>{input.requestId}</Text></View>
            <View style={s.auditRow}><Text style={s.auditLabel}>Issued to</Text><Text style={s.auditValue}>{input.recipientEmail}</Text></View>
            <View style={s.auditRow}><Text style={s.auditLabel}>Issued</Text><Text style={s.auditValue}>{fmtStamp(input.sentAt)}</Text></View>
            <View style={s.auditRow}><Text style={s.auditLabel}>First opened</Text><Text style={s.auditValue}>{fmtStamp(input.viewedAt)}</Text></View>
            <View style={s.auditRow}><Text style={s.auditLabel}>Signed</Text><Text style={s.auditValue}>{fmtStamp(input.signedAt)} by {input.signerName} ({input.signerPosition})</Text></View>
            <View style={s.auditRow}><Text style={s.auditLabel}>Signer IP</Text><Text style={s.auditValue}>{input.signerIp}{input.signerUserAgent ? ` · ${input.signerUserAgent.slice(0, 110)}` : ""}</Text></View>
            <View style={s.auditRow}>
              <Text style={s.auditLabel}>Sections reviewed</Text>
              <Text style={s.auditValue}>
                {sectionTimes.map((t) => `${t.title}: ${t.at ? fmtStamp(t.at) : "—"}`).join("\n")}
              </Text>
            </View>
            <Text style={[s.smallText, { marginTop: 6 }]}>
              This document was completed and signed electronically. A single electronic signature applies
              to the entire document; the section review log above replaces per-page initialling.
            </Text>
          </View>
        </View>

        {/* CF-use-only zone schedule — final page, as on the paper form */}
        <View style={s.section} break>
          <Text style={[s.subKicker, { color: "#b91c1c" }]}>CENTREFIT GROUP USE ONLY</Text>
          <Text style={[s.h1, { fontSize: 14 }]}>Area &amp; Zone Schedule</Text>

          <View style={{ marginTop: 14 }}>
            <View style={s.tableHead}>
              <Text style={[s.th, { width: 40 }]}>AREA</Text>
              <Text style={[s.th, { width: 140 }]}>AREA NAME</Text>
              <Text style={[s.th, { flex: 1 }]}>DESCRIPTION</Text>
            </View>
            {[
              { zone: "1", name: "Main Facility", description: "Main Facility" },
              { zone: "2", name: "Duress DO NOT ARM", description: "Emergency Area" },
              { zone: "3", name: "Indication ONLY", description: "Door Controllers" },
            ].map((r) => (
              <View key={r.zone} style={s.tr}>
                <Text style={{ width: 40, color: FAINT }}>{r.zone}</Text>
                <Text style={{ width: 140 }}>{r.name}</Text>
                <Text style={{ flex: 1 }}>{r.description}</Text>
              </View>
            ))}
          </View>

          <View style={{ marginTop: 16 }}>
            <View style={s.tableHead}>
              <Text style={[s.th, { width: 40 }]}>ZONE</Text>
              <Text style={[s.th, { width: 140 }]}>ZONE NAME</Text>
              <Text style={[s.th, { flex: 1 }]}>DESCRIPTION</Text>
            </View>
            {prefill.zoneSchedule.length === 0 ? (
              <Text style={[s.smallText, { marginTop: 4 }]}>
                No alarm devices on file for this site yet — zone schedule to be completed at commissioning.
              </Text>
            ) : (
              prefill.zoneSchedule.map((r, i) => (
                <View key={i} style={s.tr}>
                  <Text style={{ width: 40, color: FAINT }}>{r.zone}</Text>
                  <Text style={{ width: 140 }}>{r.name}</Text>
                  <Text style={{ flex: 1 }}>{r.description}</Text>
                </View>
              ))
            )}
          </View>
        </View>
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}
