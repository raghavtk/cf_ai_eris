ALTER TABLE ai_requests ADD COLUMN model TEXT;

-- Earlier development builds temporarily stored prompt excerpts in input_ref.
-- Telemetry is metadata-only now, so remove any existing prompt content.
UPDATE ai_requests SET input_ref = NULL WHERE input_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_requests_kind_created_at ON ai_requests(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_requests_status ON ai_requests(status);
