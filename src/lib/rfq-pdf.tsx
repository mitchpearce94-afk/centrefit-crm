/**
 * Supplier RFQ PDF — printable single-page item list. Attached to the RFQ
 * email so suppliers can print it, jot pricing/lead times next to each item
 * and reply with a scan. Shares brand styling with the quote PDF.
 */

import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import fs from "fs";
import path from "path";

const LOGO_BLUE_PATH = path.join(process.cwd(), "public", "centrefit-logo-blue.png");
const LOGO_BLUE_BUFFER: Buffer | null = (() => {
  try { return fs.readFileSync(LOGO_BLUE_PATH); } catch { return null; }
})();

export interface RfqPdfLine {
  productName: string;
  sku: string | null;
  quantity: number;
}

export interface RfqPdfInput {
  supplierName: string;
  quoteRef: string;
  /** Linked job number; used as the reference when present. Falls back to quoteRef. */
  jobNumber?: string | null;
  siteName?: string | null;
  dueByDate?: Date | null;
  lines: RfqPdfLine[];
  /** Pretty date string for the doc header (en-AU). Defaults to today. */
  createdAt?: Date;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 50,
    paddingHorizontal: 40,
    fontSize: 10,
    color: "#0f172a",
    fontFamily: "Helvetica",
    lineHeight: 1.5,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottomWidth: 2,
    borderBottomColor: "#0f172a",
    paddingBottom: 12,
    marginBottom: 18,
  },
  brandLogo: { height: 40, width: 102, objectFit: "contain" },
  docMeta: { textAlign: "right" },
  docTitle: { fontSize: 8.5, color: "#94a3b8", letterSpacing: 1.2, fontFamily: "Helvetica-Bold" },
  docRef: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 2 },
  docDate: { fontSize: 9, color: "#475569", marginTop: 1 },

  h1: { fontSize: 18, fontFamily: "Helvetica-Bold", letterSpacing: -0.3, marginBottom: 6 },
  intro: { fontSize: 11, color: "#475569", lineHeight: 1.55, marginBottom: 4 },

  metaCard: {
    flexDirection: "row",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 6,
    padding: 12,
    marginTop: 10,
    marginBottom: 18,
  },
  metaCol: { flex: 1 },
  metaLabel: { fontSize: 7.5, color: "#94a3b8", letterSpacing: 1.2, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  metaStrong: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  metaValue: { fontSize: 9, color: "#475569", marginTop: 1 },

  // Table
  tableHeadRow: {
    flexDirection: "row",
    backgroundColor: "#f9fafb",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#e5e7eb",
  },
  th: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    color: "#6b7280",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  thItem:    { flex: 5, textAlign: "left" },
  thSku:     { flex: 2, textAlign: "left" },
  thQty:     { flex: 1, textAlign: "right" },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#e5e7eb",
    minHeight: 28,
    alignItems: "center",
  },
  td: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 10,
    color: "#0f172a",
  },
  tdSubtle: { fontSize: 9, color: "#6b7280" },

  // Reply box
  replyBlock: {
    marginTop: 24,
    padding: 14,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 6,
  },
  replyH: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
    color: "#0f172a",
    marginBottom: 4,
  },
  replyText: { fontSize: 10, color: "#475569", lineHeight: 1.55 },

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

export function RfqDocument({ input }: { input: RfqPdfInput }) {
  const created = input.createdAt ?? new Date();
  const dateStr = created.toLocaleDateString("en-AU", {
    day: "numeric", month: "long", year: "numeric",
  });
  const reference = input.jobNumber ?? input.quoteRef;

  return (
    <Document title={`RFQ ${input.quoteRef}`} author="Centrefit Group">
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          {LOGO_BLUE_BUFFER ? (
            <Image src={LOGO_BLUE_BUFFER} style={styles.brandLogo} />
          ) : (
            <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold", color: "#1d4486" }}>Centrefit Group</Text>
          )}
          <View style={styles.docMeta}>
            <Text style={styles.docTitle}>PRICING REQUEST</Text>
            <Text style={styles.docRef}>{reference}</Text>
            <Text style={styles.docDate}>{dateStr}</Text>
          </View>
        </View>

        {/* Title + intro */}
        <Text style={styles.h1}>Pricing request — {input.supplierName}</Text>
        <Text style={styles.intro}>
          We're preparing a quote for our client and need your current pricing on the items below. Please reply to{" "}
          <Text style={{ fontFamily: "Helvetica-Bold" }}>accounts@centrefit.com.au</Text>{" "}
          with a quote of your current unit pricing with{" "}
          <Text style={{ fontFamily: "Helvetica-Bold" }}>{reference}</Text>{" "}
          as the reference. If anything is discontinued or backordered, an alternative would be appreciated.
        </Text>

        {/* Meta */}
        <View style={styles.metaCard}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>REFERENCE</Text>
            <Text style={styles.metaStrong}>{reference}</Text>
            {input.siteName && <Text style={styles.metaValue}>{input.siteName}</Text>}
          </View>
        </View>

        {/* Item table */}
        <View style={styles.tableHeadRow}>
          <Text style={[styles.th, styles.thItem]}>Item</Text>
          <Text style={[styles.th, styles.thSku]}>SKU</Text>
          <Text style={[styles.th, styles.thQty]}>Qty</Text>
        </View>
        {input.lines.map((line, i) => (
          <View key={i} style={styles.tableRow} wrap={false}>
            <Text style={[styles.td, styles.thItem]}>{line.productName}</Text>
            <Text style={[styles.td, styles.tdSubtle, styles.thSku]}>{line.sku ?? "—"}</Text>
            <Text style={[styles.td, styles.thQty, { fontFamily: "Helvetica-Bold" }]}>{line.quantity}</Text>
          </View>
        ))}
        {input.lines.length === 0 && (
          <Text style={[styles.td, { color: "#94a3b8", textAlign: "center", paddingVertical: 24 }]}>
            (No items — please contact Centrefit Procurement.)
          </Text>
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

export async function generateRfqPdfBuffer(input: RfqPdfInput): Promise<Buffer> {
  return renderToBuffer(<RfqDocument input={input} />);
}
