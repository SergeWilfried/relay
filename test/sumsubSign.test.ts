import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { eventTime, hmacHex, safeEqualHex, signRequest, statusFromEvent, verifyWebhook } from '../worker/kyc/sumsubSign.ts';

test('request signature = HMAC-SHA256(secret, ts + METHOD + path + body), hex, matching node:crypto', async () => {
  const body = JSON.stringify({ userId: 'did:privy:abc', levelName: 'id-and-liveness', ttlInSecs: 900 });
  const h = await signRequest('tok', 'sec', 'post', '/resources/accessTokens/sdk', body, 1700000000);
  const want = createHmac('sha256', 'sec').update(`1700000000POST/resources/accessTokens/sdk${body}`).digest('hex');
  assert.equal(h['X-App-Access-Sig'], want);
  assert.equal(h['X-App-Token'], 'tok');
  assert.equal(h['X-App-Access-Ts'], '1700000000');
});

test('the query string is part of the signed path', async () => {
  const a = await signRequest('t', 's', 'GET', '/resources/applicants/-;externalUserId=x/one', '', 1);
  const b = await signRequest('t', 's', 'GET', '/resources/applicants/-;externalUserId=y/one', '', 1);
  assert.notEqual(a['X-App-Access-Sig'], b['X-App-Access-Sig']);
});

test('webhook digest: SHA-1 by default, SHA-256 and SHA-512 by header; wrong secret, body or algorithm is refused', async () => {
  const body = '{"type":"applicantReviewed","externalUserId":"u1"}';
  const d1 = createHmac('sha1', 'whs').update(body).digest('hex');
  const d256 = createHmac('sha256', 'whs').update(body).digest('hex');
  const d512 = createHmac('sha512', 'whs').update(body).digest('hex');
  assert.equal(await verifyWebhook('whs', body, d1, null), true);
  assert.equal(await verifyWebhook('whs', body, d1, 'HMAC_SHA1_HEX'), true);
  assert.equal(await verifyWebhook('whs', body, d256, 'HMAC_SHA256_HEX'), true);
  assert.equal(await verifyWebhook('whs', body, d512.toUpperCase(), 'HMAC_SHA512_HEX'), true);
  assert.equal(await verifyWebhook('other', body, d1, null), false);
  assert.equal(await verifyWebhook('whs', body + ' ', d1, null), false);
  assert.equal(await verifyWebhook('whs', body, d1, 'HMAC_MD5_HEX'), false);
  assert.equal(await verifyWebhook('whs', body, null, null), false);
  assert.equal(await verifyWebhook('', body, d1, null), false);
});

test('safeEqualHex compares length first', () => {
  assert.equal(safeEqualHex('ab', 'abc'), false);
  assert.equal(safeEqualHex('ab', 'ab'), true);
  assert.equal(safeEqualHex('ab', 'ac'), false);
});

test('events map to statuses: only a GREEN review approves; pending never downgrades an approved user', () => {
  const rev = (reviewAnswer: string, reviewRejectType?: string) => ({ type: 'applicantReviewed', reviewResult: { reviewAnswer, reviewRejectType } });
  assert.equal(statusFromEvent(rev('GREEN'), 'none'), 'approved');
  assert.equal(statusFromEvent(rev('RED', 'FINAL'), 'pending'), 'rejected');
  assert.equal(statusFromEvent(rev('RED', 'RETRY'), 'pending'), 'retry');
  assert.equal(statusFromEvent(rev('YELLOW'), 'none'), null);
  assert.equal(statusFromEvent({ type: 'applicantReviewed' }, 'none'), null);
  assert.equal(statusFromEvent({ type: 'applicantPending' }, 'none'), 'pending');
  assert.equal(statusFromEvent({ type: 'applicantOnHold' }, 'approved'), null);
  assert.equal(statusFromEvent({ type: 'applicantReset' }, 'approved'), 'none');
  assert.equal(statusFromEvent({ type: 'applicantCreated' }, 'none'), null);
});

test('event time parses Sumsub formats and returns 0 for junk', () => {
  assert.equal(eventTime({ type: 'x', createdAtMs: '2026-10-03 13:25:07.000' }), Date.UTC(2026, 9, 3, 13, 25, 7));
  assert.equal(eventTime({ type: 'x', createdAtMs: '1790000000000' }), 1790000000000);
  assert.equal(eventTime({ type: 'x', createdAtMs: 'nope' }), 0);
  assert.equal(eventTime({ type: 'x' }), 0);
});

test('hmacHex is lowercase hex of the right length', async () => {
  assert.match(await hmacHex('k', 'd'), /^[0-9a-f]{64}$/);
});
