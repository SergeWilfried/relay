import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buyQuote, NETWORK_FEE_FCFA, PLATFORM_FEE, PSP_FEE, sellQuote, TOTAL_FEE } from '../worker/pricing.ts';
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
  assert.equal(client.NETWORK_FEE_FCFA, NETWORK_FEE_FCFA);
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

test('buy: 5% fees and the network fee come off, the rest buys crypto at the rate, rounded down', () => {
  const q = buyQuote('USDT', 600_000, 6); // 600 000 FCFA at 600 FCFA per USDT
  assert.deepEqual([q.platformFeeFcfa, q.pspFeeFcfa, q.networkFeeFcfa], [15_000, 15_000, 710]);
  // (600 000 - 15 000 - 15 000 - 710) = 569 290 FCFA / 600 = 948.816666... USDT, rounded down to the base unit
  assert.equal(q.amountUnits, 948_816_666n);
});

test('buy: the customer never receives more than they paid for, for any amount (and tiny amounts buy nothing)', () => {
  for (const [asset, dec, fcfa] of [['ETH', 18, 150_000], ['SOL', 9, 99_900], ['USDC', 6, 1_000], ['ETH', 18, 2_000_000]] as const) {
    const q = buyQuote(asset, fcfa, dec);
    assert.ok(q.platformFeeFcfa >= 0 && q.pspFeeFcfa >= 0);
    assert.ok(q.platformFeeFcfa + q.pspFeeFcfa === Math.round(fcfa * 0.05), `${asset} ${fcfa}`);
    assert.ok(q.amountUnits > 0n, `${asset} ${fcfa}`);
  }
  assert.equal(buyQuote('USDT', 500, 6).amountUnits, 0n);
});

test('buy: ETH is exact to the base unit, with no floating point error', () => {
  // 1 740 116 FCFA - 5% (87 006) - 710 network = 1 652 400 FCFA = exactly one ETH at the placeholder rate
  assert.equal(buyQuote('ETH', 1_740_116, 18).amountUnits, 1_000_000_000_000_000_000n);
});
