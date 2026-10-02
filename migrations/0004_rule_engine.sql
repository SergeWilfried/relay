-- Rule engine v2 (see worker/rules.ts): per-user profile/status, payout holds, richer decision log.
CREATE TABLE IF NOT EXISTS user_profile (
  user_id       TEXT PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,           -- first time this user called the API (account age for D-03)
  last_country  TEXT,                       -- country of the previous request (D-01)
  status        TEXT NOT NULL DEFAULT 'normal',  -- normal | restricted (P-06) | frozen (P-07)
  status_note   TEXT,
  updated_at    INTEGER NOT NULL
);

-- A hold is active while hold_rules IS NOT NULL AND hold_released_at IS NULL AND (hold_until IS NULL OR now < hold_until).
-- hold_until NULL = until an analyst releases it.
ALTER TABLE orders ADD COLUMN hold_rules TEXT;          -- JSON array of the rule ids that put the payout on hold
ALTER TABLE orders ADD COLUMN hold_message TEXT;        -- what the user is told
ALTER TABLE orders ADD COLUMN hold_until INTEGER;
ALTER TABLE orders ADD COLUMN hold_released_at INTEGER;

-- decisions.decision is now allow | hold | deny. fired = every rule that matched, with version, mode and whether it applied
-- (shadow rules are logged but not applied); facts = the inputs the rules saw.
ALTER TABLE decisions ADD COLUMN fired TEXT;
ALTER TABLE decisions ADD COLUMN facts TEXT;
ALTER TABLE decisions ADD COLUMN message TEXT;
ALTER TABLE decisions ADD COLUMN tier INTEGER;
