// Plain module (no "server-only", no "use client") so both the server page
// and the client row-actions can share the status vocabulary + template
// rendering without dragging server code into the browser bundle.

export type DdStatus =
  | "todo"
  | "invited"
  | "mandate_pending"
  | "dd_live"
  | "ri_retired"
  | "declined"
  | "excluded"
  | "already_dd"
  | "ri_gone";

export const DD_STATUS_LABEL: Record<DdStatus, string> = {
  todo: "To do",
  invited: "Invited",
  mandate_pending: "Awaiting mandate",
  dd_live: "DD live — retire RI",
  ri_retired: "Done",
  declined: "Declined",
  excluded: "Excluded",
  already_dd: "Already on DD",
  ri_gone: "RI removed",
};

export const DD_STATUS_COLOUR: Record<DdStatus, string> = {
  todo: "#94a3b8",
  invited: "#3b82f6",
  mandate_pending: "#fb923c",
  dd_live: "#ef4444",
  ri_retired: "#22c55e",
  declined: "#64748b",
  excluded: "#64748b",
  already_dd: "#0ea5e9",
  ri_gone: "#475569",
};

/** `{{key}}` interpolation for the invitation template. Unknown keys → "". */
export function renderDdTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => vars[k] ?? "");
}

export const DD_TEMPLATE_PLACEHOLDERS: Array<{ key: string; meaning: string }> = [
  { key: "site_name", meaning: "Site / business name as invoiced" },
  { key: "contact_name", meaning: "Owner or billing contact name" },
  { key: "services", meaning: "Bulleted list of the recurring services" },
  { key: "monthly_value", meaning: "Current monthly total incl. GST (number only)" },
  { key: "signup_link", meaning: "Fresh GoCardless signup link (7-day expiry)" },
  { key: "sender_name", meaning: "Your name" },
];
