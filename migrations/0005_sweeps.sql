-- Sweeps: after a deposit is confirmed, the funds in the order's deposit wallet are forwarded to the treasury.
-- One sweep per order (PRIMARY KEY order_id), so the same deposit can't be forwarded twice.
-- Status flow: pending -> sending -> submitted | failed | unknown
--   failed   = the request was definitively refused (policy violation, validation): a person fixes it and retries.
--   unknown  = the outcome is ambiguous (network error / 5xx): funds may have moved. NEVER retried automatically;
--              a person checks the chain and resolves it.
CREATE TABLE IF NOT EXISTS sweeps (
  order_id     TEXT PRIMARY KEY,
  wallet_id    TEXT,                      -- Privy wallet id (NULL for sandbox orders)
  chain        TEXT NOT NULL,             -- ethereum | solana
  asset        TEXT NOT NULL,
  amount_units TEXT NOT NULL,             -- base units swept
  status       TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  tx_hash      TEXT,
  tx_id        TEXT,                      -- Privy transaction id (the hash can be empty for sponsored transactions until confirmed)
  error        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sweeps_status ON sweeps (status, created_at);
