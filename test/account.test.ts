import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALIAS_RE, normalizeAlias, normalizePhone, usesAlias, validAccount, validAlias, validPhone } from '../src/lib/account.ts';
import { ALIAS_RE as SERVER_ALIAS_RE, isAlias, normalizeEntry } from '../worker/lists.ts';

test('the app and the server validate aliases with the same rule', () => {
  assert.equal(ALIAS_RE.source, SERVER_ALIAS_RE.source);
  for (const a of ['mon.alias', 'jean_dupont', 'awa-diop', 'a.b@psp', '+2250789458900', 'ABC', 'x'.repeat(64)]) { assert.equal(validAlias(a), true, a); assert.equal(isAlias(a), true, a); }
  for (const a of ['', 'ab', 'x'.repeat(65), 'has space', '.starts.with.dot', '-dash', 'é', 'a/b', 'a;b', "a'b"]) { assert.equal(validAlias(a), false, a); assert.equal(isAlias(a), false, a); }
});

test('surrounding spaces are trimmed from an alias; inner spaces are not allowed', () => {
  assert.equal(normalizeAlias('  mon.alias  '), 'mon.alias');
  assert.equal(validAlias('  mon.alias  '), true);
  assert.equal(validAlias('mon alias'), false);
});

test('phone numbers keep their own rule (country code required)', () => {
  assert.equal(validPhone('+225 07 89 45 89 00'), true);
  assert.equal(normalizePhone('+225 07-89 (45) 89'), '+22507894589');
  assert.equal(validPhone('0789458900'), false);
});

test('the account a provider needs: an alias for PI-SPI, a number for the others, and one is never accepted for the other by mistake', () => {
  const pispi = { alias: true }, orange = {};
  assert.equal(usesAlias(pispi), true);
  assert.equal(usesAlias(orange), false);
  assert.equal(validAccount(pispi, 'mon.alias'), true);
  assert.equal(validAccount(pispi, ''), false);
  assert.equal(validAccount(pispi, null), false);
  assert.equal(validAccount(orange, '+2250789458900'), true);
  assert.equal(validAccount(orange, 'mon.alias'), false, 'an alias is not a mobile money number');
  assert.equal(validAccount(null, '+2250789458900'), true);
});

test('denylist: aliases are matched case-insensitively, so one alias has one form', () => {
  assert.equal(normalizeEntry('alias', 'Jean.Dupont'), 'jean.dupont');
  assert.equal(normalizeEntry('alias', 'no spaces allowed'), null);
  assert.equal(normalizeEntry('phone', '+225 07 89 45 89 00'), '+2250789458900');
});
