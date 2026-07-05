/**
 * Guest Wi-Fi QR poster renderer (Phase D). A print-ready branded A4 page —
 * big QR encoding the standard WIFI: join string so phones connect on scan
 * without the password ever being displayed. Deliberately a standalone
 * document, never part of the handover pack (Mitchell 2026-07-05).
 */

import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import fs from "fs";
import path from "path";
import QRCode from "qrcode";
import { CF_ABN, CF_SERVICE_PHONE } from "@/lib/monitoring-form/spec";

const LOGO_BLUE_PATH = path.join(process.cwd(), "public", "centrefit-logo-blue.png");
const LOGO_BLUE_BUFFER: Buffer | null = (() => {
  try { return fs.readFileSync(LOGO_BLUE_PATH); } catch { return null; }
})();

/** Escape per the WIFI: URI scheme — backslash, semicolon, comma, colon, quote. */
function escapeWifiValue(value: string): string {
  return value.replace(/([\\;,:"'])/g, "\\$1");
}

export async function renderWifiPosterPdf(opts: {
  siteName: string;
  ssid: string;
  password: string;
}): Promise<Buffer> {
  const wifiString = `WIFI:T:WPA;S:${escapeWifiValue(opts.ssid)};P:${escapeWifiValue(opts.password)};;`;
  const qrDataUrl = await QRCode.toDataURL(wifiString, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 900,
    color: { dark: "#0f172a", light: "#ffffff" },
  });

  const s = StyleSheet.create({
    page: {
      padding: 0,
      fontFamily: "Helvetica",
      color: "#0f172a",
    },
    band: {
      backgroundColor: "#0f172a",
      paddingVertical: 36,
      paddingHorizontal: 48,
      alignItems: "center",
    },
    kicker: {
      fontSize: 12,
      color: "#94a3b8",
      letterSpacing: 4,
      fontFamily: "Helvetica-Bold",
      marginBottom: 10,
    },
    title: { fontSize: 40, color: "#ffffff", fontFamily: "Helvetica-Bold", letterSpacing: -0.5 },
    body: { alignItems: "center", paddingTop: 44, paddingHorizontal: 48 },
    qrFrame: {
      borderWidth: 3,
      borderColor: "#0f172a",
      borderRadius: 18,
      padding: 22,
      backgroundColor: "#ffffff",
    },
    qr: { width: 300, height: 300 },
    ssid: { fontSize: 22, fontFamily: "Helvetica-Bold", marginTop: 30 },
    hint: { fontSize: 13, color: "#64748b", marginTop: 10, textAlign: "center", lineHeight: 1.6, maxWidth: 380 },
    footer: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      borderTopWidth: 1,
      borderTopColor: "#e2e8f0",
      paddingVertical: 20,
      paddingHorizontal: 48,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
  });

  const doc = (
    <Document title={`Wi-Fi Poster — ${opts.ssid}`} author="Centrefit Group Pty Ltd">
      <Page size="A4" style={s.page}>
        <View style={s.band}>
          <Text style={s.kicker}>FREE WI-FI</Text>
          <Text style={s.title}>Scan to Connect</Text>
        </View>
        <View style={s.body}>
          <View style={s.qrFrame}>
            <Image src={qrDataUrl} style={s.qr} />
          </View>
          <Text style={s.ssid}>{opts.ssid}</Text>
          <Text style={s.hint}>
            Open your phone camera and point it at the QR code — tap the prompt and you&apos;re connected.
            No password needed.
          </Text>
        </View>
        <View style={s.footer}>
          {LOGO_BLUE_BUFFER ? (
            <Image src={{ data: LOGO_BLUE_BUFFER, format: "png" }} style={{ height: 26, width: 67, objectFit: "contain" }} />
          ) : (
            <Text style={{ fontSize: 11, fontFamily: "Helvetica-Bold" }}>Centrefit Group</Text>
          )}
          <Text style={{ fontSize: 8, color: "#94a3b8" }}>
            Network installed & managed by Centrefit Group Pty Ltd · ABN {CF_ABN} · {CF_SERVICE_PHONE}
          </Text>
        </View>
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}
