export interface XeroAccountOption {
  code: string;
  name: string;
}

// Centrefit's sales account codes in Xero. Hardcoded — there's no live sync
// from Xero's chart of accounts. If Mark/the bookkeeper adds a new sales
// account, add it here too. Skipped codes (210-214) are intentional: they
// don't exist in the chart.
export const XERO_SALES_ACCOUNTS: XeroAccountOption[] = [
  { code: "200", name: "Sales" },
  { code: "201", name: "Sales - Callout Fee" },
  { code: "202", name: "Sales - IT Service" },
  { code: "203", name: "Sales - IT Install" },
  { code: "204", name: "Sales - NBN" },
  { code: "205", name: "Sales - B2B Alarm Monitoring Quarterly" },
  { code: "206", name: "Sales - Parts" },
  { code: "207", name: "Sales - Sim" },
  { code: "208", name: "Sales - My Alarm" },
  { code: "209", name: "Sales - B2B Alarm Monitoring Monthly" },
  { code: "215", name: "Sales - Freight (charged to customer)" },
  { code: "216", name: "Sales - Security Patrol" },
  { code: "220", name: "Sales - Refund" },
  { code: "221", name: "Sales - Security" },
];

export interface XeroTaxTypeOption {
  code: string;
  label: string;
}

export const XERO_OUTPUT_TAX_TYPES: XeroTaxTypeOption[] = [
  { code: "OUTPUT", label: "GST on Income (10%)" },
  { code: "EXEMPTOUTPUT", label: "GST Free Income" },
  { code: "BASEXCLUDED", label: "No GST (out of scope)" },
];

export function accountCodeLabel(code: string | null | undefined): string {
  if (!code) return "—";
  const match = XERO_SALES_ACCOUNTS.find((a) => a.code === code);
  return match ? `${match.code} · ${match.name}` : code;
}

export function isKnownAccountCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return XERO_SALES_ACCOUNTS.some((a) => a.code === code);
}
