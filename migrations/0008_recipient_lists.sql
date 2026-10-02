-- Recipient denylist: payout phone numbers and blockchain addresses Relay must never pay or accept funds from.
-- Address entries are mirrored into a Privy condition set (privy_item_id) so user-wallet policies can deny transfers to them.
-- value is normalised: phone = +digits, EVM = lowercase 0x..., Solana = base58 as given.
CREATE TABLE IF NOT EXISTS recipient_lists (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  list          TEXT NOT NULL,              -- deny (an allow list is not enforced on the server: see README)
  kind          TEXT NOT NULL,              -- phone | evm | solana
  value         TEXT NOT NULL,
  note          TEXT NOT NULL,              -- why it is listed (sanctions hit, fraud report, ...)
  added_by      TEXT,
  created_at    INTEGER NOT NULL,
  privy_item_id TEXT,                       -- the item id in the Privy condition set, once synced (addresses only)
  UNIQUE (list, kind, value)
);
CREATE INDEX IF NOT EXISTS recipient_lists_lookup ON recipient_lists (list, kind, value);
