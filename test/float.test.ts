import assert from 'node:assert/strict';
import { test } from 'node:test';
import { floatReport, type BuyFlow, type PayoutFlow, type WalletBalance } from '../worker/float.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 3, 12);
const FLOOR = 2_000_000;
const wallets: WalletBalance[] = [
  { country: 'CIV', currency: 'XOF', balance: 5_000_000 }, { country: 'SEN', currency: 'XOF', balance: 10_000 },
  { country: 'BFA', currency: 'XOF', balance: 1_500_000, provider: 'MOOV_BFA' }, { country: 'BEN', currency: 'XOF', balance: 1 }, { country: 'KEN', currency: 'KES', balance: 1 },
];
const CI = '+2250700000001', SN = '+221770000001', BF = '+22670123456';
const payout = (phone: string | null, amount: number, status: string, ago = 0): PayoutFlow => ({ phone, amount_fcfa: amount, status, paid_at: status === 'paid' ? NOW - ago : null });
const report = (payouts: PayoutFlow[] = [], buys: BuyFlow[] = [], balances = wallets) => floatReport({ balances, payouts, buys, floor: FLOOR, now: NOW });
const row = (rows: ReturnType<typeof report>, c: string) => rows.find((r) => r.country === c)!;

test('only the countries Relay pays in are reported, with their balance and reserved provider', () => {
  const r = report();
  assert.deepEqual(r.map((x) => x.country), ['CIV', 'SEN', 'BFA']);
  assert.equal(row(r, 'CIV').balance, 5_000_000);
  assert.equal(row(r, 'BFA').provider, 'MOOV_BFA');
  assert.equal(row(r, 'CIV').provider, null);
});

test('status: ok above the floor, low below it, critical when empty or missing', () => {
  const r = report();
  assert.equal(row(r, 'CIV').status, 'ok');
  assert.equal(row(r, 'SEN').status, 'low');
  assert.equal(row(r, 'BFA').status, 'low');
  assert.equal(report([], [], [{ country: 'CIV', currency: 'XOF', balance: 0 }]).find((x) => x.country === 'CIV')!.status, 'critical');
  const missing = row(report([], [], []), 'CIV');
  assert.deepEqual([missing.status, missing.balance], ['critical', null]);
  assert.match(missing.reasons[0]!, /No XOF wallet/);
});

test('payouts waiting for approval or in flight are committed against the wallet of the RECIPIENT\'s country', () => {
  const r = report([payout(CI, 600_000, 'pending_approval'), payout(CI, 400_000, 'approved'), payout(SN, 5_000, 'sending'), payout(CI, 999, 'paid', 1000), payout(CI, 999, 'failed'), payout(BF, 7_000, 'rejected')]);
  assert.deepEqual([row(r, 'CIV').committedFcfa, row(r, 'CIV').committedCount], [1_000_000, 2]);
  assert.deepEqual([row(r, 'SEN').committedFcfa, row(r, 'SEN').committedCount], [5_000, 1]);
  assert.equal(row(r, 'BFA').committedCount, 0, 'a rejected payout holds no money');
});

test('critical when what is already waiting needs more than the wallet holds, even above the floor', () => {
  const r = report([payout(CI, 3_000_000, 'pending_approval'), payout(CI, 2_500_000, 'approved'), payout(CI, 70_000, 'paid', DAY)]);
  const c = row(r, 'CIV');
  assert.equal(c.status, 'critical');
  assert.match(c.reasons[0]!, /need more than the wallet holds/);
  assert.equal(c.coverDays, 0, 'never negative');
});

test('flow: paid out and collected in the last 24 hours, and the 7-day average pace', () => {
  const r = report(
    [payout(CI, 700_000, 'paid', 2 * 3_600_000), payout(CI, 1_400_000, 'paid', 3 * DAY), payout(CI, 5_000_000, 'paid', 9 * DAY)],
    [{ phone: CI, fcfa: 300_000, collected_at: NOW - 3_600_000 }, { phone: CI, fcfa: 900_000, collected_at: NOW - 2 * DAY }, { phone: SN, fcfa: 50_000, collected_at: NOW - 3_600_000 }],
  );
  const c = row(r, 'CIV');
  assert.equal(c.out24hFcfa, 700_000);
  assert.equal(c.in24hFcfa, 300_000, 'a purchase credits the PAYER\'s country wallet');
  assert.equal(c.avgDailyOutFcfa, Math.round((700_000 + 1_400_000) / 7), 'the 9-day-old payout is outside the window');
  assert.equal(row(r, 'SEN').in24hFcfa, 50_000);
});

test('cover: days the money left after commitments lasts at the recent pace; unknown when nothing was paid out lately', () => {
  const pace = [payout(CI, 700_000, 'paid', DAY / 2), payout(CI, 1_400_000, 'paid', 3 * DAY)]; // 300 000 a day
  const c = row(report([...pace, payout(CI, 500_000, 'approved')]), 'CIV');
  assert.equal(c.avgDailyOutFcfa, 300_000);
  assert.equal(c.coverDays, 15, '(5 000 000 - 500 000) / 300 000');
  assert.equal(row(report(), 'CIV').coverDays, null);
});

test('numbers outside the supported countries or with no number are ignored, never crash', () => {
  const r = report([payout('+33612345678', 1_000_000, 'approved'), payout(null, 1_000_000, 'approved')]);
  assert.ok(r.every((x) => x.committedFcfa === 0));
});
