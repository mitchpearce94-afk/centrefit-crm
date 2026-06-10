// Package the reconciliation buckets into an xlsx in Downloads.
import { readFileSync } from "node:fs";
import xlsx from "xlsx";

// Re-run the same logic quickly by importing the report's source data is
// overkill — billing-recon.mjs already wrote recon-report.md; parse its
// tables back into sheets.
const md = readFileSync(new URL("./recon-report.md", import.meta.url), "utf8");

function parseSection(heading) {
  const idx = md.indexOf(heading);
  if (idx === -1) return [];
  let after = md.slice(idx);
  const next = after.indexOf("\n## ", 4);
  if (next !== -1) after = after.slice(0, next);
  const lines = after.split("\n").filter((l) => l.startsWith("|"));
  if (lines.length < 2) return [];
  const headers = lines[0].split("|").map((s) => s.trim()).filter(Boolean);
  return lines.slice(2).map((l) => {
    const cells = l.split("|").map((s) => s.trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i + 1] ?? ""; });
    return row;
  });
}

const wb = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(parseSection("## ❌ UNBILLED")), "UNBILLED");
xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(parseSection("## ⚠ Billed via Xero RI only")), "Xero only (no DD)");
xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(parseSection("## ✅ Billed via DD plan")), "DD billed");
xlsx.writeFile(wb, "C:/Users/mitch/Downloads/Billing Reconciliation 2026-06-11.xlsx");
console.log("Wrote C:/Users/mitch/Downloads/Billing Reconciliation 2026-06-11.xlsx");
