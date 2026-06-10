// Inspect Mitchell's "Direct Debiting 240426.xlsx" — sheet names, headers,
// and all rows as JSON for the billing reconciliation.
import { writeFileSync } from "node:fs";
import xlsx from "xlsx";

const wb = xlsx.readFile("C:/Users/mitch/Downloads/Direct Debiting 240426.xlsx");
console.log("Sheets:", wb.SheetNames.join(" | "));

const out = {};
for (const name of wb.SheetNames) {
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null });
  out[name] = rows;
  console.log(`\n=== ${name} — ${rows.length} rows ===`);
  for (const r of rows.slice(0, 8)) console.log(JSON.stringify(r).slice(0, 220));
}
writeFileSync(new URL("./dd-sheet-output.json", import.meta.url), JSON.stringify(out, null, 1));
console.log("\nSaved full dump to scripts/dd-sheet-output.json");
