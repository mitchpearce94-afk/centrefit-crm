-- quote_products: extra fields for richer product metadata used by
-- quoting (description, default_quantity), labour engine wiring
-- (labour_code → labour_timings.code), and staff-only context
-- (internal_notes).

ALTER TABLE quote_products
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS default_quantity integer NOT NULL DEFAULT 1 CHECK (default_quantity >= 1),
  ADD COLUMN IF NOT EXISTS internal_notes text,
  ADD COLUMN IF NOT EXISTS labour_code text;

COMMENT ON COLUMN quote_products.description IS 'Customer-facing description rendered on quote line items and SoW.';
COMMENT ON COLUMN quote_products.default_quantity IS 'Default quantity when added to a BOM (e.g. cable boxes of 305m).';
COMMENT ON COLUMN quote_products.internal_notes IS 'Staff-only notes (stock issues, discontinued, alternatives).';
COMMENT ON COLUMN quote_products.labour_code IS 'Soft FK to labour_timings.code — links a product to a labour timing entry for fit-off minutes.';
