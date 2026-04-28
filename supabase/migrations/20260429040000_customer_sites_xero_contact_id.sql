-- Per-site Xero contact mapping. Previously xero_contact_id lived only on
-- customers, which forced every site of a multi-site customer to bill against
-- the same Xero contact — site addresses got lost on the invoice. Each site
-- now gets its own Xero contact (named "<customer> — <site>") with its own
-- billing address attached.

ALTER TABLE customer_sites
  ADD COLUMN IF NOT EXISTS xero_contact_id text;

CREATE INDEX IF NOT EXISTS customer_sites_xero_contact_id_idx
  ON customer_sites(xero_contact_id) WHERE xero_contact_id IS NOT NULL;

COMMENT ON COLUMN customer_sites.xero_contact_id IS
  'Xero ContactID for this specific site/facility. NULL until first invoice / repeating invoice is created — populated lazily by findOrCreateContact(). For single-site customers we still write here too rather than to customers.xero_contact_id, so the model is consistent.';
