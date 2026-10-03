// Creates the key Relay's server uses to act on users' wallets (swaps) and registers it in your Privy app as a key quorum.
//   node scripts/privy-signer.mjs --write
// Generates a P-256 key pair, creates a key quorum holding its public key (idempotent per run: refuses if PRIVY_SIGNER_ID is already set),
// and with --write appends PRIVY_SIGNER_PRIVATE_KEY and PRIVY_SIGNER_ID to .dev.vars (git-ignored). The private key is never printed.
// For production: wrangler secret put PRIVY_SIGNER_PRIVATE_KEY  (and PRIVY_SIGNER_ID), and set VITE_PRIVY_SIGNER_ID at build time.
import { generateKeyPairSync } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';

const FILE = new URL('../.dev.vars', import.meta.url);
const vars = {};
for (const line of readFileSync(FILE, 'utf8').split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) vars[m[1]] = m[2].replace(/^"|"$/g, ''); }
const { PRIVY_APP_ID: id, PRIVY_APP_SECRET: secret } = { ...vars, ...process.env };
if (!id || !secret) throw new Error('PRIVY_APP_ID and PRIVY_APP_SECRET are required');
if (vars.PRIVY_SIGNER_ID && vars.PRIVY_SIGNER_PRIVATE_KEY) { console.log(`A signer already exists (PRIVY_SIGNER_ID=${vars.PRIVY_SIGNER_ID}). Remove it from .dev.vars first if you really want a new one.`); process.exit(0); }

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');

const res = await fetch('https://api.privy.io/v1/key_quorums', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'privy-app-id': id, authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
  body: JSON.stringify({ public_keys: [spki], authorization_threshold: 1, display_name: 'Relay swap signer' }),
});
const out = await res.json().catch(() => ({}));
if (!res.ok || !out.id) { console.error('Could not create the key quorum:', res.status, JSON.stringify(out)); process.exit(1); }

console.log(`Key quorum created: PRIVY_SIGNER_ID=${out.id}`);
if (process.argv.includes('--write')) {
  appendFileSync(FILE, `\nPRIVY_SIGNER_ID=${out.id}\nPRIVY_SIGNER_PRIVATE_KEY=${pkcs8}\n`);
  console.log('Wrote PRIVY_SIGNER_ID and PRIVY_SIGNER_PRIVATE_KEY to .dev.vars (the private key is not shown).');
} else {
  console.log('Re-run with --write to store the key in .dev.vars. This run did NOT save the private key, so this quorum is unusable: delete it in the dashboard.');
}
