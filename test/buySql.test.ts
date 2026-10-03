import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { INSERT_BUY_SQL } from '../worker/buySql.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 3, 12);
const DAY_START = Date.UTC(2026, 9, 3);
const MONTH_START = Date.UTC(2026, 9, 1);

function db() {
  const d = new DatabaseSync(':memory:');
  d.exec(`CREATE TABLE orders (id TEXT, user_id TEXT, amount_fcfa INTEGER, status TEXT, expires_at INTEGER, created_at INTEGER);
    CREATE TABLE payouts (order_id TEXT, status TEXT);
    CREATE TABLE buy_orders (id TEXT PRIMARY KEY, user_id TEXT, asset TEXT, network TEXT, fcfa INTEGER, platform_fee_fcfa INTEGER, psp_fee_fcfa INTEGER, network_fee_fcfa INTEGER, amount_units TEXT, destination TEXT,
      operator TEXT, provider_code TEXT, phone TEXT, status TEXT, auth_type TEXT, hold_rules TEXT, hold_message TEXT, hold_until INTEGER, expires_at INTEGER, created_at INTEGER, updated_at INTEGER);`);
  return d;
}
const sell = (d: DatabaseSync, id: string, fcfa: number, over: { status?: string; expires?: number; created?: number; user?: string; payout?: string } = {}) => {
  d.prepare('INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?)').run(id, over.user ?? 'u1', fcfa, over.status ?? 'processing', over.expires ?? NOW + DAY, over.created ?? NOW - 1000);
  if (over.payout) d.prepare('INSERT INTO payouts VALUES (?, ?)').run(id, over.payout);
};
const buy = (d: DatabaseSync, id: string, fcfa: number, status: string, over: { expires?: number; created?: number; user?: string } = {}) =>
  d.prepare(`INSERT INTO buy_orders (id, user_id, fcfa, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(id, over.user ?? 'u1', fcfa, status, over.expires ?? NOW + DAY, over.created ?? NOW - 1000);
/** tries to create a buy of `fcfa` for u1 with the standard limits (2M a day, 10M a month); returns whether it was created */
const tryBuy = (d: DatabaseSync, id: string, fcfa: number, user = 'u1') => {
  const r = d.prepare(INSERT_BUY_SQL).run(user, NOW, DAY_START, MONTH_START, fcfa, 2_000_000, 10_000_000, id, 'USDT', 'Ethereum', 1, 1, 710, '1', '0xabc', 'orange', 'ORANGE_CIV', '+2250700000001', 'PROVIDER_AUTH', null, null, null, NOW + 900_000);
  return Number(r.changes) === 1;
};

test('a buy within the limits is created, with status created', () => {
  const d = db();
  assert.equal(tryBuy(d, 'b1', 500_000), true);
  assert.equal((d.prepare('SELECT status FROM buy_orders WHERE id = ?').get('b1') as { status: string }).status, 'created');
});

test('the daily limit counts sells AND buys together', () => {
  const d = db();
  sell(d, 's1', 1_200_000);
  buy(d, 'b0', 500_000, 'collecting');
  assert.equal(tryBuy(d, 'b1', 300_000), true, '1.2M + 0.5M + 0.3M = 2.0M fits exactly');
  assert.equal(tryBuy(d, 'b2', 1), false, 'one franc more does not');
});

test('the monthly limit counts both too, over earlier days of the month', () => {
  const d = db();
  sell(d, 's1', 6_000_000, { created: MONTH_START + DAY });
  buy(d, 'b0', 3_500_000, 'collected', { created: MONTH_START + DAY + DAY / 2 }); // yesterday, not today
  assert.equal(tryBuy(d, 'b1', 500_000), true, '9.5M + 0.5M = 10M');
  assert.equal(tryBuy(d, 'b2', 1_000), false);
});

test('failed, expired and cancelled buys, and unpaid ones past their window, do not count', () => {
  const d = db();
  buy(d, 'f', 900_000, 'failed'); buy(d, 'e', 900_000, 'expired'); buy(d, 'c', 900_000, 'cancelled');
  buy(d, 'stale', 900_000, 'created', { expires: NOW - 1 });
  assert.equal(tryBuy(d, 'b1', 2_000_000), true);
});

test('a created buy still inside its window DOES count (it can still be paid)', () => {
  const d = db();
  buy(d, 'live', 1_500_000, 'created');
  assert.equal(tryBuy(d, 'b1', 600_000), false);
});

test('rejected and failed payouts of sells do not count, and other users are independent', () => {
  const d = db();
  sell(d, 's1', 1_900_000, { payout: 'rejected' });
  sell(d, 's2', 1_900_000, { user: 'u2' });
  assert.equal(tryBuy(d, 'b1', 2_000_000), true);
  assert.equal(tryBuy(d, 'b2', 100_000, 'u3'), true);
});
