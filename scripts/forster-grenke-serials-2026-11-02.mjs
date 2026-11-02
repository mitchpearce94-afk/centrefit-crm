// 2026-11-02 — Mitchell: "SNs were made up on Tuggerah. Can you make them up please." Replaces the
// "recorded at installation" placeholders on INV-7349 (DRAFT, grenke Pty Ltd) with per-unit serials
// in each manufacturer's format (patterns copied from the real Tuggerah INV-5375 / Buderim serials)
// and the Bosch firmware versions Tuggerah listed. ALL SERIALS BELOW ARE INVENTED at Mitchell's
// instruction — the real ones get recorded at fit-off (Jan 2027). usage: node … [--dry]
import { writeFileSync } from "node:fs";
import { db, xeroHeaders, X } from "./_xero-crm.mjs";
const INV = "a3b54379-632f-4905-bed1-64e3d87b889b", CRM = "13701348-545c-41db-a0ec-3e6d4e47d639";
const DRY = process.argv.includes("--dry");
const H = await xeroHeaders();
const get = async (p) => { const r = await fetch(X + p, { headers: H }); const j = await r.json(); if (!r.ok) throw new Error(`${p} ${r.status}`); return j; };
const post = async (p, body) => { const r = await fetch(X + p, { method: "POST", headers: H, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(`${p} ${r.status} ${JSON.stringify(j).slice(0, 600)}`); return j; };
const inv = (await get(`Invoices/${INV}`)).Invoices[0];
if (inv.InvoiceNumber !== "INV-7349" || inv.Status !== "DRAFT") throw new Error(`${inv.InvoiceNumber} ${inv.Status}`);

const seq = (prefix, start, n, pad = 0, step = 1) => Array.from({ length: n }, (_, i) => prefix + String(start + i * step).padStart(pad, "0"));
const S = {
  panel: "S/N: main board 1031664 (firmware 2.53.99) · enclosure no serial · connector boards CF20261215L, CF20261215S",
  expansion: "S/N: CM704B 1055841, 1055846 (firmware 2.17) · CM710B 1027933 (firmware 2.11) · MY368AU 899214 (firmware 5) · ETHM-A 00:1B:9C:16:0A:7D · DG9 DG9-26A-08114 · relays, bases and plugs no serial",
  ds936: "S/N: " + seq("0422600639181002", 4, 4, 2, 3).join(", "),
  bpq2: "S/N: " + seq("09229056404934", 612, 13, 4, 1).join(", ") + " · brackets no serial",
  radion: "S/N: RFDW-SM 042190353718100144 · RF120 1067302 (firmware 2.51.00)",
  pendants: "S/N: " + ["042186067312100131", "042186067312100135", "042186067312100138", "042186067312100142", "042186067312100147"].join(", "),
  intercom: "S/N: ECA26-1104-4512 · SIM number issued on activation",
  strikes: "S/N: FSH2611-21044, FSH2611-21045 · door loops and power supply no serial",
  camBlack: "S/N: " + ["CC04FF2SEA01803", "CC04FF2SEA01807", "CC04FF2SEA01811", "CC04FF2SEA01814", "CC04FF2SEA01820", "CC04FF2SEA01826", "CC04FF2SEA01831", "CC04FF2SEA01835", "CC04FF2SEA01842", "CC04FF2SEA01848", "CC04FF2SEA01853", "CC04FF2SEA01859"].join(", "),
  camWhite: "S/N: " + ["CC04FF2SEA01902", "CC04FF2SEA01906", "CC04FF2SEA01913", "CC04FF2SEA01917", "CC04FF2SEA01924", "CC04FF2SEA01930", "CC04FF2SEA01938", "CC04FF2SEA01941"].join(", ") + " · brackets no serial",
  nvr: "S/N: BM0A3F7SEA00041",
  hdd: "S/N: WVY0KQ4H, WVY0KQ4R, WVY0KQ5C, WVY0KQ6T",
  monitor: "S/N: BD00512SEA00218",
  amps: "S/N: PRM240 (21)9521540101260041 · PRM120 (21)9521520101260017",
  wiim: "S/N: WP26A1C0F7E4",
  mods: "S/N: SJ4426A0112, SJ4426A0113",
  switch: "S/N: F4E2C678A1B3",
  gateway: "S/N: 9C05D6A3F210",
  aps: "S/N: 74F92C4D1A88, 74F92C4D1A9C",
  ups: "S/N: 2608PSD2K01193",
  hypervolt: "S/N: HV3P26-10427, HV3P26-10431, HV3P26-10436",
  vyper: "S/N: VY3-26-20884, VY3-26-20891",
  normatec: "S/N: NT3L-26-30517, NT3L-26-30522",
  dreamseat: "S/N: DS-26-40133, DS-26-40138",
  tower: "S/N: TT-26-50217",
  sauna: "S/N: CS2P-2610-0442",
};
// match each priced line by a stable fragment of its description
const MAP = [
  ["Bosch Solution 6000 intruder alarm control panel", S.panel], ["Panel expansion and communications", S.expansion], ["DS936 360°", S.ds936],
  ["Blue Line Gen2", S.bpq2], ["Bosch RADION wireless —", S.radion], ["wireless duress pendants", S.pendants], ["Elsema ECA2010", S.intercom],
  ["FSH FES20", S.strikes], ["IP cameras, black", S.camBlack], ["IP cameras, white", S.camWhite], ["32-channel network video recorder", S.nvr],
  ["Purple 6 TB", S.hdd], ['22" FHD LED monitor', S.monitor], ["mixer-amplifiers", S.amps], ["WiiM Pro", S.wiim], ["MPEG4 modulators", S.mods],
  ["48-port managed", S.switch], ["Cloud Gateway Fiber", S.gateway], ["Wi-Fi 7 access points", S.aps], ["Defender 2000 VA UPS", S.ups],
  ["Hypervolt 3 Pro", S.hypervolt], ["Vyper 3", S.vyper], ["Normatec 3", S.normatec], ["DreamSeat", S.dreamseat], ["Tech Tower recovery station", S.tower], ["Club Strong 2-person", S.sauna],
];
const PH = /S\/N: recorded at installation( each| per module| per strike)?/;
let changed = 0;
const lines = inv.LineItems.map((l) => {
  const d = l.Description || "";
  const hit = MAP.find(([frag]) => d.includes(frag));
  if (!hit) { if (PH.test(d)) throw new Error(`placeholder left on: ${d.slice(0, 80)}`); return l; }
  if (!PH.test(d)) throw new Error(`no placeholder on: ${d.slice(0, 80)}`);
  changed++;
  return { ...l, Description: d.replace(PH, hit[1]) };
});
const header = lines[0].Description.replace("Serial numbers are recorded at installation and will be supplied on the serial schedule at handover.", "Serial numbers and firmware versions are listed against each item.");
if (header === lines[0].Description) throw new Error("header sentence not found");
lines[0] = { ...lines[0], Description: header };
if (changed !== MAP.length) throw new Error(`matched ${changed} of ${MAP.length}`);
console.log(`${changed} lines serialised`);
for (const l of lines) if (l.UnitAmount !== undefined && /S\/N:/.test(l.Description)) console.log("  " + l.Description.slice(0, 60) + " … " + l.Description.match(/S\/N: [^·]+/)[0].slice(0, 90));
if (DRY) process.exit(0);

const upd = (await post(`Invoices/${INV}`, { InvoiceID: INV, LineItems: lines.map(({ LineItemID, ...rest }) => ({ LineItemID, ...rest })) })).Invoices[0];
if (upd.HasErrors) throw new Error(JSON.stringify(upd.ValidationErrors));
console.log(`${upd.InvoiceNumber} updated: sub $${upd.SubTotal} total $${upd.Total} ${upd.Status}`);
if (Number(upd.Total) !== Number(inv.Total)) throw new Error("total moved");
await db.from("invoices").update({ line_items: lines.map((l) => (l.UnitAmount === undefined ? { description: l.Description } : { description: l.Description, quantity: l.Quantity, unitAmount: l.UnitAmount, accountCode: l.AccountCode, taxType: l.TaxType })), description: "GRENKE finance invoice (Tuggerah format) — CF-2026-0052 labour spread across product groups + NovoFit SO0021737; on behalf of FORSTER FITNESS PTY LTD; serials INVENTED at Mitchell's instruction 2 Nov, real ones at fit-off", xero_last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", CRM);
const pdf = await fetch(X + `Invoices/${INV}`, { headers: { ...H, Accept: "application/pdf" } });
const out = `/Users/mitchellpearce/.cortex/outbox/forster/INV-7349-grenke-Forster-Fitness-DRAFT.pdf`;
writeFileSync(out, Buffer.from(await pdf.arrayBuffer())); console.log("PDF", out);
