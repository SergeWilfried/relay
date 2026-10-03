import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { createPrivySwapClient, mapSwapError, parseAction, parseQuote, parseUserWallets, txHashOf } from '../worker/swap/privy.ts';
import { authorizationPayload, derToP1363 } from '../worker/privySign.ts';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PKCS8 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const env = { PRIVY_APP_ID: 'app1', PRIVY_APP_SECRET: 'sec', PRIVY_SIGNER_PRIVATE_KEY: PKCS8, PRIVY_SIGNER_ID: 'kq1' } as unknown as Env;

type Call = { url: string; method: string; headers: Record<string, string>; body?: Record<string, unknown> };
function setup(handler: (c: Call) => Response) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit = {}) => { const c: Call = { url, method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(init.body as string) : undefined }; calls.push(c); return handler(c); }) as typeof globalThis.fetch;
  return { client: createPrivySwapClient(env, { fetch }), calls };
}

test('quote: parses the amounts, fees and expiry (cross-chain) and sends no signature', async () => {
  const { client, calls } = setup(() => Response.json({ caip2: 'eip155:1', input_amount: '10000000000000000', est_output_amount: '26826096', minimum_output_amount: '26759031', gas_estimate: '30036232713768', estimated_fees: [{ type: 'relayer', amount: '0.31' }, { type: 'privy', amount: '0.80' }], expires_at: 1791025119 }));
  const q = await client.quote('w1', { source: { caip2: 'eip155:1', asset_address: 'native' } });
  assert.deepEqual(q, { estOutputAmount: '26826096', minimumOutputAmount: '26759031', inputAmount: '10000000000000000', gasEstimate: '30036232713768', estimatedFees: [{ type: 'relayer', amount: '0.31' }, { type: 'privy', amount: '0.80' }], expiresAt: 1791025119 });
  assert.equal(calls[0]!.url, 'https://api.privy.io/v1/wallets/w1/swap/quote');
  assert.equal(calls[0]!.headers['privy-authorization-signature'], undefined);
  assert.match(calls[0]!.headers.authorization!, /^Basic /);
});

test('execute: adds our reference id, carries the idempotency key, and is signed by Relay\'s key over exactly what is sent', async () => {
  const { client, calls } = setup(() => Response.json({ id: 'act1', status: 'pending', input_amount: null, output_amount: null, reference_id: 'swap0001' }));
  const body = { source: { caip2: 'eip155:1', asset_address: 'native' }, base_amount: '1000', amount_type: 'exact_input', slippage_bps: 50 };
  const a = await client.execute('w1', body, { referenceId: 'swap0001', idempotencyKey: 'swap-swap0001' });
  assert.deepEqual([a.id, a.status, a.referenceId], ['act1', 'pending', 'swap0001']);
  const c = calls[0]!;
  assert.deepEqual(c.body, { ...body, reference_id: 'swap0001' });
  assert.equal(c.headers['privy-idempotency-key'], 'swap-swap0001');
  // the signature verifies with the public key, over the canonical request including the idempotency header
  const payload = authorizationPayload({ method: 'POST', url: 'https://api.privy.io/v1/wallets/w1/swap', body: c.body, headers: { 'privy-app-id': 'app1', 'privy-idempotency-key': 'swap-swap0001' } });
  const key = await crypto.subtle.importKey('spki', publicKey.export({ type: 'spki', format: 'der' }), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const sig = derToP1363(Uint8Array.from(Buffer.from(c.headers['privy-authorization-signature']!, 'base64')));
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, payload), true);
  // and it does NOT verify for a different body (an attacker can't reuse it)
  const other = authorizationPayload({ method: 'POST', url: 'https://api.privy.io/v1/wallets/w1/swap', body: { ...c.body, base_amount: '999999' }, headers: { 'privy-app-id': 'app1', 'privy-idempotency-key': 'swap-swap0001' } });
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, other), false);
});

test('execute without a signer key configured is refused before anything is sent', async () => {
  const calls: unknown[] = [];
  const client = createPrivySwapClient({ ...env, PRIVY_SIGNER_PRIVATE_KEY: '' } as unknown as Env, { fetch: (async (...a: unknown[]) => { calls.push(a); return Response.json({}); }) as typeof fetch });
  await assert.rejects(client.execute('w1', {}, { referenceId: 'r', idempotencyKey: 'k' }), /not available yet/);
  assert.equal(calls.length, 0);
});

test('Privy\'s documented errors become customer-safe messages, keeping the raw text for ops', () => {
  const m = (s: number, t: string) => mapSwapError(s, t);
  assert.deepEqual([m(400, '{"error":"Insufficient native token balance for swap"}').message, m(400, '').code], ['Your balance is too low for this swap', 'other']);
  assert.equal(m(400, 'Insufficient native token balance').code, 'balance');
  assert.equal(m(403, 'Swaps are not enabled for your app').code, 'config');
  assert.equal(m(400, 'Gas sponsorship is not enabled').code, 'config');
  assert.equal(m(400, 'No quotes available').message, 'No route is available for this swap');
  assert.equal(m(404, 'not found').code, 'route');
  assert.equal(m(429, '').code, 'rate');
  assert.match(m(400, 'Insufficient native token balance for swap').detail, /Insufficient native/);
  assert.equal(m(500, 'boom').message, 'This swap could not be completed');
});

test('a Privy error on execute surfaces as PrivySwapError with the mapped message', async () => {
  const { client } = setup(() => new Response('{"error":"Insufficient native token balance for swap"}', { status: 400 }));
  await assert.rejects(client.execute('w1', {}, { referenceId: 'r', idempotencyKey: 'k' }), (e: Error & { code?: string }) => e.message === 'Your balance is too low for this swap' && e.code === 'balance');
});

test('actions: status, output, failure reason and the transaction hash of an EVM or Solana step', () => {
  const done = parseAction({ id: 'a', status: 'succeeded', input_amount: '1', output_amount: '2', reference_id: 'r', steps: [{ type: 'evm_transaction', transaction_hash: '0xabc' }] });
  assert.deepEqual([done.status, done.outputAmount, done.txHash, done.referenceId], ['succeeded', '2', '0xabc', 'r']);
  assert.equal(parseAction({ id: 'a', status: 'failed', failure_reason: { message: 'slippage' } }).failureReason, 'slippage');
  assert.equal(txHashOf([{ signature: 'SoLsig' }]), 'SoLsig');
  assert.equal(txHashOf([{ transaction_hash: null }, { transaction_hash: '0xlast' }]), '0xlast');
  assert.equal(txHashOf(undefined), null);
  assert.throws(() => parseAction({ id: 'a', status: 'weird' }), /Unexpected/);
  assert.throws(() => parseQuote({}), /Unexpected/);
});

test('a user\'s wallets and whether Relay\'s signer was added come from the user record; imported or external wallets are ignored', () => {
  const r = parseUserWallets({ linked_accounts: [
    { type: 'email', address: 'a@b.c' },
    { type: 'wallet', wallet_client_type: 'privy', chain_type: 'ethereum', id: 'we', address: '0xe', delegated: true },
    { type: 'wallet', wallet_client_type: 'privy', chain_type: 'solana', id: 'ws', address: 'Sol', delegated: false },
    { type: 'wallet', wallet_client_type: 'metamask', chain_type: 'ethereum', id: 'wx', address: '0xext' },
  ] });
  assert.deepEqual(r.wallets, { ethereum: { id: 'we', address: '0xe' }, solana: { id: 'ws', address: 'Sol' } });
  assert.deepEqual(r.delegated, { ethereum: true, solana: false });
  assert.deepEqual(parseUserWallets(null).wallets, {});
});
