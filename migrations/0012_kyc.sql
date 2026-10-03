-- Identity verification (Sumsub). One row per user; the webhook is the source of truth.
CREATE TABLE IF NOT EXISTS kyc (
  user_id TEXT PRIMARY KEY,
  applicant_id TEXT,
  level TEXT NOT NULL,
  -- none: started, nothing submitted | pending: in review | approved | rejected (final) | retry (resubmit)
  status TEXT NOT NULL DEFAULT 'none',
  reject_type TEXT,
  reject_labels TEXT,
  first_name TEXT,
  last_name TEXT,
  country TEXT,
  -- Sumsub's event time (ms): an older webhook arriving late never overwrites a newer state
  event_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS kyc_status ON kyc (status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS kyc_applicant ON kyc (applicant_id) WHERE applicant_id IS NOT NULL;
