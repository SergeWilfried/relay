// Creates the Privy policies for Relay's deposit wallets.
//   node scripts/privy-policies.mjs            -> dry run: prints what would be created, sends nothing
//   node scripts/privy-policies.mjs --apply    -> creates them in your Privy app and prints the ids to configure
//   add --swap to include the override policies for the swap signer
//   add --users to include the policies for users' own wallets (tier caps, frozen)
// --apply needs PRIVY_APP_ID and PRIVY_APP_SECRET (environment, or .dev.vars). The dry run needs nothing.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildPolicies, buildSwapSignerPolicies, buildUserPolicies, DENY_SETS } from './privy-policy-defs.mjs';

try {
  for (const line of readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
} catch { /* no .dev.vars: use the environment */ }

const apply = process.argv.includes('--apply');
// --users also creates the policies for users' own wallets (tier caps P-03..P-05, unlimited approvals P-02, frozen P-07)
const treasuryEvm = process.env.TREASURY_EVM || undefined;
const treasurySol = process.env.TREASURY_SOL || undefined;
if (!treasuryEvm) console.warn('TREASURY_EVM is not set: the EVM policy will NOT lock the destination.');
if (!treasurySol) console.warn('TREASURY_SOL is not set: the Solana policy will NOT lock the destination.');
const withUsers = process.argv.includes('--users');
// --swap creates the override policies for the swap signer (see buildSwapSignerPolicies); the ids go in VITE_PRIVY_SWAP_POLICY_EVM / _SOL
const withSwap = process.argv.includes('--swap');

if (!apply) {
  const policies = [...buildPolicies({ treasuryEvm, treasurySol }), ...(withUsers ? buildUserPolicies() : []), ...(withSwap ? buildSwapSignerPolicies() : [])];
  console.log(JSON.stringify(policies.map((p) => p.body), null, 2));
  console.log('\nDry run only. Re-run with --apply to create these in your Privy app.');
  process.exit(0);
}

const { PRIVY_APP_ID: id, PRIVY_APP_SECRET: secret } = process.env;
if (!id || !secret) throw new Error('PRIVY_APP_ID and PRIVY_APP_SECRET are required with --apply');

const headers = (idem) => ({
  'content-type': 'application/json',
  'privy-app-id': id,
  authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
  'privy-idempotency-key': idem,
});

// --users: the recipient denylist condition sets come first, because the user policies reference their ids
const denySets = {};
if (withUsers) {
  for (const set of DENY_SETS) {
    const res = await fetch('https://api.privy.io/v1/condition_sets', { method: 'POST', headers: headers(`relay-${set.env}-v1`), body: JSON.stringify({ name: set.name }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.id) { console.error(`${set.name}: FAILED (${res.status})`, JSON.stringify(out)); process.exit(1); }
    console.log(`${set.env}=${out.id}   # ${set.name}`);
    denySets[set.env === 'PRIVY_DENY_SET_EVM' ? 'evm' : 'sol'] = out.id;
  }
}
const policies = [...buildPolicies({ treasuryEvm, treasurySol }), ...(withUsers ? buildUserPolicies({ denySets }) : []), ...(withSwap ? buildSwapSignerPolicies() : [])];

for (const p of policies) {
  const res = await fetch('https://api.privy.io/v1/policies', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'privy-app-id': id,
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      // safe to re-run within 24h: Privy returns the same policy instead of creating a duplicate
      'privy-idempotency-key': p.idem ?? `relay-${p.env}-${createHash('sha256').update(JSON.stringify(p.body)).digest('hex').slice(0, 10)}`,
    },
    body: JSON.stringify(p.body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`${p.body.name}: FAILED (${res.status})`, JSON.stringify(out)); process.exitCode = 1; continue; }
  console.log(`${p.env}=${out.id}   # ${p.body.name}`);
}
console.log('\nSet the ids above as Worker secrets (wrangler secret put <NAME>) or in .dev.vars.');
