-- Clef (Cloudflare Workers AI decision model) integration. Clef only ADVISES: it never signs, moves funds, blocks or freezes.
-- clef_calls = the audit trail the matrix asks for (point, question schema, state, probabilities, model, tokens).
CREATE TABLE IF NOT EXISTS clef_calls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  point       TEXT NOT NULL,            -- C-04 | C-05
  point_ver   INTEGER NOT NULL,
  mode        TEXT NOT NULL,            -- shadow | enforce, as it was when the call was made
  subject     TEXT,                     -- user id or alert title
  model       TEXT,
  questions   TEXT NOT NULL,            -- JSON schema sent
  state       TEXT NOT NULL,            -- JSON state sent (ids, amounts and counts only: no phone numbers)
  answers     TEXT,                     -- JSON as returned (NULL when the call failed)
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms  INTEGER,
  error       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS clef_calls_point ON clef_calls (point, created_at DESC);
CREATE INDEX IF NOT EXISTS clef_calls_subject ON clef_calls (subject, point, created_at DESC);

-- A user pattern flag set by C-04 (JSON: pattern, probability, at, callId). Rule D-11 holds payouts while it is set.
ALTER TABLE user_profile ADD COLUMN clef_flag TEXT;
