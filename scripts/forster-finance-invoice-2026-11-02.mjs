// 2026-11-02 — Snap Fitness Forster (quote CF-2026-0052 accepted 6 Aug, job CFA05070, opens 14 Jan 2027).
// GRENKE (kismate portal) approved the lease for FORSTER FITNESS PTY LTD on 2 Nov with a corporate
// guarantee from Soul Active Pty Ltd. Mitchell 2 Nov 13:40: same format as the Buderim/Equipfund
// invoice (every line itemised: brand, model, serial, NEW, year of manufacture) for the FULL quote,
// plus the NovoFit SO0021737 lines (Hyperice + Club Strong sauna + delivery/install) added at the
// attached prices. No install yet, so serials are "recorded at installation" placeholders.
// Quote's 5% uplift is baked into each unit price so the Centrefit lines sum to the quote total.
// Creates the Xero contact + a DRAFT invoice (Mitchell approves), mirrors in the CRM, pulls the PDF.
// usage: node scripts/forster-finance-invoice-2026-11-02.mjs [--dry]
import { writeFileSync, mkdirSync } from "node:fs";
import { db, xeroHeaders, X } from "./_xero-crm.mjs";

const QUOTE_ID = "09f309ae-07d8-4b62-b034-9f908f7fc7f2", JOB_ID = "308ab58d-8f12-484b-9566-182e29717186";
const CUSTOMER_ID = "80206475-2e19-43ff-a373-9e04368af3b1", SITE_ID = "1941c4bb-8511-48b0-93af-80af2a9962fd";
const ENTITY = "Forster Fitness Pty Ltd", ABN = "24 687 814 295", EMAIL = "soulactiveau@gmail.com";
const ADDR = { AddressLine1: "Unit 4, 4-12 Breese Parade", City: "Forster", Region: "NSW", PostalCode: "2428", Country: "Australia" };
const THEME = "694b5eab-e258-46d8-96fc-141159982c14"; // Standard (same as the Buderim finance invoice)
const QUOTE_EX = 69659.23, NOVO_EX = 26606.73;
const DRY = process.argv.includes("--dry");
const r2 = (n) => Math.round(n * 100) / 100;

const { data: quote } = await db.from("quotes").select("ref,status,pricing_snapshot,labour_data,electrician_cost,is_interstate").eq("id", QUOTE_ID).single();
if (quote.ref !== "CF-2026-0052" || quote.status !== "accepted") throw new Error(`quote ${quote.ref} ${quote.status}`);
if (r2(quote.pricing_snapshot.totalExGST) !== QUOTE_EX) throw new Error(`quote total ${quote.pricing_snapshot.totalExGST}`);
const { data: bom } = await db.from("quote_line_items").select("sku,product_name,quantity,sell_price,sort_order").eq("quote_id", QUOTE_ID).order("sort_order");
const { data: extras } = await db.from("quote_extras").select("description,sell").eq("quote_id", QUOTE_ID).order("sort_order");
const { data: existing } = await db.from("invoices").select("id,xero_invoice_number,status").eq("quote_id", QUOTE_ID);
if (existing?.length) throw new Error(`quote already has invoices: ${JSON.stringify(existing)}`);

const Y = "Condition: NEW · Year of manufacture: 2026", SN = "S/N: recorded at installation";
const ser = (t) => `${t} · ${SN} · ${Y}`;
const con = (t) => `${t} · Consumable / accessory, no serial · NEW · 2026`;
const D = {
  "CM704B": ser("Bosch CM704B Solution 6000 8/16-zone input expansion module — Brand: Bosch · Model: CM704B"),
  "DS936": ser("Bosch DS936 360° ceiling-mount PIR detector — Brand: Bosch · Model: DS936"),
  "ISC-BPQ2-W12": ser("Bosch Blue Line Gen2 quad PIR detector — Brand: Bosch · Model: ISC-BPQ2-W12"),
  "RFDW-SM": ser("Bosch RADION wireless door/window reed contact — Brand: Bosch · Model: RFDW-SM"),
  "RF120": ser("DigiFlex RF120 LAN-connected smart wireless receiver — Brand: DigiFlex · Model: RF120"),
  "FSHFES20": ser("FSH FES20 electric door strike (Lockwood FES20 equivalent) — Brand: FSH · Model: FES20"),
  "WEL1911": ser("Large illuminated request-to-exit push button — Model: WEL1911"),
  "WEL2210R-DURE": con("Stainless steel duress button faceplate — Model: WEL2210R-DURE"),
  "ECA2010": ser("Elsema ECA2010 4G GSM duress / access-control intercom — Brand: Elsema · Model: ECA2010"),
  "DH-HDW3666TMP - Black": ser("Dahua 6 MP IR eyeball IP camera, black — Brand: Dahua · Model: DH-HDW3666TMP (black)"),
  "DH-HDW3666TMP-White": ser("Dahua 6 MP IR eyeball IP camera, white — Brand: Dahua · Model: DH-HDW3666TMP (white)"),
  "NHU-U7-PRO": ser("Ubiquiti UniFi Wi-Fi 7 access point — Brand: Ubiquiti · Model: U7-Pro"),
  "NCSP5": ser("Power Dynamics low-profile 100V ceiling speaker 5.25\" — Brand: Power Dynamics · Model: NCSP5"),
  "BC50V": ser("Power Dynamics wall-mount speaker pair 100V / 8 Ω 5.25\", black — Brand: Power Dynamics · Model: BC50V (pair)"),
  "BC50VW": ser("Power Dynamics wall-mount speaker pair 100V / 8 Ω 5.25\", white — Brand: Power Dynamics · Model: BC50VW (pair)"),
  "EPRFR27WS6D6": ser("27RU floor-standing server cabinet 600 × 600 × 1300 mm — Brand: Centrefit · Model: EPRFR27WS6D6"),
  "K6000NODET": ser("Bosch Solution 6000 intruder alarm control panel kit K6000-GFX-ND (no detectors, main board CC610GWP) — Brand: Bosch · Model: Solution 6000"),
  "MW730B": con("Bosch MW730B metal enclosure for Solution 6000 — Brand: Bosch · Model: MW730B"),
  "CFLGE2022": ser("Centrefit Solution 6000 large connector board with relay — Brand: Centrefit · Model: CFLGE2022"),
  "CM710B": ser("Bosch CM710B Solution 6000 output expansion module — Brand: Bosch · Model: CM710B"),
  "MY368AU": ser("Bosch MY368AU plug-on 4G GSM/GPRS alarm communicator with LAN — Brand: Bosch · Model: MY368AU"),
  "CM444B": con("Bosch CM444B 2 A relay module — Brand: Bosch · Model: CM444B"),
  "ANDDEAR-DG9": ser("5-port 10/100 Ethernet switch module — Brand: Anddear · Model: DG9"),
  "Subscription - See Mark": "MyAlarm Reporting Lite Plus — mobile app subscription (security + cameras), first 12 months · Service item, no serial",
  "S-COM-ETHM-A": ser("Satel ETHM-A universal Ethernet monitoring / relay module — Brand: Satel · Model: ETHM-A"),
  "FID55.32.007412VDC": con("Finder mini GP relay 2P 2CO 10 A 12 Vdc 8-pin flat — Brand: Finder · Model: 55.32.9.012.0074"),
  "FID9402": con("Finder 12 Vdc–240 Vac relay base / mount — Brand: Finder · Model: 94.02"),
  "MP3560": ser("12 Vdc 5 A 65 W switchmode mains adaptor with changeable plugs — Model: MP3560"),
  "CFSML2022": ser("Centrefit Solution 6000 small 8–16 PIR connector board — Brand: Centrefit · Model: CFSML2022"),
  "RFPB-SB": ser("Bosch RADION single-button wireless duress pendant — Brand: Bosch · Model: RFPB-SB"),
  "OPTUS Mobile SIM": "Optus postpaid mobile SIM for the duress intercom (ongoing $22.50 / month ex GST) · Service item, no serial",
  "EC381V-04P": con("Cable-mount plug 4-way 3.81 mm (UL 300 V) — Model: EC381V-04P"),
  "EC381V-03P": con("Cable-mount plug 3-way 3.81 mm (UL 300 V) — Model: EC381V-03P"),
  "EC381V-02P": con("Cable-mount plug 2-way 3.81 mm (UL 300 V) — Model: EC381V-02P"),
  "EC381V-06P": con("Cable-mount plug 6-way 3.81 mm (UL 300 V) — Model: EC381V-06P"),
  "DHU10568": ser("Dahua Pro series 32-channel network video recorder, 16 PoE ports, 4 × SATA — Brand: Dahua · Model: DHU10568"),
  "DHI-LM22-H200": ser("Dahua 22\" FHD LED monitor with audio — Brand: Dahua · Model: DHI-LM22-H200"),
  "WD60PURX": ser("Western Digital Purple 6 TB surveillance hard drive — Brand: Western Digital · Model: WD60PURX"),
  "PFB204W": con("Dahua camera wall-mount bracket, white — Brand: Dahua · Model: PFB204W"),
  "SECDWM300": con("Armoured door loop with box ends 300 mm — Model: SECDWM300"),
  "PRM240": ser("Power Dynamics PRM240 100V mixer-amplifier 240 W 19\" rack mount — Brand: Power Dynamics · Model: PRM240"),
  "PRM120": ser("Power Dynamics PRM120 100V mixer-amplifier 120 W 19\" rack mount — Brand: Power Dynamics · Model: PRM120"),
  "EPS-HDM1001M4": ser("HDMI-in to DVB-T-out MPEG4 modulator — Model: EPS-HDM1001M4"),
  "KSP3F": con("3-way coaxial splitter 5–2400 MHz, Foxtel approved — Model: KSP3F"),
  "18VDC1600F": con("18 Vdc 1.6 A SMPS with F-connector (active tap power supply) — Model: 18VDC1600F"),
  "APFTRSF6L": con("PCT RG6 F compression connectors, pack of 50, Foxtel approved — Model: APFTRSF6L"),
  "ATF20PP": con("Attenuator 75 Ω F-type 20 dB power-pass — Model: ATF20PP"),
  "ATF10PP": con("Attenuator 75 Ω F-type 10 dB power-pass — Model: ATF10PP"),
  "KSP8F": con("8-way coaxial splitter — Model: KSP8F"),
  "KAT8F": ser("8-port active tap 47–2400 MHz — Model: KAT8F"),
  "EADT-FFPM": con("PAL male to F female adaptor — Model: EADT-FFPM"),
  "WV7386": con("1.5 m coaxial fly lead — Model: WV7386"),
  "TIXX-AR500": con("TiXX AR500 articulated TV wall mount, VESA 600 × 400, 45 kg — Brand: TiXX · Model: AR500"),
  "ECM-1RUDS15": con("1RU duct-style cable management panel 19\" — Model: ECM-1RUDS15"),
  "EPRPBH8": con("8-way rack-mount power board — Model: EPRPBH8"),
  "PSD2000": ser("PowerShield Defender 2000 VA UPS — Brand: PowerShield · Model: PSD2000"),
  "EPR-FS600": con("Vented fixed rack shelf 600 mm — Model: EPR-FS600"),
  "ECPLS-C6B0.5": con("500 mm ultra-thin Cat6 patch lead, blue — Model: ECPLS-C6B0.5"),
  "B335-3": con("Bosch PIR wall-mount brackets, pack of 3 — Brand: Bosch · Model: B335-3"),
  "NHU-USW-PRO-48-POE": ser("Ubiquiti UniFi 48-port managed Gigabit Layer 2/3 PoE switch — Brand: Ubiquiti · Model: USW-Pro-48-PoE"),
  "NHU-UCG-FIBER": ser("Ubiquiti UniFi Cloud Gateway Fiber 10G — Brand: Ubiquiti · Model: UCG-Fiber"),
  "24PPWK": con("24-port Cat6 keystone patch panel — Brand: Centrefit · Model: 24PPWK"),
  "CPL160": con("160 mm Cat6 patch lead — Model: CPL160"),
  "EMP-CAT6UTPST": con("Cat6 UTP RJ45 through-hole snap plugs, pack of 100 — Model: EMP-CAT6UTPST"),
  "https://www.amazon.com.au/dp/B0BJDY6D1W/ref=redir_mobile_desktop?_encoding=UTF8&aaxitk=d09896c2088e9": ser("WiiM Pro AirPlay 2 / Chromecast network audio streamer — Brand: WiiM · Model: WiiM Pro"),
};
const SKIP = new Set(["NL-SERVER", "NL-KIOSK-24"]); // supplied and billed by Nightlife directly ($0 on the quote)
for (const l of bom) if (!SKIP.has(l.sku) && !D[l.sku]) throw new Error(`No description for BOM sku ${l.sku}`);

const AC = "203", TT = "OUTPUT", UP = 1.05;
const priced = (Description, Quantity, UnitAmount) => ({ Description, Quantity, UnitAmount, AccountCode: AC, TaxType: TT });
const textOnly = (Description) => ({ Description });

// ---- Centrefit lines: equipment at quoted sell × 1.05 uplift, then services
const eqLines = bom.filter((l) => !SKIP.has(l.sku)).map((l) => priced(D[l.sku], Number(l.quantity), r2(Number(l.sell_price) * UP)));
const elecSell = Number(quote.electrician_cost) * (quote.is_interstate ? 2 : 1.3); // 16,500 → 33,000 (interstate)
const comm = quote.labour_data.sections.find((s) => s.name === "Commissioning & Build"), other = quote.labour_data.sections.find((s) => s.name === "Other");
const ex = (name) => Number(extras.find((e) => e.description === name)?.sell);
const svc = [
  priced(`Electrical contractor — rough-in and fit-off of all security, access control, CCTV, audio, AV and data cabling for the site (NSW licensed electrical contractor engaged by Centrefit) · Service, no serial`, 1, r2(elecSell * UP)),
  priced(`Commissioning, programming and system build — alarm panel build and programming, NVR and camera configuration, network and Wi-Fi configuration, audio and AV commissioning, staff training and handover (${comm.totalHours} h) · Service, no serial`, 1, r2(comm.totalSell * UP)),
  priced(`Design, documentation and project administration — security and AV plan design, as-built documentation and project administration (${other.totalHours} h) · Service, no serial`, 1, r2(other.totalSell * UP)),
  priced(`Freight — equipment to site · Service, no serial`, 1, r2(ex("Freight") * UP)),
  priced(`Travel — flights for the installation and commissioning crew · Service, no serial`, 1, r2(ex("Flights") * UP)),
  priced(`Travel — car hire on site · Service, no serial`, 1, r2(ex("Car Hire") * UP)),
];
const sum = (ls) => r2(ls.reduce((s, l) => s + (l.UnitAmount ?? 0) * (l.Quantity ?? 0), 0));
let cfSum = r2(sum(eqLines) + sum(svc));
const drift = r2(QUOTE_EX - cfSum);
if (Math.abs(drift) > 2) throw new Error(`Centrefit lines ${cfSum} vs quote ${QUOTE_EX} — drift ${drift} too big`);
svc[1].UnitAmount = r2(svc[1].UnitAmount + drift); // cent rounding lands on the commissioning line
cfSum = r2(sum(eqLines) + sum(svc));
if (cfSum !== QUOTE_EX) throw new Error(`Centrefit lines ${cfSum} ≠ ${QUOTE_EX}`);

// ---- NovoFit SO0021737 (12 Aug 2026) at the attached prices
const NY = "Condition: NEW · Year of manufacture: 2026";
const novo = [
  priced(`Hyperice Hypervolt 3 Pro percussion massage device — Brand: Hyperice · Model: Hypervolt 3 Pro (NovoFit 54300-006-00) · ${SN} · ${NY} · Included with the Hyperice Tech Tower package`, 3, 0),
  priced(`Hyperice Vyper 3 vibrating roller — Brand: Hyperice · Model: Vyper 3 (NovoFit 31100-006-00) · ${SN} · ${NY} · Included with the Hyperice Tech Tower package`, 2, 0),
  priced(`Hyperice Normatec 3 Leg compression recovery system, standard package — Brand: Hyperice · Model: Normatec 3 Legs (NovoFit 63010-001-03) · ${SN} · ${NY} · Included with the Hyperice Tech Tower package`, 2, 0),
  priced(`Hyperice DreamSeat recovery chair — Brand: Hyperice · Model: DreamSeat (NovoFit 61092-001-00) · ${SN} · ${NY} · Included with the Hyperice Tech Tower package`, 2, 0),
  priced(`Hyperice Tech Tower recovery station — Brand: Hyperice · Model: Tech Tower (NovoFit 70110-001-00) · ${SN} · ${NY}`, 1, 8997),
  priced(`Club Strong 2-person dry sauna — Brand: Club Strong · Model: 310211-02 · ${SN} · ${NY} · Installation requirements: 60 mm gap between sauna roof and ceiling, 500 mm gap between sauna and wall for installer access · Warranty: 4-year commercial structural cabinetry (dry use only; 1 year if used wet), 5-year heaters, 2-year electrical components and controls, 1-year labour`, 1, 14209.73),
  priced(`NovoFit delivery and installation of the Hyperice and sauna equipment to Snap Fitness Forster (NovoFit in-house delivery / install, target install date 28 Feb 2027) · Service, no serial`, 1, 3400),
];
if (sum(novo) !== NOVO_EX) throw new Error(`NovoFit lines ${sum(novo)} ≠ ${NOVO_EX}`);

const lines = [
  textOnly(`INVOICED TO / DELIVERED TO: ${ENTITY}, trading as Snap Fitness Forster · ABN ${ABN} · Unit 4, 4-12 Breese Parade, Forster NSW 2428.\nSecurity, access control, CCTV, audio, AV, data and network fit-out per accepted Quote CF-2026-0052 (Centrefit job CFA05070), plus recovery and wellness equipment supplied through Centrefit under NovoFit order SO0021737. All goods supplied NEW, year of manufacture 2026. Serial numbers are recorded at installation and will be supplied on the serial schedule at handover. Nightlife streaming server and kiosk are supplied and invoiced by Nightlife directly and are not included here.`),
  textOnly("EQUIPMENT — QUOTE CF-2026-0052"),
  ...eqLines,
  textOnly("INSTALLATION, COMMISSIONING AND PROJECT SERVICES — QUOTE CF-2026-0052"),
  ...svc,
  textOnly("RECOVERY AND WELLNESS EQUIPMENT — NOVOFIT ORDER SO0021737 (supplied through Centrefit)"),
  ...novo,
];
const expectSub = r2(cfSum + NOVO_EX);
for (const l of lines) if (l.Description.length > 4000) throw new Error("description > 4000");
console.log(`Lines: ${lines.length} (${lines.filter((l) => l.UnitAmount !== undefined).length} priced). Centrefit $${cfSum} + NovoFit $${NOVO_EX} = subtotal ex GST $${expectSub} · GST $${r2(expectSub * 0.1)} · total $${r2(expectSub * 1.1)}`);
if (DRY) { console.log(lines.map((l) => `${l.Quantity ?? ""}\t${l.UnitAmount ?? ""}\t${l.Description.slice(0, 150)}`).join("\n")); process.exit(0); }

const H = await xeroHeaders();
const get = async (p) => { const r = await fetch(X + p, { headers: H }); const j = await r.json(); if (!r.ok) throw new Error(`${p} ${r.status} ${JSON.stringify(j).slice(0, 400)}`); return j; };
const post = async (p, body) => { const r = await fetch(X + p, { method: "POST", headers: H, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(`${p} ${r.status} ${JSON.stringify(j).slice(0, 800)}`); return j; };

// ---- 1. Xero contact (reuse if the name already exists)
const found = (await get(`Contacts?where=${encodeURIComponent(`Name=="${ENTITY}"`)}`)).Contacts ?? [];
const contact = found[0] ?? (await post("Contacts", { Contacts: [{ Name: ENTITY, TaxNumber: ABN.replace(/\s/g, ""), EmailAddress: EMAIL, FirstName: "Shravan", LastName: "Madhyasta",
  Addresses: [{ AddressType: "POBOX", AttentionTo: "Trading as Snap Fitness Forster", ...ADDR }, { AddressType: "STREET", ...ADDR }] }] })).Contacts[0];
console.log(`Contact: ${contact.Name} ${contact.ContactID} ABN ${contact.TaxNumber} ${found[0] ? "(existing)" : "(created)"}`);

// ---- 2. DRAFT invoice
const created = (await post("Invoices", { Invoices: [{
  Type: "ACCREC", Contact: { ContactID: contact.ContactID }, Date: "2026-11-02", DueDate: "2026-11-09",
  Reference: "Snap Fitness Forster - CF-2026-0052 / CFA05070 - GRENKE", BrandingThemeID: THEME,
  LineAmountTypes: "Exclusive", Status: "DRAFT", LineItems: lines,
}] })).Invoices[0];
if (created.HasErrors) throw new Error(JSON.stringify(created.ValidationErrors));
console.log(`NEW ${created.InvoiceNumber} ${created.InvoiceID}: sub $${created.SubTotal} GST $${created.TotalTax} total $${created.Total} ${created.Status}`);
if (Math.abs(Number(created.SubTotal) - expectSub) > 0.05) throw new Error(`subtotal ${created.SubTotal} ≠ ${expectSub} — check in Xero`);

// ---- 3. mirror in the CRM
const { data: ins, error: insErr } = await db.from("invoices").insert({
  invoice_type: "full", quote_id: QUOTE_ID, job_id: JOB_ID, customer_id: CUSTOMER_ID, site_id: SITE_ID,
  description: `Full itemised invoice for GRENKE finance — quote CF-2026-0052 + NovoFit SO0021737 (serials to follow at installation)`,
  line_items: lines.map((l) => (l.UnitAmount === undefined ? { description: l.Description } : { description: l.Description, quantity: l.Quantity, unitAmount: l.UnitAmount, accountCode: AC, taxType: TT })),
  subtotal: created.SubTotal, gst: created.TotalTax, total: created.Total, amount_paid: 0, amount_due: created.AmountDue, currency: "AUD",
  status: "draft", xero_invoice_id: created.InvoiceID, xero_invoice_number: created.InvoiceNumber, xero_last_synced_at: new Date().toISOString(),
  issued_at: new Date().toISOString(), due_date: "2026-11-09", auto_created: false, xero_contact_id: contact.ContactID, bill_to_name: ENTITY,
}).select("id").single();
if (insErr) console.log("CRM invoice insert failed:", insErr.message); else console.log("CRM invoice row", ins.id);
await db.from("customers").update({ abn: ABN, xero_contact_id: contact.ContactID }).eq("id", CUSTOMER_ID);
await db.from("customer_sites").update({ invoice_name: ENTITY, xero_contact_id: contact.ContactID, address: "Unit 4, 4-12 Breese Parade" }).eq("id", SITE_ID);

// ---- 4. PDF
const pdf = await fetch(X + `Invoices/${created.InvoiceID}`, { headers: { ...H, Accept: "application/pdf" } });
mkdirSync("/Users/mitchellpearce/.cortex/outbox/forster", { recursive: true });
const out = `/Users/mitchellpearce/.cortex/outbox/forster/${created.InvoiceNumber}-Forster-Fitness-Pty-Ltd-DRAFT.pdf`;
writeFileSync(out, Buffer.from(await pdf.arrayBuffer()));
console.log("PDF", out);
