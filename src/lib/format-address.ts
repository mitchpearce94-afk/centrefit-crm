/**
 * Formats a stored AU address string for customer-facing documents.
 *
 * Site addresses are entered free-hand and stored raw, so they arrive like
 * "unit 4/8 Breese Parade,, Forster, NSW, 2428". This normalises at display
 * time (no data migration needed): drops empty comma segments, capitalises a
 * leading unit/shop/lot prefix, and re-joins the suburb/state/postcode tail
 * per AU convention — "Unit 4/8 Breese Parade, Forster NSW 2428".
 */

const AU_STATES = new Set(["NSW", "QLD", "VIC", "SA", "WA", "TAS", "NT", "ACT"]);

export function formatAuAddress(raw: string | null | undefined): string {
  if (!raw) return "";
  const parts = raw.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return "";

  parts[0] = parts[0].replace(
    /^(unit|shop|lot|level|suite|tenancy)\b/i,
    (w) => w[0].toUpperCase() + w.slice(1).toLowerCase(),
  );

  // Pull a state token and a 4-digit postcode out of the trailing segments.
  let state = "";
  let postcode = "";
  for (let i = parts.length - 1; i >= 0 && i >= parts.length - 3; i--) {
    const t = parts[i];
    if (!postcode && /^\d{4}$/.test(t)) {
      postcode = t;
      parts.splice(i, 1);
    } else if (!state && AU_STATES.has(t.toUpperCase())) {
      state = t.toUpperCase();
      parts.splice(i, 1);
    }
  }
  if (!state && !postcode) return parts.join(", ");

  const tailBits = [state, postcode].filter(Boolean).join(" ");
  // Fold the suburb (last remaining part) into the tail: "Forster NSW 2428".
  if (parts.length >= 2) {
    const suburb = parts.pop();
    return `${parts.join(", ")}, ${suburb} ${tailBits}`;
  }
  return parts.length === 1 ? `${parts[0]}, ${tailBits}` : tailBits;
}
