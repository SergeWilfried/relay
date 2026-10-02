import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alert, formatAlert } from '../worker/alerts.ts';

const env = (url?: string) => ({ ALERT_WEBHOOK_URL: url }) as unknown as Env;
const mute = () => { const e = console.error; console.error = () => {}; return () => { console.error = e; }; };

test('formats a title and the details that have a value', () => {
  assert.equal(formatAlert({ level: 'critical', title: 'T', details: { order: 'o1', error: null, n: 0, empty: '' } }), '🔴 Relay: T\norder: o1\nn: 0');
});

test('posts text, content and structured fields to the webhook', async () => {
  const real = globalThis.fetch; const restore = mute();
  let seen: { url: string; body: Record<string, unknown> } | undefined;
  globalThis.fetch = (async (url: string, init: RequestInit) => { seen = { url, body: JSON.parse(init.body as string) }; return new Response('ok'); }) as typeof fetch;
  try {
    await alert(env('https://hooks.example/x'), { level: 'warning', title: 'Sweep failed', details: { order: 'abc123' } });
    assert.equal(seen!.url, 'https://hooks.example/x');
    assert.equal(seen!.body.text, seen!.body.content);
    assert.match(seen!.body.text as string, /Sweep failed[\s\S]*order: abc123/);
    assert.equal(seen!.body.level, 'warning');
  } finally { globalThis.fetch = real; restore(); }
});

test('no webhook configured: nothing is sent and nothing throws', async () => {
  const real = globalThis.fetch; const restore = mute(); let called = false;
  globalThis.fetch = (async () => { called = true; return new Response(); }) as typeof fetch;
  try { await alert(env(undefined), { level: 'info', title: 'x' }); assert.equal(called, false); } finally { globalThis.fetch = real; restore(); }
});

test('a failing or rejecting webhook never breaks the caller', async () => {
  const real = globalThis.fetch; const restore = mute();
  try {
    globalThis.fetch = (async () => { throw new Error('boom'); }) as typeof fetch;
    await alert(env('https://hooks.example/x'), { level: 'critical', title: 'x' });
    globalThis.fetch = (async () => new Response('no', { status: 500 })) as typeof fetch;
    await alert(env('https://hooks.example/x'), { level: 'critical', title: 'x' });
  } finally { globalThis.fetch = real; restore(); }
});
