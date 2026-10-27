// 27 Oct 2026 22:20 — Mitchell: the Veyla reader is "QR/Barcode Reader Replacement Kit", $634.33 + GST (the old PFRRK price).
// Updates VEY-Q2 (name + cost, markup 0 like the other Veyla products) and the PO-0636 reader line (2 × 634.33).
// usage: node scripts/po0636-reader-price-2026-10-27.mjs [--write]
import { db, xeroHeaders, X } from "./_xero-crm.mjs";
const write = process.argv.includes("--write");
const PO_ID = "269de1d4-289c-4dfa-9840-2c2ecc5f3ce7", VEYQ2 = "82a82f7d-60b6-4a35-9978-8aee3367fdb0";
const NAME = "QR/Barcode Reader Replacement Kit", PRICE = 634.33;
const DESC = `${NAME} — Suprema XPass Q2, QR + barcode, PoE (VEY-Q2) — Front + Pilates doors`;
const { data: p } = await db.from("quote_products").select("name,cost_price,markup,sell_price,notes").eq("id", VEYQ2).single();
console.log("VEY-Q2:", p.name, p.cost_price, "→", NAME, PRICE);
const h = await xeroHeaders();
const po = (await (await fetch(`${X}PurchaseOrders/${PO_ID}`, { headers: h })).json()).PurchaseOrders[0];
const lines = po.LineItems.map((l) => {
  const o = { Description: l.Description, Quantity: l.Quantity, UnitAmount: l.UnitAmount, AccountCode: l.AccountCode, TaxType: l.TaxType, ...(l.ItemCode ? { ItemCode: l.ItemCode } : {}) };
  if (/VEY-Q2/.test(l.Description)) { o.Quantity = 2; o.UnitAmount = PRICE; o.Description = DESC; }
  return o;
});
console.log(lines.map((l) => `${l.Quantity} × ${l.UnitAmount} ${l.Description}`).join("\n"));
if (!write) { console.log("dry run"); process.exit(0); }
await db.from("quote_products").update({ name: NAME, cost_price: PRICE, markup: 0, notes: `${NAME} — Suprema XPQ2-DPB (PoE) supplied by Veyla at $634.33 ex (Mitchell 27 Oct 2026), the old Datalogic PFRRK kit price; no Centrefit margin. ${p.notes ?? ""}` }).eq("id", VEYQ2).throwOnError();
const { data: p2 } = await db.from("quote_products").select("name,cost_price,markup,sell_price").eq("id", VEYQ2).single();
console.log("✅ VEY-Q2", JSON.stringify(p2));
const r = await fetch(`${X}PurchaseOrders/${PO_ID}`, { method: "POST", headers: h, body: JSON.stringify({ PurchaseOrders: [{ PurchaseOrderID: PO_ID, LineItems: lines }] }) });
const j = await r.json();
if (!r.ok) { console.error("Xero", r.status, JSON.stringify(j).slice(0, 800)); process.exit(1); }
const q = j.PurchaseOrders[0];
console.log(`✅ Xero ${q.PurchaseOrderNumber} ${q.Status} subtotal ${q.SubTotal} total ${q.Total}`);
