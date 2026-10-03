import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { auditDetails, canDo, describe, generateKey, hashKey, normalizeName, permFor, twoPerson, type ActorRole } from '../worker/adminAuth.ts';

test('permFor: reads are read, money actions are operate, policy changes are own, team and audit are manage, unknown writes are own', () => {
  assert.equal(permFor('GET', '/api/admin/payouts'), 'read');
  assert.equal(permFor('GET', '/api/admin/rules'), 'read');
  for (const p of ['/api/admin/payouts/po123/approve', '/api/admin/payouts/po123/reject', '/api/admin/payouts/po123/release-hold', '/api/admin/payouts/po123/resolve', '/api/admin/payouts/reconcile',
    '/api/admin/refunds', '/api/admin/refunds/rfabc123/approve', '/api/admin/refunds/rfabc123/sent', '/api/admin/buys/abc123/delivered', '/api/admin/sweeps/run', '/api/admin/sweeps/abc123/retry', '/api/admin/kyc/did:privy:x/sync'])
    assert.equal(permFor('POST', p), 'operate', p);
  for (const [m, p] of [['PUT', '/api/admin/rules/R-03/mode'], ['POST', '/api/admin/users/u1/status'], ['POST', '/api/admin/users/u1/clef-flag/clear'], ['POST', '/api/admin/lists'], ['DELETE', '/api/admin/lists/5'], ['POST', '/api/admin/lists/sync'], ['POST', '/api/admin/clef/run-review'], ['POST', '/api/admin/something-new']] as const)
    assert.equal(permFor(m, p), 'own', `${m} ${p}`);
  for (const [m, p] of [['GET', '/api/admin/admins'], ['POST', '/api/admin/admins'], ['POST', '/api/admin/admins/adm1/disable'], ['GET', '/api/admin/audit']] as const) assert.equal(permFor(m, p), 'manage', `${m} ${p}`);
});

test('roles: viewer reads, operator moves money, owner changes policy and runs the team; root only manages the team and reads', () => {
  const grid: Record<ActorRole, [boolean, boolean, boolean, boolean]> = { viewer: [true, false, false, false], operator: [true, true, false, false], owner: [true, true, true, true], root: [true, false, false, true] };
  for (const [role, want] of Object.entries(grid) as [ActorRole, boolean[]][]) assert.deepEqual((['read', 'operate', 'own', 'manage'] as const).map((p) => canDo(role, p)), want, role);
});

test('two-person rule: below the threshold one person; at or above, two different people, compared case-insensitively', () => {
  const t = (over: Partial<Parameters<typeof twoPerson>[0]>) => twoPerson({ amountFcfa: 500_000, minFcfa: 0, firstApprover: null, approver: 'amy@x.io', ...over });
  assert.equal(t({}), 'first', 'threshold 0 means every payout');
  assert.equal(t({ firstApprover: 'bob@x.io' }), 'second');
  assert.equal(t({ firstApprover: 'AMY@x.io' }), 'same_person', 'the same person cannot give both approvals, whatever the case');
  assert.equal(t({ minFcfa: 1_000_000 }), 'single', 'below the threshold');
  assert.equal(t({ minFcfa: 500_000 }), 'first', 'the threshold itself needs two');
  assert.equal(t({ minFcfa: 500_001 }), 'single');
});

test('keys: 256 random bits, a recognisable prefix, stored only as a SHA-256 hash', async () => {
  const a = generateKey(), b = generateKey();
  assert.match(a, /^rly_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  const h = await hashKey(a);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, await hashKey(a));
  assert.notEqual(h, await hashKey(b));
});

test('names: lowercase handles or emails starting with a letter; everything else is refused', () => {
  assert.equal(normalizeName('  Amy.K@Relay.io '), 'amy.k@relay.io');
  for (const bad of ['', 'ab', '1amy', 'amy kay', 'a'.repeat(61), null, 7, '<script>']) assert.equal(normalizeName(bad), null, String(bad));
});

test('describe and auditDetails: readable actions and targets; only whitelisted, non-secret fields are kept', () => {
  assert.deepEqual(describe('POST', '/api/admin/payouts/po123/approve'), { action: 'payouts.approve', target: 'po123' });
  assert.deepEqual(describe('POST', '/api/admin/users/did%3Aprivy%3Aabc/status'), { action: 'users.status', target: 'did:privy:abc' });
  assert.deepEqual(describe('PUT', '/api/admin/rules/R-03/mode'), { action: 'rules.mode', target: 'R-03' });
  assert.deepEqual(describe('POST', '/api/admin/admins/adm123/rotate-key'), { action: 'admins.rotate-key', target: 'adm123' });
  assert.deepEqual(describe('POST', '/api/admin/lists'), { action: 'lists.add', target: null });
  assert.deepEqual(describe('POST', '/api/admin/admins'), { action: 'admins.create', target: null });
  assert.deepEqual(describe('POST', '/api/admin/refunds'), { action: 'refunds.request', target: null });
  assert.deepEqual(describe('POST', '/api/admin/something/else'), { action: 'post.something.else', target: null });
  const d = JSON.parse(auditDetails({ note: 'x'.repeat(500), outcome: 'paid', key: 'rly_SECRET', password: 'p', nested: { a: 1 } })!);
  assert.deepEqual(Object.keys(d).sort(), ['note', 'outcome']);
  assert.equal(d.note.length, 300);
  assert.equal(auditDetails({ key: 'rly_SECRET' }), null);
  assert.equal(auditDetails('text'), null);
});

test('the audit log is append-only: the migration\'s triggers refuse updates and deletes', () => {
  const d = new DatabaseSync(':memory:');
  const sql = readFileSync(new URL('../migrations/0013_admins.sql', import.meta.url), 'utf8').replace(/ALTER TABLE payouts[^;]*;/g, '');
  d.exec(sql);
  d.prepare('INSERT INTO admin_audit (at, actor, role, method, path, action, status) VALUES (1, ?, ?, ?, ?, ?, ?)').run('amy', 'operator', 'POST', '/x', 'payouts.approve', 200);
  assert.throws(() => d.prepare('UPDATE admin_audit SET actor = ?').run('bob'), /append-only/);
  assert.throws(() => d.prepare('DELETE FROM admin_audit').run(), /append-only/);
  assert.equal((d.prepare('SELECT COUNT(*) AS n FROM admin_audit').get() as { n: number }).n, 1);
  // names are unique regardless of case, and only the three roles exist
  d.prepare("INSERT INTO admins (id, name, role, key_hash, created_by, created_at) VALUES ('a', 'Amy@x.io', 'owner', 'h1', 'root', 1)").run();
  assert.throws(() => d.prepare("INSERT INTO admins (id, name, role, key_hash, created_by, created_at) VALUES ('b', 'amy@X.io', 'viewer', 'h2', 'root', 1)").run(), /UNIQUE/);
  assert.throws(() => d.prepare("INSERT INTO admins (id, name, role, key_hash, created_by, created_at) VALUES ('c', 'cara', 'god', 'h3', 'root', 1)").run(), /CHECK/);
});
