import "server-only";

/**
 * Generate an `+alias` email per site for GoCardless customer creation.
 *
 * Pattern: `local+slug@domain.tld` where `slug` is a sanitised version of
 * the site name. This is what powers the multi-site → single inbox flow
 * — the customer gets every signup email in their normal inbox, but each
 * mandate has a unique email that maps cleanly to a unique Xero contact.
 *
 * Slug rules: lowercase, alphanumeric only, dashes between word boundaries,
 * collapsed runs, max 32 chars. A short hash is appended if the slug is
 * empty (defensive — shouldn't happen in practice but a numeric fallback
 * stops the alias becoming `local+@domain.tld`).
 */
export function aliasEmail(baseEmail: string, siteLabel: string, fallback?: string): string {
  const at = baseEmail.lastIndexOf("@");
  if (at <= 0) throw new Error(`Cannot alias invalid email: ${baseEmail}`);
  const local = baseEmail.slice(0, at);
  const domain = baseEmail.slice(at + 1);

  // If local already contains a +, drop the existing tag — users sometimes
  // give you "billing+old@example.com"; we want our slug to be the only tag.
  const cleanLocal = local.split("+")[0];

  let slug = siteLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  if (!slug && fallback) slug = fallback.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  if (!slug) slug = "site";

  return `${cleanLocal}+${slug}@${domain}`;
}
