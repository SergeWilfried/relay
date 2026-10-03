import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate, RULES, windowStarts, type BaseFacts, type Rule } from '../worker/rules.ts';

const base: BaseFacts = {
  amount_fcfa: 500_000, country: 'CI', user_status: 'normal', account_age_days: 90, tier: 1,
  day_fcfa: 0, month_fcfa: 0, open_orders: 0, orders_last_hour: 0,
  country_changed: false, payout_number_changed: false, prior_near_limit_7d: 0, clef_flag_active: false, payout_number_denied: false, kyc_approved: true,
};
const run = (over: Partial<BaseFacts> = {}, opts: Parameters<typeof evaluate>[1] = {}) => evaluate({ ...base, ...over }, opts);
const denied = (over: Partial<BaseFacts>) => { const o = run(over); return o.action === 'deny' ? o.ruleIds : o.action; };
const enforceAll = Object.fromEntries(RULES.map((r) => [r.id, 'enforce' as const]));

test('allows an order inside every limit', () => assert.equal(run().action, 'allow'));

test('limits: per-transaction cap is inclusive, daily and monthly count prior usage', () => {
  assert.equal(denied({ amount_fcfa: 2_000_000 }), 'allow');
  assert.deepEqual(denied({ amount_fcfa: 2_000_001 }), ['R-03', 'R-04']);
  assert.equal(denied({ amount_fcfa: 500_000, day_fcfa: 1_500_000 }), 'allow');
  assert.deepEqual(denied({ amount_fcfa: 500_001, day_fcfa: 1_500_000 }), ['R-04']);
  assert.deepEqual(denied({ amount_fcfa: 1_000_001, month_fcfa: 9_000_000 }), ['R-05']);
  assert.deepEqual(denied({ amount_fcfa: 999 }), ['R-02']);
});

test('velocity and open orders', () => {
  assert.deepEqual(denied({ open_orders: 3 }), ['R-06']);
  assert.deepEqual(denied({ orders_last_hour: 10 }), ['R-07']);
});

test('sanctioned country is a 403 deny; unknown country is not', () => {
  const o = run({ country: 'KP' });
  assert.ok(o.action === 'deny' && o.status === 403 && o.ruleIds[0] === 'R-01');
  assert.equal(run({ country: null }).action, 'allow');
});

test('evaluation order: a frozen account is reported before a limit breach', () => {
  const o = run({ user_status: 'frozen', amount_fcfa: 3_000_000 });
  assert.ok(o.action === 'deny' && o.ruleIds[0] === 'P-07' && o.status === 403);
});

test('restricted account holds every payout until review (no end time)', () => {
  const o = run({ user_status: 'restricted' });
  assert.ok(o.action === 'hold' && o.hours === null && o.ruleIds.includes('P-06'));
});

test('shadow rules are logged but do not change the outcome', () => {
  const o = run({ country_changed: true, payout_number_changed: true });
  assert.equal(o.action, 'allow');
  assert.deepEqual(o.fired.map((f) => [f.id, f.mode, f.applied]).sort(), [['D-01', 'shadow', false], ['D-02', 'shadow', false]]);
  assert.ok(o.fired.every((f) => f.version >= 1));
});

test('promoting a rule to enforce makes it hold; the longest hold wins, "until review" beats a timer', () => {
  const o = run({ country_changed: true, payout_number_changed: true }, { modes: enforceAll });
  assert.ok(o.action === 'hold' && o.hours === 48);
  const probing = run({ country_changed: true, prior_near_limit_7d: 2, amount_fcfa: 1_900_000 }, { modes: enforceAll });
  assert.ok(probing.action === 'hold' && probing.hours === null && probing.ruleIds.includes('D-09'));
});

test('deny beats hold (most restrictive wins)', () => {
  const o = run({ country: 'IR', payout_number_changed: true }, { modes: enforceAll });
  assert.equal(o.action, 'deny');
});

test('limit probing counts this request: 2 earlier + one near the limit = 3', () => {
  assert.ok(run({ prior_near_limit_7d: 2, amount_fcfa: 1_900_000 }).fired.some((f) => f.id === 'D-09'));
  assert.ok(!run({ prior_near_limit_7d: 2, amount_fcfa: 1_000_000 }).fired.some((f) => f.id === 'D-09'));
});

test('D-03 halves every limit for new accounts when enforced, and is only logged in shadow', () => {
  assert.equal(run({ account_age_days: 3, amount_fcfa: 1_500_000 }).action, 'allow');
  const o = run({ account_age_days: 3, amount_fcfa: 1_500_000 }, { modes: { 'D-03': 'enforce' } });
  assert.ok(o.action === 'deny' && o.ruleIds.join() === 'R-03,R-04' && o.limits.perTx === 1_000_000 && o.limits.daily === 1_000_000 && o.limits.monthly === 5_000_000);
  assert.equal(run({ account_age_days: 3, amount_fcfa: 900_000 }, { modes: { 'D-03': 'enforce' } }).action, 'allow');
});

test('rules are plain versioned data, so a custom rule set works', () => {
  const custom: Rule[] = [{ id: 'X-01', version: 7, mode: 'enforce', phase: 5, description: 't', when: { amount_fcfa: { gte: 100 }, country: { in: ['CI', 'SN'] } }, action: { type: 'hold', hours: 2 }, user_message: 'm' }];
  const o = run({ amount_fcfa: 100 }, { rules: custom });
  assert.ok(o.action === 'hold' && o.hours === 2 && o.fired[0]!.version === 7);
  assert.equal(run({ country: 'BF' }, { rules: custom }).action, 'allow');
});

test('rule ids are unique and every rule has a version', () => {
  assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length);
  assert.ok(RULES.every((r) => Number.isInteger(r.version) && r.version >= 1));
  assert.ok(RULES.filter((r) => r.id.startsWith('D-')).every((r) => r.mode === 'shadow'), 'new dynamic rules ship in shadow');
});

test('windows are calendar day and month in UTC', () => {
  const w = windowStarts(Date.UTC(2026, 9, 2, 15, 30));
  assert.equal(w.day, Date.UTC(2026, 9, 2));
  assert.equal(w.month, Date.UTC(2026, 9, 1));
});

test('D-11 (Clef flag) holds until review once enforced; shadow only logs it', () => {
  const shadow = run({ clef_flag_active: true });
  assert.equal(shadow.action, 'allow');
  assert.ok(shadow.fired.some((f) => f.id === 'D-11' && f.mode === 'shadow' && !f.applied));
  const on = run({ clef_flag_active: true }, { modes: { 'D-11': 'enforce' } });
  assert.ok(on.action === 'hold' && on.hours === null && on.ruleIds.includes('D-11'));
});

test('R-08: a denylisted payout number is refused (403) before any limit is looked at', () => {
  const o = run({ payout_number_denied: true, amount_fcfa: 3_000_000 });
  assert.ok(o.action === 'deny' && o.status === 403 && o.ruleIds[0] === 'R-08');
  assert.equal(run({ payout_number_denied: false }).action, 'allow');
});

test('K-01: above the KYC threshold without an approved check is denied; at or below it, or once approved, it is allowed', () => {
  const over = run({ kyc_approved: false, amount_fcfa: 200_001 });
  assert.equal(over.action, 'deny');
  assert.deepEqual('ruleIds' in over ? over.ruleIds : [], ['K-01']);
  assert.equal(over.facts.kyc_required, true);
  assert.equal(run({ kyc_approved: false, amount_fcfa: 200_000 }).action, 'allow'); // "above 200,000": the limit itself is fine
  assert.equal(run({ kyc_approved: false, amount_fcfa: 5_000 }).action, 'allow');
  assert.equal(run({ kyc_approved: true, amount_fcfa: 1_900_000 }).action, 'allow');
});

test('K-01 also counts the day: small orders that add up past the threshold cannot dodge the check', () => {
  const split = run({ kyc_approved: false, tier: 0, amount_fcfa: 100_000, day_fcfa: 100_001 });
  assert.ok(split.action === 'deny' && split.ruleIds[0] === 'K-01' && split.message === 'Verify your identity to continue.', 'verify is asked before any limit message');
  assert.equal(run({ kyc_approved: false, tier: 0, amount_fcfa: 100_000, day_fcfa: 100_000 }).action, 'allow', 'exactly the threshold in total is fine');
  assert.equal(run({ kyc_approved: true, amount_fcfa: 100_000, day_fcfa: 1_000_000 }).action, 'allow');
});

test('tier limits: unverified is capped at the KYC threshold per order and day as a backstop (even with K-01 in shadow), verified at 2M / 10M', () => {
  const shadow = { modes: { 'K-01': 'shadow' as const } };
  const o = run({ kyc_approved: false, tier: 0, amount_fcfa: 300_000 }, shadow);
  assert.ok(o.action === 'deny' && o.ruleIds.join() === 'R-03,R-04');
  assert.deepEqual([o.limits.perTx, o.limits.daily, o.limits.monthly], [200_000, 200_000, 2_000_000]);
  const v = run({ amount_fcfa: 2_000_000 });
  assert.deepEqual([v.limits.perTx, v.limits.daily, v.limits.monthly], [2_000_000, 2_000_000, 10_000_000]);
});

test('K-01 in shadow mode is logged but does not block', () => {
  const o = evaluate({ ...base, kyc_approved: false, amount_fcfa: 500_000 }, { modes: { 'K-01': 'shadow' } });
  assert.equal(o.action, 'allow');
  assert.ok(o.fired.some((f) => f.id === 'K-01' && !f.applied));
});
