// 2026-11-02 (v2) — Snap Fitness Forster GRENKE invoice in the Tuggerah format (INV-5375, 29 Apr 2026):
// addressed to grenke Pty Ltd, "WORKS ON BEHALF OF" the club entity, equipment schedule grouped by
// system with model + serial, ALL labour/services (electrician, commissioning, design, freight, travel)
// spread across the product groups pro-rata to sell value (Mitchell: "labour split between products,
// but not every single product"), minor parts lumped into their group. NovoFit SO0021737 lines at
// the attached prices. Replaces the v1 draft INV-7348 (deleted here). usage: node … [--dry]
import { writeFileSync, mkdirSync } from "node:fs";
import { db, xeroHeaders, X } from "./_xero-crm.mjs";

const QUOTE_ID = "09f309ae-07d8-4b62-b034-9f908f7fc7f2", JOB_ID = "308ab58d-8f12-484b-9566-182e29717186";
const CUSTOMER_ID = "80206475-2e19-43ff-a373-9e04368af3b1", SITE_ID = "1941c4bb-8511-48b0-93af-80af2a9962fd";
const GRENKE_ID = "3ffb6dd9-f457-485d-830e-44e712758362", GRENKE_ABN = "75615220196"; // grenke Pty Ltd (Tuggerah INV-5375)
const CLUB = "FORSTER FITNESS PTY LTD", CLUB_ABN = "24 687 814 295", CLUB_ADDR = "Unit 4, 4-12 Breese Parade, Forster NSW 2428";
const OLD_DRAFT = "fc35b8d9-eed2-4932-ad66-3ced135b6e18", OLD_CRM = "396f8909-b9c2-48ab-b886-07d354d7796b"; // v1 INV-7348
const THEME = "694b5eab-e258-46d8-96fc-141159982c14";
const QUOTE_EX = 69659.23, NOVO_EX = 26606.73, UP = 1.05;
const DRY = process.argv.includes("--dry");
const r2 = (n) => Math.round(n * 100) / 100;

const { data: quote } = await db.from("quotes").select("ref,status,pricing_snapshot,labour_data,electrician_cost,is_interstate").eq("id", QUOTE_ID).single();
if (quote.ref !== "CF-2026-0052" || quote.status !== "accepted" || r2(quote.pricing_snapshot.totalExGST) !== QUOTE_EX) throw new Error("quote changed");
const { data: bom } = await db.from("quote_line_items").select("sku,quantity,sell_price").eq("quote_id", QUOTE_ID);
const { data: extras } = await db.from("quote_extras").select("description,sell").eq("quote_id", QUOTE_ID);
const sell = new Map(bom.map((l) => [l.sku, r2(Number(l.quantity) * Number(l.sell_price))]));
const qty = new Map(bom.map((l) => [l.sku, Number(l.quantity)]));
const take = (...skus) => skus.reduce((s, k) => { if (!sell.has(k)) throw new Error(`sku ${k} not on quote`); const v = sell.get(k); sell.delete(k); return s + v; }, 0);
const WIIM = "https://www.amazon.com.au/dp/B0BJDY6D1W/ref=redir_mobile_desktop?_encoding=UTF8&aaxitk=d09896c2088e9";

// services pool (sell, pre-uplift): electrician ×2 interstate, commissioning, other, extras
const comm = quote.labour_data.sections.find((s) => s.name === "Commissioning & Build").totalSell;
const other = quote.labour_data.sections.find((s) => s.name === "Other").totalSell;
const pool = Number(quote.electrician_cost) * (quote.is_interstate ? 2 : 1.3) + comm + other + extras.reduce((s, e) => s + Number(e.sell), 0);

const SN = "S/N: recorded at installation", Y = "NEW · Year of manufacture: 2026";
const g = (system, description, skus) => ({ system, description, sellBase: r2(take(...skus)) });
const q = (k) => qty.get(k);
const groups = [
  g("SECURITY & ALARM", `Bosch Solution 6000 intruder alarm control panel — Model: K6000-GFX-ND (main board CC610GWP) in MW730B metal enclosure, with Centrefit large and small connector boards (CFLGE2022, CFSML2022) · ${SN} · ${Y}`, ["K6000NODET", "MW730B", "CFLGE2022", "CFSML2022"]),
  g("SECURITY & ALARM", `Panel expansion and communications — ${q("CM704B")} × Bosch CM704B 8/16-zone input expanders, 1 × CM710B output expander, 1 × MY368AU 4G GSM/GPRS communicator, 1 × Satel ETHM-A Ethernet monitoring module, 1 × Anddear DG9 5-port switch module, Bosch CM444B relays, Finder 55.32 relays and 94.02 bases, EC381V cable-mount plugs · ${SN} per module · ${Y}`, ["CM704B", "CM710B", "MY368AU", "S-COM-ETHM-A", "ANDDEAR-DG9", "CM444B", "FID55.32.007412VDC", "FID9402", "EC381V-04P", "EC381V-03P", "EC381V-02P", "EC381V-06P"]),
  g("SECURITY & ALARM", `${q("DS936")} × Bosch DS936 360° ceiling-mount PIR detectors — Model: DS936 · ${SN} each · ${Y}`, ["DS936"]),
  g("SECURITY & ALARM", `${q("ISC-BPQ2-W12")} × Bosch Blue Line Gen2 quad PIR detectors with B335-3 wall-mount brackets — Model: ISC-BPQ2-W12 · ${SN} each · ${Y}`, ["ISC-BPQ2-W12", "B335-3"]),
  g("SECURITY & ALARM", `Bosch RADION wireless — 1 × RFDW-SM reed contact, 1 × DigiFlex RF120 LAN-connected receiver · ${SN} each · ${Y}`, ["RFDW-SM", "RF120"]),
  g("SECURITY & ALARM", `${q("RFPB-SB")} × Bosch RADION single-button wireless duress pendants — Model: RFPB-SB · ${SN} each · ${Y}`, ["RFPB-SB"]),
  g("SECURITY & ALARM", `${q("WEL2210R-DURE")} × stainless duress button faceplates (WEL2210R-DURE) and 1 × large illuminated request-to-exit button (WEL1911) · ${Y}`, ["WEL2210R-DURE", "WEL1911"]),
  g("SECURITY & ALARM", `Elsema ECA2010 4G GSM duress / access-control intercom with Optus postpaid SIM — Model: ECA2010 · ${SN} · ${Y}`, ["ECA2010", "OPTUS Mobile SIM"]),
  g("SECURITY & ALARM", `MyAlarm Reporting Lite Plus — mobile app subscription (security + cameras), first 12 months · Service item`, ["Subscription - See Mark"]),
  g("ACCESS CONTROL", `${q("FSHFES20")} × FSH FES20 electric door strikes (Lockwood FES20 equivalent) with ${q("SECDWM300")} × armoured door loops and 1 × MP3560 12 Vdc 5 A supply · ${SN} per strike · ${Y}`, ["FSHFES20", "SECDWM300", "MP3560"]),
  g("CCTV", `${q("DH-HDW3666TMP - Black")} × Dahua 6 MP IR eyeball IP cameras, black — Model: DH-HDW3666TMP · ${SN} each · ${Y}`, ["DH-HDW3666TMP - Black"]),
  g("CCTV", `${q("DH-HDW3666TMP-White")} × Dahua 6 MP IR eyeball IP cameras, white, with ${q("PFB204W")} × PFB204W wall-mount brackets — Model: DH-HDW3666TMP · ${SN} each · ${Y}`, ["DH-HDW3666TMP-White", "PFB204W"]),
  g("CCTV", `Dahua Pro series 32-channel network video recorder, 16 PoE ports — Model: DHU10568 · ${SN} · ${Y}`, ["DHU10568"]),
  g("CCTV", `${q("WD60PURX")} × Western Digital Purple 6 TB surveillance hard drives — Model: WD60PURX · ${SN} each · ${Y}`, ["WD60PURX"]),
  g("CCTV", `Dahua 22" FHD LED monitor with audio — Model: DHI-LM22-H200 · ${SN} · ${Y}`, ["DHI-LM22-H200"]),
  g("AUDIO", `Power Dynamics 100V mixer-amplifiers — 1 × PRM240 (240 W) and 1 × PRM120 (120 W), 19" rack mount · ${SN} each · ${Y}`, ["PRM240", "PRM120"]),
  g("AUDIO", `Power Dynamics 100V speakers — ${q("NCSP5")} × NCSP5 low-profile ceiling speakers, ${q("BC50V")} × BC50V black wall-mount pairs, ${q("BC50VW")} × BC50VW white wall-mount pair · ${Y}`, ["NCSP5", "BC50V", "BC50VW"]),
  g("AUDIO", `WiiM Pro AirPlay 2 / Chromecast network audio streamer — Model: WiiM Pro · ${SN} · ${Y}`, [WIIM]),
  g("AV & TELEVISION", `${q("EPS-HDM1001M4")} × HDMI-in to DVB-T-out MPEG4 modulators — Model: EPS-HDM1001M4 · ${SN} each · ${Y}`, ["EPS-HDM1001M4"]),
  g("AV & TELEVISION", `${q("TIXX-AR500")} × TiXX AR500 articulated TV wall mounts, VESA 600 × 400, 45 kg · ${Y}`, ["TIXX-AR500"]),
  g("AV & TELEVISION", `RF distribution — KAT8F 8-port active tap with 18VDC1600F supply, KSP8F and KSP3F splitters, ATF20PP / ATF10PP attenuators, RG6 compression connectors, PAL–F adaptors and coaxial fly leads · ${Y}`, ["KAT8F", "18VDC1600F", "KSP8F", "KSP3F", "ATF20PP", "ATF10PP", "APFTRSF6L", "EADT-FFPM", "WV7386"]),
  g("DATA & NETWORK", `27RU floor-standing server cabinet 600 × 600 × 1300 mm (EPRFR27WS6D6) with vented shelf, ${q("EPRPBH8")} × 8-way rack power boards, ${q("ECM-1RUDS15")} × cable management ducts, ${q("24PPWK")} × 24-port Cat6 keystone patch panels, ${q("CPL160")} × 160 mm and ${q("ECPLS-C6B0.5")} × 500 mm Cat6 patch leads, Cat6 snap plugs · ${Y}`, ["EPRFR27WS6D6", "EPR-FS600", "EPRPBH8", "ECM-1RUDS15", "24PPWK", "CPL160", "ECPLS-C6B0.5", "EMP-CAT6UTPST"]),
  g("DATA & NETWORK", `Ubiquiti UniFi 48-port managed Gigabit Layer 2/3 PoE switch — Model: USW-Pro-48-PoE · ${SN} · ${Y}`, ["NHU-USW-PRO-48-POE"]),
  g("DATA & NETWORK", `Ubiquiti UniFi Cloud Gateway Fiber 10G — router, firewall and network controller — Model: UCG-Fiber · ${SN} · ${Y}`, ["NHU-UCG-FIBER"]),
  g("DATA & NETWORK", `${q("NHU-U7-PRO")} × Ubiquiti UniFi Wi-Fi 7 access points — Model: U7-Pro · ${SN} each · ${Y}`, ["NHU-U7-PRO"]),
  g("DATA & NETWORK", `PowerShield Defender 2000 VA UPS — Model: PSD2000 · ${SN} · ${Y}`, ["PSD2000"]),
];
sell.delete("NL-SERVER"); sell.delete("NL-KIOSK-24"); // Nightlife supplies and bills these directly ($0 on the quote)
if (sell.size) throw new Error(`unassigned skus: ${[...sell.keys()].join(", ")}`);

// allocate: price = (sell + pool × sell / Σsell) × 1.05, cents trued up on the biggest line
const base = r2(groups.reduce((s, x) => s + x.sellBase, 0));
for (const x of groups) x.price = r2((x.sellBase + pool * x.sellBase / base) * UP);
let total = r2(groups.reduce((s, x) => s + x.price, 0));
const biggest = groups.reduce((a, b) => (b.price > a.price ? b : a));
biggest.price = r2(biggest.price + (QUOTE_EX - total));
total = r2(groups.reduce((s, x) => s + x.price, 0));
if (total !== QUOTE_EX) throw new Error(`groups ${total} ≠ ${QUOTE_EX}`);

const AC = "203", TT = "OUTPUT";
const priced = (Description, Quantity, UnitAmount) => ({ Description, Quantity, UnitAmount, AccountCode: AC, TaxType: TT });
const textOnly = (Description) => ({ Description });
const lines = [textOnly(`WORKS ON BEHALF OF: ${CLUB} (trading as Snap Fitness Forster) · ABN ${CLUB_ABN}\n${CLUB_ADDR}\n\nSupply, installation and commissioning of the security & alarm, access control, CCTV, audio, AV / television and data & network systems per accepted Quote CF-2026-0052 (Centrefit job CFA05070), plus recovery and wellness equipment supplied through Centrefit under NovoFit order SO0021737. Prices below include installation, commissioning, programming, freight and travel. All goods supplied NEW, year of manufacture 2026. Serial numbers are recorded at installation and will be supplied on the serial schedule at handover. Nightlife streaming server and kiosk are supplied and invoiced by Nightlife directly and are not included.`)];
let cur = null;
for (const x of groups) { if (x.system !== cur) { cur = x.system; lines.push(textOnly(cur)); } lines.push(priced(x.description, 1, x.price)); }
const NY = "NEW · Year of manufacture: 2026";
lines.push(textOnly("RECOVERY & WELLNESS — NOVOFIT ORDER SO0021737 (supplied through Centrefit)"),
  priced(`3 × Hyperice Hypervolt 3 Pro percussion massage devices — Model: Hypervolt 3 Pro (NovoFit 54300-006-00) · ${SN} each · ${NY} · included with the Hyperice Tech Tower package`, 1, 0),
  priced(`2 × Hyperice Vyper 3 vibrating rollers — Model: Vyper 3 (NovoFit 31100-006-00) · ${SN} each · ${NY} · included with the Hyperice Tech Tower package`, 1, 0),
  priced(`2 × Hyperice Normatec 3 Leg compression recovery systems, standard package — Model: Normatec 3 Legs (NovoFit 63010-001-03) · ${SN} each · ${NY} · included with the Hyperice Tech Tower package`, 1, 0),
  priced(`2 × Hyperice DreamSeat recovery chairs — Model: DreamSeat (NovoFit 61092-001-00) · ${SN} each · ${NY} · included with the Hyperice Tech Tower package`, 1, 0),
  priced(`Hyperice Tech Tower recovery station — Model: Tech Tower (NovoFit 70110-001-00) · ${SN} · ${NY}`, 1, 8997),
  priced(`Club Strong 2-person dry sauna — Model: 310211-02 · ${SN} · ${NY} · Installation requirements: 60 mm gap between sauna roof and ceiling, 500 mm gap between sauna and wall for installer access · Warranty: 4-year commercial structural cabinetry (dry use only; 1 year if used wet), 5-year heaters, 2-year electrical components and controls, 1-year labour`, 1, 14209.73),
  priced(`NovoFit delivery and installation of the Hyperice and sauna equipment to Snap Fitness Forster (NovoFit in-house delivery / install, target install date 28 Feb 2027)`, 1, 3400),
);
const sum = (ls) => r2(ls.reduce((s, l) => s + (l.UnitAmount ?? 0) * (l.Quantity ?? 0), 0));
const expectSub = r2(QUOTE_EX + NOVO_EX);
if (sum(lines) !== expectSub) throw new Error(`lines ${sum(lines)} ≠ ${expectSub}`);
console.log(`Pool spread across products: $${r2(pool * UP)} (electrician $${r2(Number(quote.electrician_cost) * 2 * UP)}, commissioning $${r2(comm * UP)}, design/admin $${r2(other * UP)}, freight+travel $${r2(1200 * UP)}) on equipment $${r2(base * UP)}`);
console.log(`Lines: ${lines.length} (${lines.filter((l) => l.UnitAmount !== undefined).length} priced). Centrefit $${QUOTE_EX} + NovoFit $${NOVO_EX} = $${expectSub} ex · $${r2(expectSub * 1.1)} inc`);
for (const x of groups) console.log(`  ${x.system.padEnd(16)} $${x.price.toFixed(2).padStart(9)}  (sell $${x.sellBase.toFixed(2)})  ${x.description.slice(0, 90)}`);
if (DRY) process.exit(0);

const H = await xeroHeaders();
const get = async (p) => { const r = await fetch(X + p, { headers: H }); const j = await r.json(); if (!r.ok) throw new Error(`${p} ${r.status} ${JSON.stringify(j).slice(0, 400)}`); return j; };
const post = async (p, body) => { const r = await fetch(X + p, { method: "POST", headers: H, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(`${p} ${r.status} ${JSON.stringify(j).slice(0, 800)}`); return j; };

// 1. retire the v1 draft
const old = (await get(`Invoices/${OLD_DRAFT}`)).Invoices[0];
if (old.InvoiceNumber === "INV-7348" && old.Status === "DRAFT") { const d = (await post(`Invoices/${OLD_DRAFT}`, { InvoiceID: OLD_DRAFT, Status: "DELETED" })).Invoices[0]; console.log(`INV-7348 → ${d.Status}`); }
await db.from("invoices").update({ status: "void", description: "SUPERSEDED — v1 itemised draft deleted, replaced by the GRENKE-format invoice", xero_last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", OLD_CRM);

// 2. grenke contact: add the ABN from their signature
const gk = (await post(`Contacts/${GRENKE_ID}`, { ContactID: GRENKE_ID, TaxNumber: GRENKE_ABN })).Contacts[0];
console.log(`Contact: ${gk.Name} ABN ${gk.TaxNumber}`);

// 3. DRAFT invoice
const created = (await post("Invoices", { Invoices: [{ Type: "ACCREC", Contact: { ContactID: GRENKE_ID }, Date: "2026-11-02", DueDate: "2026-11-09",
  Reference: "Snap Fitness Forster - Forster Fitness Pty Ltd - CF-2026-0052 / CFA05070", BrandingThemeID: THEME, LineAmountTypes: "Exclusive", Status: "DRAFT", LineItems: lines }] })).Invoices[0];
if (created.HasErrors) throw new Error(JSON.stringify(created.ValidationErrors));
console.log(`NEW ${created.InvoiceNumber} ${created.InvoiceID}: sub $${created.SubTotal} GST $${created.TotalTax} total $${created.Total} ${created.Status}`);
if (Math.abs(Number(created.SubTotal) - expectSub) > 0.05) throw new Error(`subtotal ${created.SubTotal} ≠ ${expectSub}`);

// 4. CRM mirror (bill-to = grenke, site/customer = Forster)
const { data: ins, error: insErr } = await db.from("invoices").insert({
  invoice_type: "full", quote_id: QUOTE_ID, job_id: JOB_ID, customer_id: CUSTOMER_ID, site_id: SITE_ID,
  description: `GRENKE finance invoice (Tuggerah format) — quote CF-2026-0052 with labour spread across product groups + NovoFit SO0021737; on behalf of ${CLUB}; serials to follow at installation`,
  line_items: lines.map((l) => (l.UnitAmount === undefined ? { description: l.Description } : { description: l.Description, quantity: l.Quantity, unitAmount: l.UnitAmount, accountCode: AC, taxType: TT })),
  subtotal: created.SubTotal, gst: created.TotalTax, total: created.Total, amount_paid: 0, amount_due: created.AmountDue, currency: "AUD",
  status: "draft", xero_invoice_id: created.InvoiceID, xero_invoice_number: created.InvoiceNumber, xero_last_synced_at: new Date().toISOString(),
  issued_at: new Date().toISOString(), due_date: "2026-11-09", auto_created: false, xero_contact_id: GRENKE_ID, bill_to_name: "grenke Pty Ltd",
}).select("id").single();
if (insErr) console.log("CRM insert failed:", insErr.message); else console.log("CRM invoice row", ins.id);

// 5. PDF
const pdf = await fetch(X + `Invoices/${created.InvoiceID}`, { headers: { ...H, Accept: "application/pdf" } });
mkdirSync("/Users/mitchellpearce/.cortex/outbox/forster", { recursive: true });
const out = `/Users/mitchellpearce/.cortex/outbox/forster/${created.InvoiceNumber}-grenke-Forster-Fitness-DRAFT.pdf`;
writeFileSync(out, Buffer.from(await pdf.arrayBuffer()));
console.log("PDF", out);
