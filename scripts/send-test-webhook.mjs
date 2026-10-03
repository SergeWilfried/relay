// Sends a correctly signed (Svix-style) test event to a running Worker.
//   node scripts/send-test-webhook.mjs [url] [eventType] [--tamper] [--id=msg_x]
//   swap:    ... wallet_action.swap.succeeded|failed|rejected --ref=<our swap id> --action=<action id> [--out=<output base units>]
//   deposit: ... wallet.funds_deposited --to=<addr> --amount=<base units> [--token=<contract>] [--caip2=eip155:1] [--from=<sender>]
// Reads the signing secret from .dev.vars (PRIVY_WEBHOOK_SIGNING_SECRET).
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const [url = 'http://localhost:5173/api/webhooks/privy', type = 'user.wallet_created'] = args.filter((a) => !a.startsWith('--'));

const secret = /PRIVY_WEBHOOK_SIGNING_SECRET=(\S+)/.exec(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'))?.[1];
if (!secret) throw new Error('PRIVY_WEBHOOK_SIGNING_SECRET missing from .dev.vars');

const swapEvent = (status) => ({
  type: `wallet_action.swap.${status}`, wallet_action_id: flags.action ?? 'act1', wallet_id: 'wallet-eth-1', reference_id: flags.ref ?? null, action_type: 'swap', caip2: 'eip155:1',
  input_token: 'native', output_token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', status, created_at: new Date().toISOString(),
  ...(status === 'succeeded' ? { output_amount: flags.out ?? '1000000', input_amount: '10000000000000000', completed_at: new Date().toISOString(), steps: [{ type: 'evm_transaction', caip2: 'eip155:1', status: 'confirmed', transaction_hash: `0x${'cd'.repeat(32)}` }] } : {}),
  ...(status === 'failed' ? { failure_reason: { message: 'slippage exceeded' } } : {}),
});
const payloads = {
  'wallet_action.swap.succeeded': swapEvent('succeeded'), 'wallet_action.swap.failed': swapEvent('failed'), 'wallet_action.swap.rejected': swapEvent('rejected'),
  'user.created': { type, user: { id: 'did:privy:test-user', linked_accounts: [{ type: 'email', address: 'a@b.co' }] } },
  'user.wallet_created': { type, user: { id: 'did:privy:test-user' }, wallet: { id: 'w1', address: '0x8f3C4a92eE71B2d5C1f0A6b39C21d4E87a550c21', chain_type: 'ethereum' } },
  // deposit: --to=<address> --amount=<base units> [--token=<erc20 contract>] [--caip2=eip155:1] [--tx=0x..]
  'wallet.funds_deposited': {
    type, wallet_id: 'w-dep', caip2: flags.caip2 ?? 'eip155:1', recipient: flags.to ?? '0x8f3C4a92eE71B2d5C1f0A6b39C21d4E87a550c21',
    sender: flags.from ?? '0x1111111111111111111111111111111111111111', amount: flags.amount ?? '1000000000000000000',
    asset: flags.token ? { type: 'erc20', address: flags.token } : { type: 'native' },
    transaction_hash: flags.tx ?? `0x${randomUUID().replace(/-/g, '')}`, idempotency_key: randomUUID(),
  },
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
