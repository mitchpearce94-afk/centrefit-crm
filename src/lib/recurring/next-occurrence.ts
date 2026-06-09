/**
 * recurring_plans.next_invoice_date is written once at activation (the
 * monthly schedule's start date) and never advanced — Xero and GoCardless
 * own the live schedule, so the stored value goes stale after the first
 * cycle. For display, roll the anchor forward a calendar month at a time
 * until it lands on or after today, clamping to month-end so an anchor on
 * the 31st shows the 30th/28th in shorter months.
 */
export function nextMonthlyOccurrence(anchorIso: string, today = new Date()): Date {
  const [y, m, d] = anchorIso.slice(0, 10).split("-").map(Number);
  const anchor = new Date(y, m - 1, d);
  const floor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (anchor >= floor) return anchor;

  const elapsed =
    (floor.getFullYear() - anchor.getFullYear()) * 12 +
    (floor.getMonth() - anchor.getMonth());
  let candidate = addMonthsClamped(anchor, elapsed, d);
  if (candidate < floor) candidate = addMonthsClamped(anchor, elapsed + 1, d);
  return candidate;
}

function addMonthsClamped(anchor: Date, months: number, dayOfMonth: number): Date {
  const result = new Date(anchor.getFullYear(), anchor.getMonth() + months, 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(dayOfMonth, lastDay));
  return result;
}
