// 27 Oct 2026 — Mitchell: PO-0636 (PF Maroochydore) needs 2 × VEY-Q2 (Front + Pilates), and the
// controller product is renamed "Veyla Access Kit - Controller, Enclosure and power supply".
// Reader unit price left as-is until Mitchell confirms the correct Veyla cost (pass --price <ex GST> to set it).
// usage: node scripts/po0636-reader-qty2-rename-2026-10-27.mjs [--write] [--price 650]
import { db, xeroHeaders, X } from "./_xero-crm.mjs";
const write = process.argv.includes("--write");
const pi = process.argv.indexOf("--price");
const PRICE = pi > -1 ? Number(process.argv[pi + 1]) : null;
const PO_ID = "269de1d4-289c-4dfa-9840-2c2ecc5f3ce7", X1100C = "b3eed4cc-65e0-4044-9abf-a70be750a95b", VEYQ2 = "82a82f7d-60b6-4a35-9978-8aee3367fdb0";
const ENCLOSURE = "8e9f70db-189a-40f7-b1b9-e40f69b7f7b7", PROC_ROW = "ad169f97-01a3-4985-b50e-62a2e4efac99";
const NAME = "Veyla Access Kit - Controller, Enclosure and power supply";

const { data: prod } = await db.from("quote_products").select("id,name,sku,cost_price,sell_price").eq("id", X1100C).single();
console.log("controller product:", prod.name, "→", NAME);
const { data: comps } = await db.from("product_kit_components").select("id,kit_product_id,component_product_id,qty_mode,qty_value,notes").in("kit_product_id", [VEYQ2, X1100C]);
console.log("kit components:", JSON.stringify(comps, null, 1));
const encl = (comps ?? []).find((c) => c.kit_product_id === VEYQ2 && c.component_product_id === ENCLOSURE);
console.log("enclosure component on VEY-Q2:", encl?.id ?? "none", "(kit now includes the enclosure → drop)");

const h = await xeroHeaders();
const po = (await (await fetch(`${X}PurchaseOrders/${PO_ID}`, { headers: h })).json()).PurchaseOrders[0];
const lines = po.LineItems.map((l) => {
  const o = { Description: l.Description, Quantity: l.Quantity, UnitAmount: l.UnitAmount, AccountCode: l.AccountCode, TaxType: l.TaxType, ...(l.ItemCode ? { ItemCode: l.ItemCode } : {}) };
  if (/VEY-Q2/.test(l.Description)) { o.Quantity = 2; if (PRICE) o.UnitAmount = PRICE; o.Description = "Veyla Access Reader — Suprema XPass Q2, QR + barcode, PoE (VEY-Q2) — Front + Pilates doors"; }
  if (l.ItemCode === "HID Aero X1100C") o.Description = `${NAME} (HID Aero X1100C)`;
  return o;
});
console.log("PO lines →", JSON.stringify(lines, null, 1));
if (!write) { console.log("dry run"); process.exit(0); }

await db.from("quote_products").update({ name: NAME, notes: `${NAME}. Supplied by Veyla as one kit (controller board, printed Veyla enclosure, power supply) — renamed 27 Oct 2026 (Mitchell). Was "Veyla Access Controller".` }).eq("id", X1100C).throwOnError();
console.log("✅ product renamed");
if (encl) { await db.from("product_kit_components").delete().eq("id", encl.id).throwOnError(); console.log("✅ CFAE026 enclosure dropped from the VEY-Q2 kit (enclosure is in the Veyla Access Kit)"); }
const procUpd = { quantity: 2, backorder_note: "2 × VEY-Q2 on PO-0636 (Front + Pilates) — qty corrected 27 Oct 2026 (Mitchell); one is the sample unit 547849965", updated_at: new Date().toISOString() };
await db.from("job_procurement_items").update(procUpd).eq("id", PROC_ROW).throwOnError();
console.log("✅ procurement row qty 2");
const r = await fetch(`${X}PurchaseOrders/${PO_ID}`, { method: "POST", headers: h, body: JSON.stringify({ PurchaseOrders: [{ PurchaseOrderID: PO_ID, LineItems: lines }] }) });
const j = await r.json();
if (!r.ok) { console.error("Xero", r.status, JSON.stringify(j).slice(0, 800)); process.exit(1); }
const p2 = j.PurchaseOrders[0];
console.log(`✅ Xero ${p2.PurchaseOrderNumber} ${p2.Status} subtotal ${p2.SubTotal} total ${p2.Total}`);
for (const l of p2.LineItems) console.log("  ", l.Quantity, "×", l.UnitAmount, l.Description);
