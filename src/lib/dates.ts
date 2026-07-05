/**
 * Brisbane business dates.
 *
 * `toISOString()` is ALWAYS UTC — in serverless (UTC) and in the browser
 * alike — so `new Date().toISOString().split("T")[0]` says *yesterday*
 * between midnight and 10am AEST. That put the dashboard a day behind and
 * made the 9am invoice-reminder cron (11pm UTC the previous day) chase one
 * day late, permanently. Every "what date is it" in business logic goes
 * through here instead. Round-tripping a date-only string
 * (new Date("2026-07-06") → UTC midnight → 10am Brisbane) formats to the
 * same date, so this is safe for derived dates too.
 */
export function brisbaneDateISO(d: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(d);
}

/** Brisbane date N days from the given date (default: from now). */
export function brisbaneDateISOPlusDays(days: number, from: Date = new Date()): string {
  return brisbaneDateISO(new Date(from.getTime() + days * 86_400_000));
}
