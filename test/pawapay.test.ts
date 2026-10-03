import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lowFloat, acceptsPayouts, assertSafeBase, normalizeBase, parseActiveConf, classifyStatus, createPawapayProvider, digestMatches, friendlyFailure, parsePhone, parseSignatureInput, payoutUuid, providerCode, verifyCallback } from '../worker/payout/pawapay.ts';

const B64 = (u: Uint8Array) => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const mute = () => { const w = console.warn, e = console.error, l = console.log; console.warn = console.error = console.log = () => {}; return () => { console.warn = w; console.error = e; console.log = l; }; };

test('operators map to pawaPay providers per country; PI-SPI and unlisted combinations are unsupported', () => {
  assert.equal(providerCode('orange', '+2250789458900'), 'ORANGE_CIV');
  assert.equal(providerCode('wave', '+2250555012200'), 'WAVE_CIV');
  assert.equal(providerCode('orange', '+221771234567'), 'ORANGE_SEN');
  assert.equal(providerCode('wave', '+221771234567'), 'WAVE_SEN');
  assert.equal(providerCode('moov', '+22670123456'), 'MOOV_BFA');
  assert.equal(providerCode('orange', '+22670123456'), 'ORANGE_BFA');
  assert.equal(providerCode('pispi', '+2250712345600'), null, 'pawaPay has no PI-SPI');
  assert.equal(providerCode('moov', '+2250102334800'), null, 'Moov is not offered in Côte d\'Ivoire');
  assert.equal(providerCode('wave', '+22670123456'), null, 'Wave is not offered in Burkina Faso');
  assert.equal(providerCode('orange', '+33612345678'), null, 'unsupported country');
});

test('phone numbers become digits-only MSISDNs with a country', () => {
  assert.deepEqual(parsePhone('+2250789458900'), { msisdn: '2250789458900', country: 'CIV' });
  assert.equal(parsePhone('2250789458900'), null);
  assert.equal(parsePhone('+12'), null);
});

test('the payout id becomes a stable, valid UUIDv4 (the idempotency key)', async () => {
  const a = await payoutUuid('poabc12345');
  assert.match(a, UUID4);
  assert.equal(a, await payoutUuid('poabc12345'));
  assert.notEqual(a, await payoutUuid('poabc12346'));
});

test('failure codes are turned into customer-safe messages; our own empty wallet is never exposed as such', () => {
  assert.match(friendlyFailure('RECIPIENT_NOT_FOUND'), /not registered/);
  assert.equal(friendlyFailure('PAWAPAY_WALLET_OUT_OF_FUNDS'), 'Payouts are temporarily unavailable');
  assert.ok(!/wallet|pawa/i.test(friendlyFailure('PAWAPAY_WALLET_OUT_OF_FUNDS')));
  assert.equal(friendlyFailure(undefined), 'The payout could not be completed');
});

test('status answers: completed, failed, not found, and every in-flight status is pending', () => {
  assert.deepEqual(classifyStatus({ status: 'FOUND', data: { status: 'COMPLETED' } }), { state: 'paid' });
  assert.deepEqual(classifyStatus({ status: 'FOUND', data: { status: 'FAILED', failureReason: { failureCode: 'RECIPIENT_NOT_FOUND' } } }), { state: 'failed', error: friendlyFailure('RECIPIENT_NOT_FOUND') });
  assert.equal(classifyStatus({ status: 'NOT_FOUND' }).state, 'not_found');
  for (const s of ['ACCEPTED', 'ENQUEUED', 'PROCESSING', 'IN_RECONCILIATION']) assert.equal(classifyStatus({ status: 'FOUND', data: { status: s } }).state, 'pending', s);
  assert.equal(classifyStatus(null).state, 'pending');
});

// ---- signed callbacks ---------------------------------------------------------------------------------------------------

async function signer() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey));
  const pem = `-----BEGIN PUBLIC KEY-----\n${B64(spki).match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----\n`;
  return { kp, pem };
}

/** Builds a callback signed exactly as pawaPay documents (RFC 9421, ecdsa-p256-sha256), with the signature base written out by hand. */
async function signedCallback(body: string, kp: CryptoKeyPair, over: { created?: number; path?: string; covered?: string; alg?: string; keyid?: string } = {}) {
  const created = over.created ?? Math.floor(Date.now() / 1000);
  const path = over.path ?? '/api/webhooks/payout';
  const digest = `sha-512=:${B64(new Uint8Array(await crypto.subtle.digest('SHA-512', new TextEncoder().encode(body))))}:`;
  const covered = over.covered ?? '"@method" "@authority" "@path" "signature-date" "content-digest" "content-type"';
  const params = `(${covered});alg="${over.alg ?? 'ecdsa-p256-sha256'}";keyid="${over.keyid ?? 'HTTP_EC_P256_KEY:1'}";created=${created};expires=${created + 60}`;
  const date = '2026-10-03T10:00:00.123456Z';
  const lines: Record<string, string> = { '"@method"': 'POST', '"@authority"': 'relay.example.com', '"@path"': '/api/webhooks/payout', '"signature-date"': date, '"content-digest"': digest, '"content-type"': 'application/json; charset=UTF-8' };
  const base = [...covered.matchAll(/"[^"]+"/g)].map((c) => `${c[0]}: ${lines[c[0]]}`).concat(`"@signature-params": ${params}`).join('\n');
  const sig = B64(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new TextEncoder().encode(base))));
  const headers = new Headers({ signature: `sig-pp=:${sig}:`, 'signature-input': `sig-pp=${params}`, 'signature-date': date, 'content-digest': digest, 'content-type': 'application/json; charset=UTF-8' });
  return { headers, url: new URL(`https://relay.example.com${path}`), body, created };
}

test('Signature-Input is parsed into components, algorithm, key id and times', () => {
  const p = parseSignatureInput('sig-pp=("@method" "@path" "content-digest");alg="ecdsa-p256-sha256";keyid="K1";created=100;expires=160')!;
  assert.deepEqual([p.label, p.components, p.alg, p.keyid, p.created, p.expires], ['sig-pp', ['@method', '@path', 'content-digest'], 'ecdsa-p256-sha256', 'K1', 100, 160]);
  assert.equal(parseSignatureInput('garbage'), null);
});

test('a correctly signed callback verifies', async () => {
  const { kp, pem } = await signer();
  const c = await signedCallback('{"payoutId":"x","status":"COMPLETED"}', kp);
  assert.equal(await verifyCallback({ method: 'POST', url: c.url, headers: c.headers, body: c.body }, async () => pem), true);
});

test('a tampered body, a different key, a different path or host are all refused', async () => {
  const { kp, pem } = await signer(); const other = await signer();
  const c = await signedCallback('{"payoutId":"x","status":"FAILED"}', kp);
  const ok = (over: { body?: string; url?: URL; key?: string }) => verifyCallback({ method: 'POST', url: over.url ?? c.url, headers: c.headers, body: over.body ?? c.body }, async () => over.key ?? pem);
  assert.equal(await ok({}), true);
  assert.equal(await ok({ body: '{"payoutId":"x","status":"COMPLETED"}' }), false, 'body changed (digest)');
  assert.equal(await ok({ key: other.pem }), false, 'signed by someone else');
  assert.equal(await ok({ url: new URL('https://relay.example.com/other') }), false, 'path is covered');
  assert.equal(await ok({ url: new URL('https://evil.example.com/api/webhooks/payout') }), false, 'authority is covered');
});

test('replays, expired signatures, unknown algorithms and uncovered bodies are refused', async () => {
  const { kp, pem } = await signer();
  const key = async () => pem;
  const stale = await signedCallback('{}', kp, { created: Math.floor(Date.now() / 1000) - 3600 });
  assert.equal(await verifyCallback({ method: 'POST', url: stale.url, headers: stale.headers, body: stale.body }, key), false, 'old signature');
  const rsa = await signedCallback('{}', kp, { alg: 'rsa-pss-sha512' });
  assert.equal(await verifyCallback({ method: 'POST', url: rsa.url, headers: rsa.headers, body: rsa.body }, key), false, 'unsupported algorithm');
  const nodigest = await signedCallback('{}', kp, { covered: '"@method" "@authority" "@path" "signature-date" "content-type"' });
  assert.equal(await verifyCallback({ method: 'POST', url: nodigest.url, headers: nodigest.headers, body: nodigest.body }, key), false, 'body not covered');
  const c = await signedCallback('{}', kp);
  assert.equal(await verifyCallback({ method: 'POST', url: c.url, headers: new Headers(), body: c.body }, key), false, 'no signature at all');
  assert.equal(await verifyCallback({ method: 'POST', url: c.url, headers: c.headers, body: c.body }, async () => null), false, 'unknown key id');
});

test('the content digest must match the body (sha-256 and sha-512)', async () => {
  const d256 = `sha-256=:${B64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hello'))))}:`;
  assert.equal(await digestMatches(d256, 'hello'), true);
  assert.equal(await digestMatches(d256, 'hellp'), false);
  assert.equal(await digestMatches('md5=:abc:', 'hello'), false);
  assert.equal(await digestMatches(null, 'hello'), false);
});

// ---- the provider with a fake pawaPay ------------------------------------------------------------------------------------

type Call = { url: string; method: string; body?: Record<string, unknown>; auth?: string };
function setup(handler: (c: Call) => Response | Promise<Response>, over: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const env = { PAWAPAY_API_TOKEN: 'tok', PAWAPAY_BASE_URL: 'http://localhost:9999', LIVE: 'false', DB: { prepare: () => ({ all: async () => ({ results: [{ id: 'popending1' }] }) }) }, ...over } as unknown as Env;
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const c: Call = { url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body as string) : undefined, auth: (init.headers as Record<string, string> | undefined)?.authorization };
    calls.push(c);
    return handler(c);
  }) as typeof globalThis.fetch;
  return { provider: createPawapayProvider(env, { fetch }), calls };
}
const req = { reference: 'poorder0001', amountFcfa: 570_000, phone: '+2250789458900', operator: 'orange' };

test('send: builds the documented request and treats ACCEPTED as pending (processing, not paid)', async () => {
  const { provider, calls } = setup(() => Response.json({ status: 'ACCEPTED' }));
  const out = await provider.send(req);
  assert.deepEqual(out, { state: 'pending', providerRef: await payoutUuid('poorder0001') });
  const c = calls[0]!;
  assert.equal(c.url, 'http://localhost:9999/v2/payouts');
  assert.equal(c.auth, 'Bearer tok');
  assert.deepEqual(c.body, {
    payoutId: await payoutUuid('poorder0001'), amount: '570000', currency: 'XOF',
    recipient: { type: 'MMO', accountDetails: { phoneNumber: '2250789458900', provider: 'ORANGE_CIV' } },
    customerMessage: 'Relay payout', clientReferenceId: 'poorder0001',
  });
  assert.match(String(c.body!.customerMessage), /^[A-Za-z0-9 ]{4,22}$/);
});

test('send: REJECTED is definitive, with a customer-safe message and the raw reason kept for ops', async () => {
  const { provider } = setup(() => Response.json({ status: 'REJECTED', failureReason: { failureCode: 'PAWAPAY_WALLET_OUT_OF_FUNDS', failureMessage: 'no funds' } }));
  const out = await provider.send(req);
  assert.ok(out.state === 'failed' && out.error === 'Payouts are temporarily unavailable' && /PAWAPAY_WALLET_OUT_OF_FUNDS/.test(out.detail ?? ''));
});

test('send: DUPLICATE_IGNORED means already accepted (pending); a 4xx means our request was wrong (failed)', async () => {
  assert.equal((await setup(() => Response.json({ status: 'DUPLICATE_IGNORED' })).provider.send(req)).state, 'pending');
  const bad = await setup(() => Response.json({ failureReason: { failureCode: 'AUTHENTICATION_ERROR' } }, { status: 401 })).provider.send(req);
  assert.ok(bad.state === 'failed' && /401/.test(bad.detail ?? ''));
});

test('send: after an HTTP 500 it asks pawaPay what happened, and never guesses', async () => {
  const mk = (statusBody: unknown) => setup((c) => (c.method === 'POST' ? Response.json({ failureReason: { failureCode: 'UNKNOWN_ERROR' } }, { status: 500 }) : Response.json(statusBody)));
  const found = mk({ status: 'FOUND', data: { status: 'ENQUEUED' } });
  assert.equal((await found.provider.send(req)).state, 'pending');
  assert.equal(found.calls[1]!.url, `http://localhost:9999/v2/payouts/${await payoutUuid('poorder0001')}`, 'the status check uses the same deterministic id');
  assert.equal((await mk({ status: 'FOUND', data: { status: 'COMPLETED' } }).provider.send(req)).state, 'paid');
  assert.equal((await mk({ status: 'NOT_FOUND' }).provider.send(req)).state, 'failed');
});

test('send: if the request AND the status check both fail the outcome is unknown (it throws, so a person decides)', async () => {
  const { provider } = setup(() => { throw new Error('offline'); });
  await assert.rejects(provider.send(req), /outcome unknown/);
});

test('send: an unsupported operator is a clean failure and nothing is sent', async () => {
  const { provider, calls } = setup(() => Response.json({ status: 'ACCEPTED' }));
  const out = await provider.send({ ...req, operator: 'pispi' });
  assert.equal(out.state, 'failed');
  assert.equal(calls.length, 0);
  assert.equal(await provider.supports!('pispi', req.phone), 'This provider is not available for your number');
});

// the shape pawaPay really returns (captured from the sandbox active-conf for Côte d'Ivoire)
const conf = (providers: Record<string, string>) => ({ countries: [{ country: 'CIV', providers: Object.entries(providers).map(([provider, status]) => ({ provider, currencies: [{ currency: 'XOF', operationTypes: { PAYOUT: { minAmount: '1', maxAmount: '2000000', decimalsInAmount: 'NONE', status, callbackUrl: 'https://other.example/cb' } } }] })) }] });

test('active configuration: providers with status, limits and callback URL are read from the real shape', () => {
  const m = parseActiveConf(conf({ ORANGE_CIV: 'OPERATIONAL', MTN_MOMO_CIV: 'CLOSED' }));
  assert.deepEqual(m.get('ORANGE_CIV'), { status: 'OPERATIONAL', min: 1, max: 2_000_000, callbackUrl: 'https://other.example/cb' });
  assert.equal(m.size, 2);
  assert.equal(parseActiveConf(null).size, 0);
  assert.equal(acceptsPayouts(m.get('ORANGE_CIV')), true);
  assert.equal(acceptsPayouts(m.get('MTN_MOMO_CIV')), false, 'closed');
  assert.equal(acceptsPayouts(m.get('WAVE_CIV')), false, 'not enabled on the account');
});

test('supports: a provider that is not active on the account (or is closed) is refused; a configuration outage falls back to the mapping', async () => {
  const wave = { ...req, operator: 'wave' };
  const active = setup((c) => (c.url.includes('/v2/active-conf') ? Response.json(conf({ ORANGE_CIV: 'OPERATIONAL' })) : Response.json({})));
  assert.equal(await active.provider.supports!('orange', req.phone), true);
  assert.equal(await active.provider.supports!('wave', wave.phone), 'This provider is not available for your number', 'Wave is mapped but not enabled on this account');
  assert.equal(active.calls[0]!.url, 'http://localhost:9999/v2/active-conf?country=CIV&operationType=PAYOUT');
  const closed = setup(() => Response.json(conf({ ORANGE_CIV: 'CLOSED' })));
  assert.equal(await closed.provider.supports!('orange', req.phone), 'This provider is not available for your number');
  const delayed = setup(() => Response.json(conf({ ORANGE_CIV: 'DELAYED' })));
  assert.equal(await delayed.provider.supports!('orange', req.phone), true, 'delayed payouts are queued, so still accepted');
  const down = setup(() => new Response('x', { status: 500 }));
  assert.equal(await down.provider.supports!('orange', req.phone), true);
  const offline = setup(() => { throw new Error('offline'); });
  assert.equal(await offline.provider.supports!('orange', req.phone), true);
  assert.equal(await offline.provider.supports!('pispi', req.phone), 'This provider is not available for your number', 'an unmapped operator is refused whatever the configuration says');
});

test('webhook: a signed COMPLETED / FAILED callback settles our payout (found through clientReferenceId)', async () => {
  const { kp, pem } = await signer();
  const done = setup((c) => (c.url.endsWith('/v2/public-key/http') ? Response.json([{ id: 'HTTP_EC_P256_KEY:1', key: pem }]) : new Response('x', { status: 500 })));
  const body = JSON.stringify({ payoutId: await payoutUuid('poorder0001'), clientReferenceId: 'poorder0001', status: 'COMPLETED' });
  const c = await signedCallback(body, kp);
  assert.deepEqual(await done.provider.parseWebhook(c.body, c.headers, {} as Env, c.url), { reference: 'poorder0001', state: 'paid' });
  const failBody = JSON.stringify({ payoutId: await payoutUuid('poorder0001'), clientReferenceId: 'poorder0001', status: 'FAILED', failureReason: { failureCode: 'RECIPIENT_NOT_FOUND' } });
  const f = await signedCallback(failBody, kp);
  const ev = await done.provider.parseWebhook(f.body, f.headers, {} as Env, f.url);
  assert.ok(ev?.state === 'failed' && /not registered/.test(ev.error ?? ''));
  const mid = await signedCallback(JSON.stringify({ payoutId: await payoutUuid('poorder0001'), clientReferenceId: 'poorder0001', status: 'PROCESSING' }), kp);
  assert.equal((await done.provider.parseWebhook(mid.body, mid.headers, {} as Env, mid.url))?.state, 'ignore');
});

test('webhook: a forged signature is rejected', async () => {
  const real = await signer(); const attacker = await signer();
  const { provider } = setup((c) => (c.url.endsWith('/v2/public-key/http') ? Response.json([{ id: 'HTTP_EC_P256_KEY:1', key: real.pem }]) : new Response('x', { status: 500 })));
  const body = JSON.stringify({ payoutId: await payoutUuid('poorder0001'), clientReferenceId: 'poorder0001', status: 'COMPLETED' });
  const forged = await signedCallback(body, attacker.kp); // signed with a key pawaPay doesn't publish
  assert.equal(await provider.parseWebhook(forged.body, forged.headers, {} as Env, forged.url), null);
});

test('webhook: an UNSIGNED callback is never trusted: pawaPay is asked, and its answer wins', async () => {
  const restore = mute();
  try {
    const lying = JSON.stringify({ payoutId: await payoutUuid('poorder0001'), clientReferenceId: 'poorder0001', status: 'COMPLETED' });
    const failed = setup(() => Response.json({ status: 'FOUND', data: { status: 'FAILED', failureReason: { failureCode: 'RECIPIENT_NOT_FOUND' } } }));
    const ev = await failed.provider.parseWebhook(lying, new Headers(), {} as Env, new URL('https://relay.example.com/api/webhooks/payout'));
    assert.equal(ev?.state, 'failed', 'the body claimed COMPLETED but pawaPay says FAILED');
    const paid = setup(() => Response.json({ status: 'FOUND', data: { status: 'COMPLETED' } }));
    assert.equal((await paid.provider.parseWebhook(lying, new Headers(), {} as Env, new URL('https://relay.example.com/x')))?.state, 'paid');
    const unreachable = setup(() => { throw new Error('offline'); });
    assert.equal(await unreachable.provider.parseWebhook(lying, new Headers(), {} as Env, new URL('https://relay.example.com/x')), null, 'cannot confirm: refuse so pawaPay retries');
  } finally { restore(); }
});

test('webhook: without clientReferenceId our payout is found from the waiting payouts by its deterministic id; deposits and junk are ignored', async () => {
  const restore = mute();
  try {
    const { provider } = setup(() => Response.json({ status: 'FOUND', data: { status: 'COMPLETED' } }));
    const body = JSON.stringify({ payoutId: await payoutUuid('popending1'), status: 'COMPLETED' });
    assert.deepEqual(await provider.parseWebhook(body, new Headers(), {} as Env, new URL('https://x.test/y')), { reference: 'popending1', state: 'paid' });
    assert.equal(await provider.parseWebhook(JSON.stringify({ payoutId: '11111111-1111-4111-8111-111111111111', status: 'COMPLETED' }), new Headers(), {} as Env, new URL('https://x.test/y')), null, 'not one of ours');
    assert.equal((await provider.parseWebhook(JSON.stringify({ depositId: 'd', status: 'COMPLETED' }), new Headers(), {} as Env, new URL('https://x.test/y')))?.state, 'ignore');
    assert.equal(await provider.parseWebhook('not json', new Headers(), {} as Env, new URL('https://x.test/y')), null);
  } finally { restore(); }
});

test('safety: pawaPay sandbox with LIVE=true and production without LIVE=true are both refused', () => {
  assert.throws(() => assertSafeBase('https://api.sandbox.pawapay.io', true), /sandbox/);
  assert.throws(() => assertSafeBase('https://api.pawapay.io', false), /real money/);
  assert.doesNotThrow(() => assertSafeBase('https://api.pawapay.io', true));
  assert.doesNotThrow(() => assertSafeBase('https://api.sandbox.pawapay.io', false));
  assert.throws(() => createPawapayProvider({ PAWAPAY_BASE_URL: 'http://localhost', LIVE: 'false' } as unknown as Env), /PAWAPAY_API_TOKEN/);
});

test('the base URL works with or without /v2 or a trailing slash, and the safety checks see through it', () => {
  assert.equal(normalizeBase('https://api.sandbox.pawapay.io/v2'), 'https://api.sandbox.pawapay.io');
  assert.equal(normalizeBase('https://api.pawapay.io/v2/'), 'https://api.pawapay.io');
  assert.equal(normalizeBase(' https://api.pawapay.io '), 'https://api.pawapay.io');
  assert.throws(() => assertSafeBase('https://api.pawapay.io/v2', false), /real money/);
  assert.throws(() => assertSafeBase('https://api.sandbox.pawapay.io/v2', true), /sandbox/);
});

test('supports: an amount outside the provider limits is refused up front (Orange Senegal caps payouts at 200 000)', async () => {
  const sen = (limits: { minAmount: string; maxAmount: string }) => ({ countries: [{ country: 'SEN', providers: [{ provider: 'ORANGE_SEN', currencies: [{ currency: 'XOF', operationTypes: { PAYOUT: { ...limits, status: 'OPERATIONAL' } } }] }] }] });
  const { provider } = setup(() => Response.json(sen({ minAmount: '1', maxAmount: '200000' })));
  const phone = '+221771234567';
  assert.equal(await provider.supports!('orange', phone, 200_000), true, 'at the limit');
  assert.equal(await provider.supports!('orange', phone, 200_100), 'This amount is outside the provider limits');
  assert.equal(await provider.supports!('orange', phone), true, 'no amount given: only availability is checked');
  const { provider: p2 } = setup(() => Response.json(sen({ minAmount: '100', maxAmount: '2000000' })));
  assert.equal(await p2.supports!('orange', phone, 50), 'This amount is outside the provider limits');
});

test('float: only the countries Relay pays in, in XOF, below the floor, are reported', () => {
  const b = [
    { country: 'BFA', currency: 'XOF', balance: 436_994 }, { country: 'CIV', currency: 'XOF', balance: 5_000_000 },
    { country: 'SEN', currency: 'XOF', balance: 10_000 }, { country: 'BEN', currency: 'XOF', balance: 10 }, { country: 'KEN', currency: 'KES', balance: 1 },
  ];
  assert.deepEqual(lowFloat(b, 2_000_000).map((x) => x.country), ['BFA', 'SEN']);
  assert.deepEqual(lowFloat(b, 2_000_000, ['CIV']), []);
});

test('balances: read from the wallet-balances answer, ignoring malformed rows', async () => {
  const { provider, calls } = setup(() => Response.json({ balances: [{ country: 'SEN', currency: 'XOF', balance: '10000' }, { country: 'X' }, { country: 'BFA', currency: 'XOF', balance: 'abc' }] }));
  assert.deepEqual(await provider.balances!(), [{ country: 'SEN', currency: 'XOF', balance: 10_000 }]);
  assert.equal(calls[0]!.url, 'http://localhost:9999/v2/wallet-balances');
  await assert.rejects(setup(() => new Response('no', { status: 500 })).provider.balances!(), /failed \(500\)/);
});
