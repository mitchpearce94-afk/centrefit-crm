-- Add email tracking columns to quotes
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sent_to_email TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS response_token TEXT UNIQUE;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;

-- Index for token lookups (public endpoint)
CREATE INDEX IF NOT EXISTS idx_quotes_response_token ON quotes(response_token) WHERE response_token IS NOT NULL;

-- Allow public (anon) access to respond to quotes via token
CREATE POLICY "anon_respond_to_quotes" ON quotes
  FOR UPDATE TO anon
  USING (response_token IS NOT NULL)
  WITH CHECK (response_token IS NOT NULL);

CREATE POLICY "anon_read_quote_by_token" ON quotes
  FOR SELECT TO anon
  USING (response_token IS NOT NULL);
