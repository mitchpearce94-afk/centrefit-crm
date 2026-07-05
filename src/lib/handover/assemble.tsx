/**
 * Handover pack assembler (Phase D).
 *
 * Builds the branded body with @react-pdf (cover, contents, procedures,
 * Wi-Fi, compliance), renders a divider page per product, then concatenates
 * the matched datasheet PDFs from the private `datasheets` bucket with
 * pdf-lib. Datasheet entries are driven by the site's KEY INFORMATION
 * assets only; the alarm system collapses to the single Solution 6000
 * entry. The acceptance page is rendered separately and appended at
 * signing time by the public submit route.
 */

import { Document, Page, View, Text, Image, Link, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import fs from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACCEPTANCE_STATEMENT,
  ALARM_PANEL_SLUGS,
  CCTV_PLAYBACK_PROCEDURE,
  DURESS_SLUGS,
  DURESS_TESTING_PROCEDURE,
  HANDOVER_TITLE,
  PRODUCT_BLURBS,
  complianceStatement,
  type Procedure,
} from "@/lib/handover/spec";
import { CF_ABN, CF_ADDRESS, CF_ASIAL_MEMBERSHIP, CF_SECURITY_LICENCE, CF_SERVICE_PHONE } from "@/lib/monitoring-form/spec";

const LOGO_BLUE_PATH = path.join(process.cwd(), "public", "centrefit-logo-blue.png");
const LOGO_BLUE_BUFFER: Buffer | null = (() => {
  try { return fs.readFileSync(LOGO_BLUE_PATH); } catch { return null; }
})();

const INK = "#0f172a";
const MUTED = "#64748b";
const FAINT = "#94a3b8";
const LINE = "#e2e8f0";
const BRAND = "#1d4ed8";

export interface HandoverEntry {
  model: string;
  manufacturer: string | null;
  productName: string;
  blurb: string;
  /** null = key equipment with no library datasheet — listed, not dropped. */
  storagePath: string | null;
  /** Public /api/public/datasheets/[id] URL — hyperlinked from the TOC. */
  publicUrl: string | null;
}

export interface WifiNetwork {
  ssid: string;
  password: string;
  notes: string | null;
}

export interface HandoverInput {
  siteName: string;
  clientName: string;
  facilityAddress: string;
  dateDisplay: string;
  entries: HandoverEntry[];
  wifi: WifiNetwork[];
  procedures: Procedure[];
}

// ── Data gathering ──────────────────────────────────────────────────────────

interface AssetRow {
  device_name: string | null;
  manufacturer: string | null;
  model: string | null;
  is_active: boolean;
  wifi_ssids: WifiNetwork[] | null;
  asset_type: { slug: string; name: string; category: string; is_key_info: boolean } | null;
}

interface DatasheetRow {
  id: string;
  model: string;
  manufacturer: string | null;
  product_name: string;
  match_models: string[];
  storage_path: string | null;
  /** Manufacturer web page for gear with no published PDF (Ubiquiti fleet). */
  source_url: string | null;
}

function sheetLink(sheet: DatasheetRow): string | null {
  return sheet.storage_path ? datasheetPublicUrl(sheet.id) : sheet.source_url;
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://crm.centrefit.com.au").replace(/\/$/, "");

function datasheetPublicUrl(id: string): string {
  return `${APP_URL}/api/public/datasheets/${id}`;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function buildHandoverInput(sb: SupabaseClient, siteId: string): Promise<HandoverInput> {
  const [siteResult, assetsResult, sheetsResult] = await Promise.all([
    sb
      .from("customer_sites")
      .select("*, customer:customers!customer_id(name)")
      .eq("id", siteId)
      .single(),
    sb
      .from("site_assets")
      .select("device_name, manufacturer, model, is_active, wifi_ssids, asset_type:asset_types!asset_type_id(slug, name, category, is_key_info)")
      .eq("site_id", siteId)
      .eq("is_active", true),
    sb.from("datasheets").select("id, model, manufacturer, product_name, match_models, storage_path, source_url"),
  ]);

  if (siteResult.error || !siteResult.data) throw new Error("Site not found");
  const site = siteResult.data as Record<string, unknown> & { customer: { name: string } | { name: string }[] | null };
  const customer = Array.isArray(site.customer) ? site.customer[0] ?? null : site.customer;

  const assets = ((assetsResult.data ?? []) as unknown as AssetRow[]).map((a) => ({
    ...a,
    asset_type: Array.isArray(a.asset_type) ? (a.asset_type[0] as AssetRow["asset_type"]) ?? null : a.asset_type,
  }));
  const sheets = (sheetsResult.data ?? []) as DatasheetRow[];

  // Key-info assets only drive the datasheet pack (Mitchell's rule).
  // Wi-Fi networks feed the Wi-Fi section, not the equipment list.
  const keyAssets = assets.filter(
    (a) => a.asset_type?.is_key_info && a.asset_type.slug !== "wifi_network",
  );

  const entryByKey = new Map<string, HandoverEntry>();
  for (const asset of keyAssets) {
    const slug = asset.asset_type?.slug ?? "";
    // Alarm system: ONE entry, regardless of which panel bits are on file.
    if (ALARM_PANEL_SLUGS.includes(slug)) {
      const solution = sheets.find((s) => s.model === "Solution 6000");
      if (solution) {
        entryByKey.set("__alarm__", {
          model: solution.model,
          manufacturer: solution.manufacturer,
          productName: solution.product_name,
          blurb: PRODUCT_BLURBS[solution.model] ?? "",
          storagePath: solution.storage_path,
          publicUrl: sheetLink(solution),
        });
      }
      continue;
    }
    // Match: a datasheet's match_model must appear inside the asset's model
    // or device name (one direction only — short haystacks like the type
    // name "NVR" were falsely matching inside long model codes).
    const haystacks = [asset.model, asset.device_name]
      .filter(Boolean)
      .map((s) => norm(String(s)))
      .filter((h) => h.length >= 4);
    const sheet = sheets.find((s) =>
      s.match_models.some((m) => {
        const needle = norm(m);
        return needle.length >= 4 && haystacks.some((h) => h.includes(needle) || (h.length >= 6 && needle.includes(h)));
      }),
    );
    if (sheet) {
      entryByKey.set(sheet.model, {
        model: sheet.model,
        manufacturer: sheet.manufacturer,
        productName: sheet.product_name,
        blurb: PRODUCT_BLURBS[sheet.model] ?? `Datasheet for the ${sheet.product_name} installed in the facility.`,
        storagePath: sheet.storage_path,
        publicUrl: sheetLink(sheet),
      });
    } else {
      // Key equipment with no library datasheet still appears in the pack —
      // silently dropping installed gear made the pack read as incomplete.
      const model = asset.model || asset.device_name || asset.asset_type?.name || "Equipment";
      const dedupeKey = norm(`${asset.manufacturer ?? ""}${model}`);
      if (!entryByKey.has(dedupeKey)) {
        entryByKey.set(dedupeKey, {
          model,
          manufacturer: asset.manufacturer,
          productName: asset.asset_type?.name ?? "Installed equipment",
          blurb: `${asset.asset_type?.name ?? "Equipment"} installed in the facility. Datasheet available from Centrefit on request.`,
          storagePath: null,
          publicUrl: null,
        });
      }
    }
  }

  const entries: HandoverEntry[] = [...entryByKey.values()];

  // Wi-Fi: dedupe by SSID across all assets carrying wifi_ssids.
  const wifiBySsid = new Map<string, WifiNetwork>();
  for (const a of assets) {
    for (const w of a.wifi_ssids ?? []) {
      if (w?.ssid && !wifiBySsid.has(w.ssid)) {
        wifiBySsid.set(w.ssid, { ssid: w.ssid, password: w.password ?? "", notes: w.notes ?? null });
      }
    }
  }

  const hasDuress = assets.some((a) => DURESS_SLUGS.includes(a.asset_type?.slug ?? ""));
  const hasCctv = keyAssets.some((a) => ["nvr", "camera"].includes(a.asset_type?.category ?? "")) ||
    entries.some((e) => e.model.includes("NVR"));
  const procedures: Procedure[] = [
    ...(hasDuress ? [DURESS_TESTING_PROCEDURE] : []),
    ...(hasCctv ? [CCTV_PLAYBACK_PROCEDURE] : []),
  ];

  return {
    siteName: site.name as string,
    clientName: (site.invoice_name as string | null) ?? customer?.name ?? (site.name as string),
    facilityAddress: [site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(", "),
    dateDisplay: new Date().toLocaleDateString("en-AU", { day: "2-digit", month: "2-digit", year: "numeric" }),
    entries,
    wifi: [...wifiBySsid.values()],
    procedures,
  };
}

// ── Body / divider / acceptance renderers ───────────────────────────────────

const s = StyleSheet.create({
  page: { paddingTop: 84, paddingBottom: 58, paddingHorizontal: 46, fontSize: 9.5, color: INK, fontFamily: "Helvetica", lineHeight: 1.55 },
  header: {
    position: "absolute", top: 0, left: 0, right: 0,
    paddingTop: 24, paddingHorizontal: 46, paddingBottom: 10,
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end",
    borderBottomWidth: 2, borderBottomColor: INK,
  },
  headerLogo: { height: 30, width: 77, objectFit: "contain" },
  footer: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: 46, paddingBottom: 22, paddingTop: 8,
    flexDirection: "row", justifyContent: "space-between",
    borderTopWidth: 0.75, borderTopColor: LINE,
  },
  footerText: { fontSize: 7, color: FAINT },
  kicker: { fontSize: 8, color: BRAND, fontFamily: "Helvetica-Bold", letterSpacing: 1.6, marginBottom: 6 },
  h1: { fontSize: 24, fontFamily: "Helvetica-Bold", letterSpacing: -0.5, lineHeight: 1.2 },
  sectionTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: INK, marginBottom: 10, marginTop: 18 },
  tocRow: { flexDirection: "row", paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: "#f1f5f9" },
  body: { fontSize: 9.5, color: "#334155", lineHeight: 1.6 },
});

function Chrome({ input, section }: { input: HandoverInput; section: string }) {
  return (
    <>
      <View style={s.header} fixed>
        {LOGO_BLUE_BUFFER ? (
          <Image src={{ data: LOGO_BLUE_BUFFER, format: "png" }} style={s.headerLogo} />
        ) : (
          <Text style={{ fontSize: 13, fontFamily: "Helvetica-Bold" }}>Centrefit Group</Text>
        )}
        <View style={{ textAlign: "right" }}>
          <Text style={{ fontSize: 7.5, color: FAINT, letterSpacing: 1.4, fontFamily: "Helvetica-Bold" }}>HANDOVER DOCUMENTATION</Text>
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 2 }}>{input.siteName} · {section}</Text>
        </View>
      </View>
      <View style={s.footer} fixed>
        <Text style={s.footerText}>
          Centrefit Group Pty Ltd · ABN {CF_ABN} · {CF_ADDRESS} · {CF_SERVICE_PHONE}
        </Text>
        <Text style={s.footerText}>Issued {input.dateDisplay}</Text>
      </View>
    </>
  );
}

async function renderBodyFront(input: HandoverInput): Promise<Buffer> {
  const tocEntries = [
    ...input.entries.map((e, i) => ({
      num: `${i + 1}.`,
      title: `${e.manufacturer ? `${e.manufacturer} ` : ""}${e.model} — ${e.productName}`,
      blurb: e.blurb,
      url: e.publicUrl,
    })),
    ...input.procedures.map((p, i) => ({
      num: `${input.entries.length + i + 1}.`,
      title: `${p.title} (${p.version})`,
      blurb: "",
      url: null as string | null,
    })),
    { num: `${input.entries.length + input.procedures.length + 1}.`, title: "Wi-Fi Details", blurb: "", url: null as string | null },
    { num: `${input.entries.length + input.procedures.length + 2}.`, title: "Compliance & Acceptance", blurb: "", url: null as string | null },
  ];

  const doc = (
    <Document title={`${HANDOVER_TITLE} — ${input.siteName}`} author="Centrefit Group Pty Ltd">
      <Page size="A4" style={s.page}>
        <Chrome input={input} section="Contents" />
        <View style={{ marginTop: 90 }}>
          <Text style={s.kicker}>CENTREFIT GROUP · SECURITY / CCTV / ACCESS CONTROL / NETWORK</Text>
          <Text style={s.h1}>{HANDOVER_TITLE}</Text>
          <View style={{ marginTop: 26 }}>
            {[
              ["Customer", input.clientName],
              ["Facility", input.siteName],
              ["Address", input.facilityAddress],
              ["Date", input.dateDisplay],
            ].map(([label, value]) => (
              <View key={label} style={{ flexDirection: "row", paddingVertical: 4 }}>
                <Text style={{ width: 90, fontSize: 9, color: MUTED, fontFamily: "Helvetica-Bold" }}>{label}</Text>
                <Text style={{ flex: 1, fontSize: 11 }}>{value}</Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={[s.sectionTitle, { marginTop: 42 }]}>Table of Contents</Text>
        <Text style={{ fontSize: 8, color: MUTED, marginBottom: 4 }}>
          Underlined items are hyperlinked — click to open that datasheet online. Full copies are also
          included in this pack after the contents page.
        </Text>
        {tocEntries.map((e) => (
          <View key={e.num} style={s.tocRow}>
            <Text style={{ width: 26, fontSize: 9.5, color: FAINT }}>{e.num}</Text>
            <View style={{ flex: 1 }}>
              {e.url ? (
                <Link src={e.url} style={{ fontSize: 9.5, fontFamily: "Helvetica-Bold", color: BRAND, textDecoration: "underline" }}>
                  {e.title}
                </Link>
              ) : (
                <Text style={{ fontSize: 9.5, fontFamily: "Helvetica-Bold" }}>{e.title}</Text>
              )}
              {e.blurb ? <Text style={{ fontSize: 8, color: MUTED, marginTop: 1 }}>{e.blurb}</Text> : null}
            </View>
          </View>
        ))}
      </Page>
    </Document>
  );
  return await renderToBuffer(doc);
}

async function renderDivider(input: HandoverInput, entry: HandoverEntry, index: number): Promise<Buffer> {
  const doc = (
    <Document>
      <Page size="A4" style={s.page}>
        <Chrome input={input} section={`Section ${index + 1}`} />
        <View style={{ marginTop: 240 }}>
          <Text style={s.kicker}>SECTION {index + 1} · DATASHEET</Text>
          <Text style={[s.h1, { fontSize: 20 }]}>
            {entry.manufacturer ? `${entry.manufacturer} ` : ""}{entry.model}
          </Text>
          <Text style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>{entry.productName}</Text>
          <Text style={[s.body, { marginTop: 14, maxWidth: 380 }]}>{entry.blurb}</Text>
          {entry.publicUrl ? (
            <Link src={entry.publicUrl} style={{ fontSize: 9, color: BRAND, textDecoration: "underline", marginTop: 10 }}>
              View this datasheet online
            </Link>
          ) : null}
        </View>
      </Page>
    </Document>
  );
  return await renderToBuffer(doc);
}

async function renderBodyBack(input: HandoverInput): Promise<Buffer> {
  const doc = (
    <Document>
      {input.procedures.map((proc) => (
        <Page key={proc.key} size="A4" style={s.page}>
          <Chrome input={input} section={proc.title} />
          <Text style={s.kicker}>{proc.title.toUpperCase()} — {proc.version}</Text>
          <Text style={[s.body, { marginBottom: 6 }]}>{proc.intro}</Text>
          {proc.steps.map((step) => (
            <View key={step.title} style={{ marginTop: 10 }} wrap={false}>
              <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold" }}>{step.title}</Text>
              <Text style={[s.body, { marginTop: 3 }]}>{step.body}</Text>
            </View>
          ))}
        </Page>
      ))}

      <Page size="A4" style={s.page}>
        <Chrome input={input} section="Wi-Fi & Compliance" />
        <Text style={s.sectionTitle}>Wi-Fi Details</Text>
        {input.wifi.length === 0 ? (
          <Text style={s.body}>No Wi-Fi networks on record for this facility.</Text>
        ) : (
          input.wifi.map((w) => (
            <View key={w.ssid} style={{ flexDirection: "row", paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: "#f1f5f9" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold" }}>SSID: {w.ssid}</Text>
                {w.notes ? <Text style={{ fontSize: 8, color: MUTED }}>{w.notes}</Text> : null}
              </View>
              <Text style={{ fontSize: 10, fontFamily: "Courier" }}>Password: {w.password || "—"}</Text>
            </View>
          ))
        )}
        <Text style={[s.body, { fontSize: 8, color: MUTED, marginTop: 8 }]}>
          These credentials are provided for the facility owner. For a printable guest Wi-Fi QR poster
          that lets members join without seeing the password, contact Centrefit or generate one from
          your CRM Key Information page.
        </Text>

        <Text style={s.sectionTitle}>Compliance Statement</Text>
        {complianceStatement(CF_SECURITY_LICENCE, CF_ASIAL_MEMBERSHIP).map((line, i) => (
          <Text key={i} style={[s.body, { marginBottom: 6 }]}>{line}</Text>
        ))}
      </Page>
    </Document>
  );
  return await renderToBuffer(doc);
}

export interface AcceptanceInput {
  input: HandoverInput;
  signerName: string;
  signerPosition: string;
  signatureDataUrl: string;
  signedAtDisplay: string;
  recipientEmail: string;
  requestId: string;
  signerIp: string;
}

export async function renderAcceptancePdf(a: AcceptanceInput): Promise<Buffer> {
  const doc = (
    <Document>
      <Page size="A4" style={s.page}>
        <Chrome input={a.input} section="Acceptance" />
        <Text style={s.sectionTitle}>Client Acceptance</Text>
        <Text style={s.body}>{ACCEPTANCE_STATEMENT}</Text>
        <View style={{ flexDirection: "row", marginTop: 24, alignItems: "flex-end" }}>
          <View style={{ width: 220 }}>
            <Image src={a.signatureDataUrl} style={{ height: 56, objectFit: "contain", objectPositionX: 0 }} />
            <View style={{ borderTopWidth: 0.75, borderTopColor: INK, marginTop: 4, paddingTop: 3 }}>
              <Text style={{ fontSize: 7.5, color: MUTED, fontFamily: "Helvetica-Bold" }}>SIGNED</Text>
            </View>
          </View>
          <View style={{ flex: 1, paddingLeft: 24 }}>
            {[
              ["Print Name", a.signerName],
              ["Position", a.signerPosition],
              ["Date", a.signedAtDisplay],
            ].map(([label, value]) => (
              <View key={label} style={{ flexDirection: "row", paddingVertical: 3 }}>
                <Text style={{ width: 80, fontSize: 8, color: MUTED, fontFamily: "Helvetica-Bold" }}>{label}</Text>
                <Text style={{ flex: 1, fontSize: 9.5 }}>{value}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={{ marginTop: 22, borderWidth: 1, borderColor: INK, borderRadius: 6, padding: 12 }}>
          <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", letterSpacing: 1, marginBottom: 6 }}>
            ELECTRONIC SIGNATURE AUDIT TRAIL
          </Text>
          {[
            ["Document", `${HANDOVER_TITLE} — ${a.input.siteName} — issued ${a.input.dateDisplay}`],
            ["Reference", a.requestId],
            ["Accepted by", `${a.signerName} (${a.signerPosition})`],
            ["Recipient", a.recipientEmail],
            ["Signed", a.signedAtDisplay],
            ["Signer IP", a.signerIp],
          ].map(([label, value]) => (
            <View key={label} style={{ flexDirection: "row", paddingVertical: 2 }}>
              <Text style={{ width: 100, fontSize: 7.5, color: MUTED, fontFamily: "Helvetica-Bold" }}>{label}</Text>
              <Text style={{ flex: 1, fontSize: 7.5 }}>{value}</Text>
            </View>
          ))}
          <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 6 }}>
            This handover pack was accepted and signed electronically via a tokenised link issued by
            Centrefit Group. The signed copy is retained by Centrefit Group Pty Ltd.
          </Text>
        </View>
      </Page>
    </Document>
  );
  return await renderToBuffer(doc);
}

// ── Pack assembly ───────────────────────────────────────────────────────────

export async function assembleHandoverPack(sb: SupabaseClient, input: HandoverInput): Promise<Buffer> {
  const front = await renderBodyFront(input);
  const back = await renderBodyBack(input);

  const merged = await PDFDocument.create();

  async function append(buf: Buffer | Uint8Array) {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }

  await append(front);
  for (let i = 0; i < input.entries.length; i++) {
    const entry = input.entries[i];
    const divider = await renderDivider(input, entry, i);
    await append(divider);
    if (!entry.storagePath) continue; // no library datasheet — divider carries the entry
    const { data, error } = await sb.storage.from("datasheets").download(entry.storagePath);
    if (error || !data) {
      // Datasheet missing from the bucket — the divider carries the entry;
      // don't fail the whole pack.
      console.warn("[handover] datasheet download failed", entry.storagePath, error?.message);
      continue;
    }
    await append(new Uint8Array(await data.arrayBuffer()));
  }
  await append(back);

  merged.setTitle(`${HANDOVER_TITLE} — ${input.siteName}`);
  merged.setAuthor("Centrefit Group Pty Ltd");
  return Buffer.from(await merged.save());
}

export async function appendAcceptancePage(packPdf: Buffer | Uint8Array, acceptance: Buffer): Promise<Buffer> {
  const merged = await PDFDocument.load(packPdf, { ignoreEncryption: true });
  const src = await PDFDocument.load(acceptance);
  const pages = await merged.copyPages(src, src.getPageIndices());
  for (const p of pages) merged.addPage(p);
  return Buffer.from(await merged.save());
}
