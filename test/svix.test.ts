import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifySvix, WebhookVerificationError } from '../worker/svix.ts';

// Known-good vector from Svix's documentation (https://docs.svix.com/receiving/verifying-payloads/how-manual)
const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const id = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
const timestamp = '1614265330';
const body = '{"test": 2432232314}';
const signature = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=';
const now = 1614265330;

const headers = (over: Record<string, string> = {}) =>
  new Headers({ 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature, ...over });

const rejects = (p: Promise<unknown>, msg?: RegExp) => assert.rejects(p, (e) => e instanceof WebhookVerificationError && (!msg || msg.test(e.message)));

test('accepts the documented test vector', async () => {
  assert.equal(await verifySvix({ body, headers: headers(), secret, nowSeconds: now }), id);
});

test('accepts when any of several rotated signatures matches', async () => {
  const h = headers({ 'svix-signature': `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${signature}` });
  assert.equal(await verifySvix({ body, headers: h, secret, nowSeconds: now }), id);
});

test('rejects a tampered body', async () => {
  await rejects(verifySvix({ body: '{"test": 2432232315}', headers: headers(), secret, nowSeconds: now }), /Signature/);
});

test('rejects the wrong secret', async () => {
  await rejects(verifySvix({ body, headers: headers(), secret: 'whsec_aW5jb3JyZWN0c2VjcmV0', nowSeconds: now }), /Signature/);
});

test('rejects a stale timestamp (replay)', async () => {
  await rejects(verifySvix({ body, headers: headers(), secret, nowSeconds: now + 6 * 60 }), /tolerance/);
});

test('rejects a timestamp from the future', async () => {
  await rejects(verifySvix({ body, headers: headers(), secret, nowSeconds: now - 6 * 60 }), /tolerance/);
});

test('rejects missing headers', async () => {
  const h = new Headers({ 'svix-id': id });
  await rejects(verifySvix({ body, headers: h, secret, nowSeconds: now }), /Missing/);
});

test('rejects a non-v1 signature version', async () => {
  const h = headers({ 'svix-signature': signature.replace('v1,', 'v2,') });
  await rejects(verifySvix({ body, headers: h, secret, nowSeconds: now }), /Signature/);
});
