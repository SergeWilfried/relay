-- Crypto refunds for sell orders that can't be paid out (failed or rejected payout, deposit smaller than the order).
-- One refund per order (UNIQUE order_id). Status flow: requested -> approved -> sent, or cancelled from requested/approved.
-- Relay holds no treasury key: the refund is SENT by a person from the treasury; Relay controls and records it.
CREATE TABLE IF NOT EXISTS refunds (
  id            TEXT PRIMARY KEY,           -- 'rf' || order id
  order_id      TEXT NOT NULL UNIQUE,
  user_id       TEXT NOT NULL,
  asset         TEXT NOT NULL,
  network       TEXT NOT NULL,
  amount_units  TEXT NOT NULL,              -- base units to return (never more than was deposited)
  destination   TEXT NOT NULL,              -- normalised address the funds go back to
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL,              -- requested | approved | sent | cancelled
  requested_by  TEXT NOT NULL,
  approved_by   TEXT,
  tx_hash       TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS refunds_status ON refunds (status, created_at);

-- Who did what, and when (the names are self-declared by the admin: an audit aid, not authentication)
CREATE TABLE IF NOT EXISTS refund_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_id  TEXT NOT NULL,
  action     TEXT NOT NULL,                 -- requested | approved | sent | cancelled
  by_name    TEXT NOT NULL,
  note       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS refund_events_refund ON refund_events (refund_id, id);
