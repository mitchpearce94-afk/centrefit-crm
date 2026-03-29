-- Add supplier_id FK to quote_products (replace free-text supplier field)
ALTER TABLE quote_products ADD COLUMN supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

-- Backfill supplier_id from text match on supplier name
UPDATE quote_products qp
SET supplier_id = s.id
FROM suppliers s
WHERE LOWER(TRIM(qp.supplier)) = LOWER(TRIM(s.name));

-- Create index for lookups
CREATE INDEX idx_quote_products_supplier_id ON quote_products(supplier_id);
