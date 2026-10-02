import assert from 'node:assert/strict';
import { test } from 'node:test';
import { itemIdFrom, kindOfChain, normalizeEntry } from '../worker/lists.ts';

test('phone numbers are normalised to +digits and must carry a country code', () => {
  assert.equal(normalizeEntry('phone', ' +225 07 89-45 (89) 00 '), '+2250789458900');
  assert.equal(normalizeEntry('phone', '0789458900'), null);
  assert.equal(normalizeEntry('phone', '+12'), null);
});

test('EVM addresses are lowercased so one address has one form; bad ones are refused', () => {
  assert.equal(normalizeEntry('evm', '0xC59C7DFD746016F5c325084BBcC6539c3c18a2B5'), '0xc59c7dfd746016f5c325084bbcc6539c3c18a2b5');
  assert.equal(normalizeEntry('evm', '0x123'), null);
  assert.equal(normalizeEntry('evm', 'C59C7DFD746016F5c325084BBcC6539c3c18a2B5'), null);
});

test('Solana addresses keep their case (it matters) and must be base58', () => {
  assert.equal(normalizeEntry('solana', 'F3L2PZ9xEH55mxg8ccRCHAGzJpitnBCTkpeQ3AKb9t2g'), 'F3L2PZ9xEH55mxg8ccRCHAGzJpitnBCTkpeQ3AKb9t2g');
  assert.equal(normalizeEntry('solana', '0OIl'), null);
});

test('unknown kinds and non-strings are refused', () => {
  assert.equal(normalizeEntry('btc', 'x'), null);
  assert.equal(normalizeEntry('evm', 123 as never), null);
});

test('the chain decides the kind of address', () => {
  assert.equal(kindOfChain('ethereum'), 'evm');
  assert.equal(kindOfChain('solana'), 'solana');
});

test('reads the Privy item id from an array, a wrapped list or a single object', () => {
  assert.equal(itemIdFrom([{ id: 'item1', value: '0xABC' }], '0xabc'), 'item1');
  assert.equal(itemIdFrom({ items: [{ id: 'item2', value: 'x' }, { id: 'item3', value: 'Y' }] }, 'y'), 'item3');
  assert.equal(itemIdFrom({ id: 'item4' }, 'anything'), 'item4');
  assert.equal(itemIdFrom([{ id: 'other', value: 'different' }], 'wanted'), null);
  assert.equal(itemIdFrom(null, 'x'), null);
});

import { pushToPrivy, removeFromPrivy } from '../worker/lists.ts';
const envWith = (over: Record<string, string> = {}) => ({ PRIVY_APP_ID: 'app', PRIVY_APP_SECRET: 'secret', PRIVY_DENY_SET_EVM: 'set1', PRIVY_DENY_SET_SOL: '', ...over }) as unknown as Env;
const withFetch = async (impl: (url: string, init: RequestInit) => Promise<Response>, fn: () => Promise<void>) => {
  const real = globalThis.fetch; globalThis.fetch = impl as typeof fetch;
  try { await fn(); } finally { globalThis.fetch = real; }
};

test('pushToPrivy posts [{value}] to the condition set and returns the item id', async () => {
  let seen: { url: string; method?: string; body?: unknown; auth?: string } = { url: '' };
  await withFetch(async (url, init) => { seen = { url, method: init.method, body: JSON.parse(init.body as string), auth: (init.headers as Record<string, string>).authorization }; return Response.json([{ id: 'item9', value: '0xabc' }]); }, async () => {
    const r = await pushToPrivy(envWith(), 'evm', '0xabc');
    assert.deepEqual(r, { synced: true, itemId: 'item9' });
  });
  assert.equal(seen.url, 'https://api.privy.io/v1/condition_sets/set1/condition_set_items');
  assert.equal(seen.method, 'POST');
  assert.deepEqual(seen.body, [{ value: '0xabc' }]);
  assert.match(seen.auth!, /^Basic /);
});

test('pushToPrivy: no set configured, a Privy error and a network error are all reported, never thrown', async () => {
  assert.deepEqual(await pushToPrivy(envWith(), 'solana', 'x'), { synced: false, reason: 'no Privy condition set configured (PRIVY_DENY_SET_EVM / PRIVY_DENY_SET_SOL)' });
  assert.equal((await pushToPrivy(envWith(), 'phone', '+2250700000000')).synced, false);
  await withFetch(async () => new Response('nope', { status: 403 }), async () => {
    const r = await pushToPrivy(envWith(), 'evm', '0xabc');
    assert.ok(!r.synced && /403/.test(r.reason));
  });
  await withFetch(async () => { throw new Error('offline'); }, async () => {
    const r = await pushToPrivy(envWith(), 'evm', '0xabc');
    assert.ok(!r.synced && r.reason === 'offline');
  });
});

test('removeFromPrivy deletes the item; a 404 counts as already gone; other errors are reported', async () => {
  let url = ''; let method = '';
  await withFetch(async (u, init) => { url = u; method = init.method!; return new Response(null, { status: 204 }); }, async () => { assert.equal((await removeFromPrivy(envWith(), 'evm', 'item9')).synced, true); });
  assert.equal(url, 'https://api.privy.io/v1/condition_sets/set1/condition_set_items/item9');
  assert.equal(method, 'DELETE');
  await withFetch(async () => new Response('gone', { status: 404 }), async () => { assert.equal((await removeFromPrivy(envWith(), 'evm', 'x')).synced, true); });
  await withFetch(async () => new Response('boom', { status: 500 }), async () => { assert.equal((await removeFromPrivy(envWith(), 'evm', 'x')).synced, false); });
});
