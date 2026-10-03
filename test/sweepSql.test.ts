import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ENQUEUE_SWEEPS_SQL } from '../worker/sweepSql.ts';

function db() {
  const d = new DatabaseSync(':memory:');
  d.exec(`CREATE TABLE orders (id TEXT PRIMARY KEY, tab TEXT, status TEXT, network TEXT, asset TEXT, deposit_amount_units TEXT, deposit_live INTEGER, deposit_wallet_id TEXT, hold_rules TEXT, hold_released_at INTEGER);
    CREATE TABLE refunds (order_id TEXT, status TEXT);
    CREATE TABLE sweeps (order_id TEXT PRIMARY KEY, wallet_id TEXT, chain TEXT, asset TEXT, amount_units TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);`);
  return d;
}
type O = { id: string; status?: string; units?: string | null; live?: number; wallet?: string | null; hold?: string | null; released?: number | null; tab?: string; network?: string };
const add = (d: DatabaseSync, o: O) => d.prepare('INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(o.id, o.tab ?? 'sell', o.status ?? 'processing', o.network ?? 'Ethereum', 'USDT', o.units === undefined ? '100' : o.units, o.live ?? 0, o.wallet === undefined ? null : o.wallet, o.hold ?? null, o.released ?? null);
const queued = (d: DatabaseSync, live = 0) => { d.exec('DELETE FROM sweeps'); d.prepare(ENQUEUE_SWEEPS_SQL).run(1000, live); return (d.prepare('SELECT order_id FROM sweeps ORDER BY order_id').all() as { order_id: string }[]).map((r) => r.order_id); };

test('a normal processing order (NO hold at all) is queued: a NULL hold must not hide it', () => {
  const d = db(); add(d, { id: 'plain' });
  assert.deepEqual(queued(d), ['plain']);
});

test('an unreleased A-01 hold blocks the sweep; a released one, or another rule\'s hold, does not', () => {
  const d = db();
  add(d, { id: 'tainted', hold: '["A-01"]' });
  add(d, { id: 'released', hold: '["A-01"]', released: 5 });
  add(d, { id: 'other', hold: '["D-02"]' });
  assert.deepEqual(queued(d), ['other', 'released']);
});

test('underpaid deposits wait for an approved refund; wrong-asset deposits (no recorded amount) never queue', () => {
  const d = db();
  add(d, { id: 'under_none', status: 'underpaid' });
  add(d, { id: 'under_req', status: 'underpaid' }); d.prepare("INSERT INTO refunds VALUES ('under_req', 'requested')").run();
  add(d, { id: 'under_ok', status: 'underpaid' }); d.prepare("INSERT INTO refunds VALUES ('under_ok', 'approved')").run();
  add(d, { id: 'under_cancelled', status: 'underpaid' }); d.prepare("INSERT INTO refunds VALUES ('under_cancelled', 'cancelled')").run();
  add(d, { id: 'wrong_asset', status: 'underpaid', units: null }); d.prepare("INSERT INTO refunds VALUES ('wrong_asset', 'approved')").run();
  assert.deepEqual(queued(d), ['under_ok']);
});

test('only confirmed sell deposits: not buys, not orders still waiting for a deposit', () => {
  const d = db();
  add(d, { id: 'buy', tab: 'buy' }); add(d, { id: 'waiting', status: 'awaiting_deposit', units: null }); add(d, { id: 'sell' });
  assert.deepEqual(queued(d), ['sell']);
});

test('LIVE queues only orders with a real deposit wallet; sandbox mode only the others', () => {
  const d = db();
  add(d, { id: 'real', live: 1, wallet: 'w1' }); add(d, { id: 'fake', live: 0 });
  assert.deepEqual(queued(d, 1), ['real']);
  assert.deepEqual(queued(d, 0), ['fake', 'real']); // sandbox mode does not look at the wallet flag
});

test('queueing twice does not duplicate (one sweep per order)', () => {
  const d = db(); add(d, { id: 'once' });
  d.prepare(ENQUEUE_SWEEPS_SQL).run(1, 0); d.prepare(ENQUEUE_SWEEPS_SQL).run(2, 0);
  assert.equal((d.prepare('SELECT COUNT(*) AS n FROM sweeps').get() as { n: number }).n, 1);
});
