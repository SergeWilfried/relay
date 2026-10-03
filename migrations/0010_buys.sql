-- Buy orders: the customer pays FCFA by mobile money (collected through the payment provider) and receives crypto.
-- Relay holds no treasury key, so the crypto is SENT by a person from the treasury once the payment is collected,
-- and recorded here with the transaction hash (same model as refunds).
-- Status flow: created -> collecting -> collected -> delivered ; collecting -> failed ; created -> expired | cancelled
CREATE TABLE IF NOT EXISTS buy_orders (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  asset             TEXT NOT NULL,            -- ETH | USDT | USDC | SOL (what the customer receives)
  network           TEXT NOT NULL,
  fcfa              INTEGER NOT NULL,         -- what the customer pays
  platform_fee_fcfa INTEGER NOT NULL,
  psp_fee_fcfa      INTEGER NOT NULL,
  network_fee_fcfa  INTEGER NOT NULL,
  amount_units      TEXT NOT NULL,            -- crypto to deliver, in base units, fixed when the order is created
  destination       TEXT NOT NULL,            -- the customer's wallet (normalised)
  operator          TEXT NOT NULL,
  provider_code     TEXT NOT NULL,            -- e.g. ORANGE_CIV
  phone             TEXT NOT NULL,            -- payer, E.164
  status            TEXT NOT NULL,
  auth_type         TEXT,                     -- PROVIDER_AUTH | REDIRECT_AUTH | PREAUTH, from the provider's configuration
  deposit_id        TEXT,                     -- the payment provider's id (a UUID derived from the order id)
  next_step         TEXT,
  auth_url          TEXT,                     -- REDIRECT_AUTH: where to send the customer
  failure           TEXT,                     -- what the customer may see
  failure_detail    TEXT,                     -- for logs and support only
  last_checked_at   INTEGER,
  collecting_at     INTEGER,
  collected_at      INTEGER,
  delivered_at      INTEGER,
  delivered_by      TEXT,
  tx_hash           TEXT,
  hold_rules        TEXT,                     -- same hold semantics as sell orders: delivery waits until released
  hold_message      TEXT,
  hold_until        INTEGER,
  hold_released_at  INTEGER,
  expires_at        INTEGER NOT NULL,         -- the customer's window to start paying
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS buy_orders_user ON buy_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS buy_orders_status ON buy_orders (status, created_at);

CREATE TABLE IF NOT EXISTS buy_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  buy_id     TEXT NOT NULL,
  action     TEXT NOT NULL,                   -- released | delivered | ...
  by_name    TEXT NOT NULL,
  note       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS buy_events_buy ON buy_events (buy_id, id);
