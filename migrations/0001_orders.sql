-- Server-side sell orders. Status flow: awaiting_deposit -> processing (deposit confirmed by webhook)
-- or underpaid (deposit smaller than the order). Settlement/payout statuses are added later.
CREATE TABLE IF NOT EXISTS orders (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL,
  tab                  TEXT NOT NULL,
  asset                TEXT NOT NULL,          -- ETH | USDT | USDC | SOL
  network              TEXT NOT NULL,
  amount               TEXT NOT NULL,          -- decimal string the user asked to sell
  amount_units         TEXT NOT NULL,          -- same, in base units (wei/lamports/token units), for exact comparison
  provider_id          TEXT,
  deposit_address      TEXT NOT NULL,          -- normalised (lowercase for EVM)
  deposit_wallet_id    TEXT,
  deposit_live         INTEGER NOT NULL DEFAULT 0,
  status               TEXT NOT NULL,
  deposit_tx           TEXT,
  deposit_amount_units TEXT,
  note                 TEXT,
  expires_at           INTEGER NOT NULL,       -- ms; late deposits are still honoured (and flagged)
  started_at           INTEGER,                -- ms; when the deposit was confirmed
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS orders_deposit_address ON orders (deposit_address);
CREATE INDEX IF NOT EXISTS orders_user ON orders (user_id, created_at DESC);
