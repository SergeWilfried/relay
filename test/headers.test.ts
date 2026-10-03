import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const csp = (/^[ \t]+Content-Security-Policy: (.+)$/m.exec(read('public/_headers'))?.[1] ?? '').split(';').map((d) => d.trim()).filter(Boolean);
const dir = (name: string) => csp.find((d) => d.startsWith(`${name} `)) ?? '';

test('index.html has no inline script, so script-src needs no unsafe-inline', () => {
  assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/.test(read('index.html')), false, 'an inline <script> would be blocked by the CSP');
  assert.doesNotMatch(dir('script-src'), /unsafe-inline|unsafe-eval/);
});

test('the CSP locks down framing, plugins, base and forms, and allows exactly the providers the app uses', () => {
  assert.equal(dir('default-src'), "default-src 'self'");
  assert.equal(dir('frame-ancestors'), "frame-ancestors 'none'");
  assert.equal(dir('object-src'), "object-src 'none'");
  assert.equal(dir('base-uri'), "base-uri 'self'");
  assert.equal(dir('form-action'), "form-action 'self'");
  for (const need of ['https://auth.privy.io']) { assert.match(dir('frame-src'), new RegExp(need)); assert.match(dir('connect-src'), new RegExp(need)); }
  assert.match(dir('script-src'), /https:\/\/static\.sumsub\.com/);
  assert.match(dir('frame-src'), /sumsub\.com/);
  assert.match(dir('connect-src'), /sumsub\.com/);
  assert.match(dir('connect-src'), /ethereum-rpc\.publicnode\.com/);
  assert.match(dir('connect-src'), /solana-rpc\.publicnode\.com/);
  assert.doesNotMatch(csp.join(';'), /\*(?!\.)/, 'no bare wildcard source');
});

test('the other security headers are present, and camera/microphone are left free for the identity check', () => {
  const h = read('public/_headers');
  for (const x of ['Strict-Transport-Security', 'X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY', 'Referrer-Policy', 'Permissions-Policy', 'Cross-Origin-Opener-Policy']) assert.ok(h.includes(x), x);
  assert.doesNotMatch(/Permissions-Policy: (.+)/.exec(h)![1]!, /camera|microphone/);
});

test('every rate-limit binding the Worker reads is declared in wrangler.jsonc', () => {
  const w = read('wrangler.jsonc');
  for (const n of ['RL_IP', 'RL_ADMIN', 'RL_USER', 'RL_QUOTE', 'RL_WRITE']) assert.ok(w.includes(`"${n}"`), n);
});
