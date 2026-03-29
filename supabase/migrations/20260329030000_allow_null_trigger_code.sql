-- Allow NULL trigger_code for "always" rules (no device trigger needed)
ALTER TABLE quote_dependency_rules ALTER COLUMN trigger_code DROP NOT NULL;
