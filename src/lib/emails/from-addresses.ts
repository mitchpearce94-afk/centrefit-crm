import "server-only";

/**
 * Canonical sender addresses for outbound CRM email. Centralised here so
 * we don't sprinkle hardcoded mailbox names through every send route —
 * if Centrefit ever splits sales@/accounts@ into different mailboxes or
 * domains, the change is one file.
 *
 * All addresses must be on a Resend-verified domain (centrefit.com.au is
 * verified live as of 2026-04-24).
 */

export const FROM_QUOTES = "Centrefit Sales <sales@centrefit.com.au>";
export const FROM_INVOICES = "Centrefit Accounts <accounts@centrefit.com.au>";
export const FROM_NO_REPLY = "Centrefit CRM <noreply@centrefit.com.au>";
export const REPLY_TO_ADMIN = "admin@centrefit.com.au";

/** Reply-to for accounts emails (invoices, payment reminders). */
export const REPLY_TO_ACCOUNTS = "accounts@centrefit.com.au";
/** Reply-to for sales emails (quotes, follow-ups, plans-to-electrician). */
export const REPLY_TO_SALES = "sales@centrefit.com.au";
