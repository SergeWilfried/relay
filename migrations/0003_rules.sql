-- Server-side rules: every order records its FCFA value (priced server-side) so per-user limits can be summed,
-- and every rule decision (allow or deny) is logged for audit.
ALTER TABLE orders ADD COLUMN amount_fcfa INTEGER;  -- NULL for orders created before this migration (not counted)
CREATE INDEX IF NOT EXISTS orders_user_fcfa ON orders (user_id, created_at);

CREATE TABLE IF NOT EXISTS decisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  order_id    TEXT NOT NULL,
  decision    TEXT NOT NULL,        -- allow | deny
  rules       TEXT NOT NULL,        -- JSON array of the rule ids that fired
  amount_fcfa INTEGER NOT NULL,
  country     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS decisions_user ON decisions (user_id, created_at DESC);
