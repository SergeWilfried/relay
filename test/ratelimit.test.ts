import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allow, allowUser, bucketOf, clientIp, secureApi, tooMany } from '../worker/ratelimit.ts';

/** A limiter that allows `n` calls and then refuses, remembering the keys it saw. */
const limiter = (n: number, seen: string[] = []) => ({ seen, limit: async ({ key }: { key: string }) => { seen.push(key); return { success: seen.length <= n }; } }) as unknown as RateLimit & { seen: string[] };

test('allow: passes until the limiter says no; a missing or failing limiter never blocks', async () => {
  const l = limiter(2);
  assert.deepEqual([await allow(l, 'a'), await allow(l, 'a'), await allow(l, 'a')], [true, true, false]);
  assert.equal(await allow(undefined, 'a'), true);
  const broken = { limit: async () => { throw new Error('boom'); } } as unknown as RateLimit;
  assert.equal(await allow(broken, 'a'), true);
});

test('buckets: reads are general, quotes and KYC sync hit the paid-provider bucket, every other write the write bucket', () => {
  assert.equal(bucketOf('GET', '/api/orders'), 'read');
  assert.equal(bucketOf('POST', '/api/swap/quote'), 'quote');
  assert.equal(bucketOf('POST', '/api/kyc/sync'), 'quote');
  for (const p of ['/api/orders', '/api/swap', '/api/kyc/token', '/api/orders/abc123/pay']) assert.equal(bucketOf('POST', p), 'write', p);
});

test('allowUser: counts the user in the general bucket and the specific one, keyed by user id', async () => {
  const env = { RL_USER: limiter(100), RL_QUOTE: limiter(100), RL_WRITE: limiter(1) };
  assert.equal(await allowUser(env, 'u1', 'POST', '/api/orders'), true);
  assert.equal(await allowUser(env, 'u1', 'POST', '/api/orders'), false, 'second write in the window is refused');
  assert.deepEqual(env.RL_WRITE.seen, ['u1', 'u1']);
  assert.equal(await allowUser(env, 'u1', 'GET', '/api/orders'), true, 'reads do not touch the write bucket');
  assert.equal(env.RL_WRITE.seen.length, 2);
  assert.equal(await allowUser({ RL_USER: limiter(0) }, 'u1', 'GET', '/api/limits'), false, 'the general bucket applies to everything');
});

test('clientIp uses the Cloudflare header and falls back safely', () => {
  assert.equal(clientIp(new Request('https://x.test/', { headers: { 'cf-connecting-ip': '203.0.113.9' } })), '203.0.113.9');
  assert.equal(clientIp(new Request('https://x.test/')), 'unknown');
});

test('429 carries Retry-After and a customer-safe message; API responses are never cached, sniffed or framed', async () => {
  const r = tooMany();
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '60');
  assert.match(((await r.json()) as { error: string }).error, /Too many requests/);
  const s = secureApi(Response.json({ ok: true }));
  assert.equal(s.headers.get('cache-control'), 'no-store');
  assert.equal(s.headers.get('x-content-type-options'), 'nosniff');
  assert.match(s.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.equal(s.headers.get('content-type')?.startsWith('application/json'), true, 'the original headers are kept');
});
