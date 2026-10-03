import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CAPS, TIER_CAP_USD, FCFA_PER_USD, buildPolicies, buildUserPolicies } from '../scripts/privy-policy-defs.mjs';
import { DEPOSIT_HEADROOM, KYC_THRESHOLD_FCFA, LIMITS, MIN_FCFA, tierLimits } from '../worker/limits.ts';
import { FCFA_PER_UNIT } from '../worker/pricing.ts';
import { evaluate, KYC_THRESHOLD_FCFA as RULES_THRESHOLD, type BaseFacts } from '../worker/rules.ts';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const num = (s: string) => Number(s.replace(/_/g, ''));

test('the tiers are coherent: the unverified tier is the KYC threshold, the verified one is at least as large, a day fits in a month', () => {
  assert.equal(LIMITS.unverified.perTx, KYC_THRESHOLD_FCFA);
  assert.equal(LIMITS.unverified.daily, KYC_THRESHOLD_FCFA, 'daily = threshold, so small orders cannot add up past it');
  for (const t of [LIMITS.unverified, LIMITS.verified]) assert.ok(t.perTx <= t.daily && t.daily <= t.monthly && t.perTx >= MIN_FCFA);
  assert.ok(LIMITS.verified.perTx >= LIMITS.unverified.perTx && LIMITS.verified.daily >= LIMITS.unverified.daily && LIMITS.verified.monthly >= LIMITS.unverified.monthly);
  assert.deepEqual(tierLimits(0), LIMITS.unverified);
  assert.deepEqual(tierLimits(1), LIMITS.verified);
});

test('the rule engine uses the same numbers (re-exported, not copied)', () => {
  assert.equal(RULES_THRESHOLD, KYC_THRESHOLD_FCFA);
  const facts: BaseFacts = { amount_fcfa: 1_000, country: 'CI', user_status: 'normal', account_age_days: 90, tier: 0, day_fcfa: 0, month_fcfa: 0, open_orders: 0, orders_last_hour: 0,
    country_changed: false, payout_number_changed: false, prior_near_limit_7d: 0, clef_flag_active: false, payout_number_denied: false, kyc_approved: false };
  const l0 = evaluate(facts).limits, l1 = evaluate({ ...facts, tier: 1, kyc_approved: true }).limits;
  assert.deepEqual([l0.perTx, l0.daily, l0.monthly], [LIMITS.unverified.perTx, LIMITS.unverified.daily, LIMITS.unverified.monthly]);
  assert.deepEqual([l1.perTx, l1.daily, l1.monthly], [LIMITS.verified.perTx, LIMITS.verified.daily, LIMITS.verified.monthly]);
});

test('the client fallback (demo / offline) equals the server numbers', () => {
  const c = read('src/lib/limits.ts');
  const grab = (tier: string) => { const m = new RegExp(`(?<![a-z])${tier}: \\{ perTx: ([\\d_]+), daily: ([\\d_]+), monthly: ([\\d_]+) \\}`).exec(c); assert.ok(m, `${tier} not found in src/lib/limits.ts`); return { perTx: num(m![1]!), daily: num(m![2]!), monthly: num(m![3]!) }; };
  assert.deepEqual(grab('unverified'), LIMITS.unverified);
  assert.deepEqual(grab('verified'), LIMITS.verified);
  assert.equal(num(/KYC_THRESHOLD = ([\d_]+)/.exec(c)![1]!), KYC_THRESHOLD_FCFA);
  assert.equal(num(/KYC_THRESHOLD_FCFA = ([\d_]+)/.exec(read('src/lib/kycLive.ts'))![1]!), KYC_THRESHOLD_FCFA);
});

test('Privy user-wallet caps are each tier\'s per-transaction limit in USD (rounded up, never tighter than the limit)', () => {
  assert.deepEqual(TIER_CAP_USD, [Math.ceil(LIMITS.unverified.perTx / FCFA_PER_USD), Math.ceil(LIMITS.verified.perTx / FCFA_PER_USD)]);
  for (const [i, usd] of TIER_CAP_USD.entries()) assert.ok(usd * FCFA_PER_USD >= [LIMITS.unverified, LIMITS.verified][i]!.perTx);
  const user = buildUserPolicies();
  assert.equal(user.filter((p: { env: string }) => /TIER\d_EVM/.test(p.env)).length, 2, 'one policy per tier');
});

test('Privy deposit-wallet caps cover the largest order with the stated headroom, in every asset', () => {
  const need = LIMITS.verified.perTx;
  const fcfa = (units: string, rate: number, dec: number) => (Number(BigInt(units)) / 10 ** dec) * rate;
  const eth = fcfa(CAPS.ethWei, FCFA_PER_UNIT.ETH!, 18), usd = fcfa(CAPS.stableUnits, FCFA_PER_UNIT.USDT!, 6), sol = fcfa(CAPS.solLamports, FCFA_PER_UNIT.SOL!, 9);
  for (const v of [eth, usd, sol]) { assert.ok(v >= need * DEPOSIT_HEADROOM - 1, 'never below the headroom'); assert.ok(v <= need * DEPOSIT_HEADROOM * 1.0001 + 1, 'and not looser than it'); }
  assert.ok(buildPolicies().length > 0);
});
