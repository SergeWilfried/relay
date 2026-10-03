-- Swaps: an on-chain swap between the customer's OWN wallets, executed by Privy's swap wallet action (signed by Relay's signer key,
-- which the customer authorised on their wallet). Relay never holds the funds: this table records the intent, the rule decision and the result.
-- Status flow: created -> submitted -> succeeded | failed | rejected ; created -> failed (refused or Privy declined before submitting)
CREATE TABLE IF NOT EXISTS swap_orders (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  wallet_id      TEXT NOT NULL,            -- the Privy wallet that holds the input token and signs
  from_asset     TEXT NOT NULL,
  to_asset       TEXT NOT NULL,
  input_units    TEXT NOT NULL,            -- base units of the input token
  cross_chain    INTEGER NOT NULL DEFAULT 0,
  slippage_bps   INTEGER NOT NULL,
  quoted_units   TEXT,                     -- estimated output when the swap was submitted
  min_units      TEXT,                     -- minimum output after slippage
  fcfa_value     INTEGER NOT NULL,         -- value of the input at the app's reference rate, for rules and reporting
  status         TEXT NOT NULL,
  action_id      TEXT,                     -- Privy's wallet action id
  tx_hash        TEXT,
  output_units   TEXT,                     -- what was actually received, after confirmation
  failure        TEXT,                     -- what the customer may see
  failure_detail TEXT,                     -- for logs and support only
  last_checked_at INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  completed_at   INTEGER
);
CREATE INDEX IF NOT EXISTS swap_orders_user ON swap_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS swap_orders_status ON swap_orders (status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS swap_orders_action ON swap_orders (action_id) WHERE action_id IS NOT NULL;
