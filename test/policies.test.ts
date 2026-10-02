import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error plain .mjs script, no type declarations
import { buildPolicies, CAPS, USDC, USDT } from '../scripts/privy-policy-defs.mjs';

type Cond = { field_source: string; field: string; operator: string; value: string };
type Rule = { name: string; method: string; action: string; conditions: Cond[] };
const policies = buildPolicies() as { body: { name: string; chain_type: string; rules: Rule[] } }[];
const [evm, sol] = policies.map((p) => p.body.rules) as [Rule[], Rule[]];
const allow = (rules: Rule[]) => rules.filter((r) => r.action === 'ALLOW');
const cond = (r: Rule, field: string) => r.conditions.find((c) => c.field === field);

test('names fit Privy limits (1-50 chars)', () => {
  for (const p of policies) {
    assert.ok(p.body.name.length >= 1 && p.body.name.length <= 50);
    for (const r of p.body.rules) assert.ok(r.name.length >= 1 && r.name.length <= 50, r.name);
  }
});
test('every EVM ALLOW rule is pinned to mainnet and carries a cap (restrictions live inside the ALLOW, not in a separate one)', () => {
  for (const r of allow(evm)) {
    assert.equal(cond(r, 'chain_id')?.value, '1', r.name);
    assert.ok(r.conditions.some((c) => c.operator === 'lte'), `${r.name} has no cap`);
  }
});
test('token transfers are limited to USDT / USDC, carry no ETH value, and are capped', () => {
  const tokens = allow(evm).filter((r) => cond(r, 'to'));
  assert.deepEqual(tokens.map((r) => cond(r, 'to')!.value).sort(), [USDC, USDT].sort());
  for (const r of tokens) {
    assert.equal(cond(r, 'value')?.value, '0');
    assert.equal(cond(r, 'transfer.amount')?.value, CAPS.stableUnits);
  }
});
test('key export and message signing are explicitly denied (typed data / 7702 fall to default deny)', () => {
  const denied = evm.filter((r) => r.action === 'DENY').map((r) => r.method).sort();
  assert.deepEqual(denied, ['exportPrivateKey', 'personal_sign']);
});
test('no DENY rule is a catch-all that would cancel the ALLOW rules', () => {
  for (const r of [...evm, ...sol]) assert.notEqual(r.method, '*');
});
test('Solana transfers are capped', () => {
  for (const r of allow(sol)) assert.equal(cond(r, 'Transfer.lamports')?.value, CAPS.solLamports);
});

// @ts-expect-error plain .mjs script, no type declarations
import { buildUserPolicies, TIER_CAP_USD } from '../scripts/privy-policy-defs.mjs';
const user = buildUserPolicies() as { env: string; body: { name: string; chain_type: string; rules: Rule[] } }[];

test('user policies: names fit, one EVM and one Solana policy per tier, plus frozen', () => {
  assert.equal(user.length, TIER_CAP_USD.length * 2 + 2);
  for (const p of user) { assert.ok(p.body.name.length <= 50, p.body.name); for (const r of p.body.rules) assert.ok(r.name.length <= 50, r.name); }
});
test('user policies allow by wildcard and restrict only with DENY rules (a looser ALLOW would override nothing here)', () => {
  for (const p of user.filter((x) => !x.env.includes('FROZEN'))) {
    const allows = p.body.rules.filter((r) => r.action === 'ALLOW');
    assert.equal(allows.length, 1);
    assert.equal(allows[0]!.method, '*');
    assert.ok(p.body.rules.filter((r) => r.action === 'DENY').length >= 2);
  }
});
test('tier caps rise with the tier and stablecoin caps are exact (50 / 500 / 5000 USD at 6 decimals)', () => {
  const caps = [0, 1, 2].map((t) => user.find((p) => p.env === `PRIVY_POLICY_TIER${t}_EVM`)!.body.rules.find((r) => r.name.includes('USDT'))!.conditions.find((c) => c.field === 'transfer.amount')!.value);
  assert.deepEqual(caps, ['50000000', '500000000', '5000000000']);
});
test('unlimited approvals are denied on every EVM tier policy (P-02)', () => {
  for (const p of user.filter((x) => x.env.endsWith('_EVM') && x.env.includes('TIER'))) {
    const r = p.body.rules.find((x) => x.name.startsWith('P-02'))!;
    assert.equal(r.action, 'DENY');
    assert.equal(r.conditions[0]!.field, 'approve.amount');
  }
});
test('frozen policies deny every method (P-07)', () => {
  for (const p of user.filter((x) => x.env.includes('FROZEN'))) assert.deepEqual(p.body.rules.map((r) => [r.method, r.action]), [['*', 'DENY']]);
});

const TREASURY = '0xC59C7DFD746016F5c325084BBcC6539c3c18a2B5';
const locked = (buildPolicies({ treasuryEvm: TREASURY }) as { body: { rules: (Rule & { conditions: { operator: string; value: string | string[]; field: string }[] })[] } }[])[0]!.body.rules;
const sweeps = locked.filter((r) => r.action === 'ALLOW');

test('with a treasury, every EVM ALLOW rule pins the destination to it (checksummed and lowercase)', () => {
  assert.equal(sweeps.length, 3);
  for (const r of sweeps) {
    const d = r.conditions.find((c) => c.field === 'transfer.recipient' || (c.field === 'to' && Array.isArray(c.value)));
    assert.ok(d, `${r.name} has no destination condition`);
    assert.deepEqual(d.value, [TREASURY, TREASURY.toLowerCase()]);
  }
});
test('the destination lock keeps the chain and the cap in the same rule', () => {
  for (const r of sweeps) {
    assert.ok(r.conditions.some((c) => c.field === 'chain_id' && c.value === '1'));
    assert.ok(r.conditions.some((c) => c.operator === 'lte'));
  }
});
test('a malformed treasury is rejected; an omitted one builds the unlocked policy', () => {
  assert.throws(() => buildPolicies({ treasuryEvm: '0x123' }));
  assert.throws(() => buildPolicies({ treasurySol: 'nope' }));
  assert.doesNotThrow(() => buildPolicies());
});

test('with a Solana treasury, every Solana rule pins Transfer.to to it', () => {
  const T = 'F3L2PZ9xEH55mxg8ccRCHAGzJpitnBCTkpeQ3AKb9t2g';
  const rules = (buildPolicies({ treasurySol: T }) as { body: { chain_type: string; rules: Rule[] } }[]).find((p) => p.body.chain_type === 'solana')!.body.rules;
  for (const r of rules) assert.ok(r.conditions.some((c) => c.field === 'Transfer.to' && c.value === T), r.name);
});
