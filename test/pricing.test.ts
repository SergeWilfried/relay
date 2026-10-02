import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLATFORM_FEE, PSP_FEE, sellQuote, TOTAL_FEE } from '../worker/pricing.ts';
import * as client from '../src/lib/fees.ts';

test('the fee is 2.5% platform + 2.5% PSP = 5%', () => {
  assert.equal(PLATFORM_FEE, 0.025);
  assert.equal(PSP_FEE, 0.025);
  assert.equal(TOTAL_FEE, 0.05);
});

test('the app and the server charge the same fees', () => {
  assert.equal(client.PLATFORM_FEE, PLATFORM_FEE);
  assert.equal(client.PSP_FEE, PSP_FEE);
  assert.equal(client.TOTAL_FEE, TOTAL_FEE);
});

test('payout + platform fee + PSP fee always equals the gross value, to the franc', () => {
  for (const [asset, amount] of [['ETH', '1.5'], ['ETH', '0.0037'], ['USDT', '123.45'], ['USDC', '1'], ['SOL', '12.3456789'], ['USDT', '0.01']] as const) {
    const q = sellQuote(asset, amount);
    assert.equal(q.payoutFcfa + q.platformFeeFcfa + q.pspFeeFcfa, q.grossFcfa, `${amount} ${asset}`);
    assert.ok(q.payoutFcfa % 100 === 0, 'payout is whole 100 FCFA');
    assert.ok(q.platformFeeFcfa >= 0 && q.pspFeeFcfa >= 0);
  }
});

test('a round example: 1 000 USDT = 600 000 FCFA pays out 570 000 and splits 15 000 / 15 000', () => {
  assert.deepEqual(sellQuote('USDT', '1000'), { grossFcfa: 600_000, payoutFcfa: 570_000, pspFeeFcfa: 15_000, platformFeeFcfa: 15_000 });
});

test('the customer gets 95% of the value, rounded down by less than 100 FCFA, never more', () => {
  for (const [a, n] of [['ETH', '2'], ['USDC', '1'], ['USDT', '7.77']] as const) {
    const q = sellQuote(a, n);
    assert.ok(q.payoutFcfa <= q.grossFcfa * 0.95 + 1e-6);
    assert.ok(q.grossFcfa * 0.95 - q.payoutFcfa < 100);
  }
});

test('the app rounds the payout down like the server', () => assert.equal(client.floor100(569.9), 500));

test('an unknown asset is refused', () => assert.throws(() => sellQuote('DOGE', '1')));
