// Sends a correctly signed (Svix-style) test event to a running Worker.
//   node scripts/send-test-webhook.mjs [url] [eventType] [--tamper] [--id=msg_x]
// Reads the signing secret from .dev.vars (PRIVY_WEBHOOK_SIGNING_SECRET).
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const [url = 'http://localhost:5173/api/webhooks/privy', type = 'user.wallet_created'] = args.filter((a) => !a.startsWith('--'));

const secret = /PRIVY_WEBHOOK_SIGNING_SECRET=(\S+)/.exec(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'))?.[1];
if (!secret) throw new Error('PRIVY_WEBHOOK_SIGNING_SECRET missing from .dev.vars');

const payloads = {
  'user.created': { type, user: { id: 'did:privy:test-user', linked_accounts: [{ type: 'email', address: 'a@b.co' }] } },
  'user.wallet_created': { type, user: { id: 'did:privy:test-user' }, wallet: { id: 'w1', address: '0x8f3C4a92eE71B2d5C1f0A6b39C21d4E87a550c21', chain_type: 'ethereum' } },
  'wallet.funds_deposited': { type, recipient: '0x8f3C4a92eE71B2d5C1f0A6b39C21d4E87a550c21', transaction_hash: '0xabc', asset: 'eth' },
};
const body = JSON.stringify(payloads[type] ?? { type });
const id = flags.id ?? `msg_${randomUUID().replace(/-/g, '')}`;
const ts = String(Math.floor(Date.now() / 1000));
const sig = createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${body}`).digest('base64');

const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` },
  body: 'tamper' in flags ? body.replace('test', 'evil') : body,
});
console.log(res.status, await res.text());
