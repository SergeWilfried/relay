-- Mobile money payouts. One payout per order (UNIQUE order_id), created when the deposit is confirmed.
-- Status flow: pending_approval -> approved -> sending -> paid | failed ; pending_approval -> rejected.
-- 'sending' also holds ambiguous outcomes (provider call errored); those are resolved by a human, never auto-retried.
ALTER TABLE orders ADD COLUMN phone TEXT;      -- E.164, e.g. +2250789458900
ALTER TABLE orders ADD COLUMN operator TEXT;   -- orange | wave | mtn | moov

CREATE TABLE IF NOT EXISTS payouts (
  id            TEXT PRIMARY KEY,              -- also the idempotency reference sent to the provider
  order_id      TEXT NOT NULL UNIQUE,
  user_id       TEXT NOT NULL,
  provider      TEXT NOT NULL,
  phone         TEXT,
  operator      TEXT,
  amount_fcfa   INTEGER NOT NULL,
  status        TEXT NOT NULL,
  provider_ref  TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  approved_at   INTEGER,
  paid_at       INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS payouts_status ON payouts (status, created_at);
