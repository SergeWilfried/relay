-- Named back-office accounts, an append-only audit log, and two-person approval of payouts.
-- Each person has their own API key (stored only as a SHA-256 hash). ADMIN_API_KEY (an env secret) remains as the "root" key
-- that can manage this team and read, but cannot move money.
CREATE TABLE IF NOT EXISTS admins (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- e.g. an email; this is the name shown in refunds, payouts and the audit log
  role         TEXT NOT NULL CHECK (role IN ('viewer', 'operator', 'owner')),
  key_hash     TEXT NOT NULL UNIQUE,
  active       INTEGER NOT NULL DEFAULT 1,
  created_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  disabled_at  INTEGER,
  disabled_by  TEXT
);

-- Every state-changing admin call, allowed or refused. Append-only: the triggers refuse edits and deletes.
CREATE TABLE IF NOT EXISTS admin_audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      INTEGER NOT NULL,
  actor   TEXT NOT NULL,
  role    TEXT NOT NULL,
  method  TEXT NOT NULL,
  path    TEXT NOT NULL,
  action  TEXT NOT NULL,       -- e.g. payouts.approve
  target  TEXT,                -- the payout / refund / user id it acted on
  status  INTEGER NOT NULL,    -- the HTTP status the caller got (403 = refused)
  ip      TEXT,
  details TEXT                 -- a whitelisted subset of the request (reason, note, outcome...), never keys
);
CREATE INDEX IF NOT EXISTS admin_audit_at ON admin_audit (at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_actor ON admin_audit (actor, at DESC);
CREATE TRIGGER IF NOT EXISTS admin_audit_no_update BEFORE UPDATE ON admin_audit BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS admin_audit_no_delete BEFORE DELETE ON admin_audit BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END;

-- Payouts: who approved (two different people when the amount reaches FOUR_EYES_MIN_FCFA), and who rejected.
ALTER TABLE payouts ADD COLUMN first_approver TEXT;
ALTER TABLE payouts ADD COLUMN first_approved_at INTEGER;
ALTER TABLE payouts ADD COLUMN approved_by TEXT;
ALTER TABLE payouts ADD COLUMN rejected_by TEXT;
