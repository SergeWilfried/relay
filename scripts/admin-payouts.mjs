// Back-office CLI for payouts (talks to /api/admin/*, protected by ADMIN_API_KEY).
//   ADMIN_API_KEY=... API_URL=https://your-domain node scripts/admin-payouts.mjs list [status]
//   ... approve <payoutId> | reject <payoutId> "<reason>" | retry <payoutId> | resolve <payoutId> paid|failed "<note>"
// Locally: reads ADMIN_API_KEY from .dev.vars and defaults API_URL to http://localhost:5173.
import { readFileSync } from 'node:fs';

const key = process.env.ADMIN_API_KEY ?? /ADMIN_API_KEY=(\S+)/.exec(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'))?.[1];
const base = process.env.API_URL ?? 'http://localhost:5173';
const [cmd, id, a, b] = process.argv.slice(2);
if (!key) throw new Error('Set ADMIN_API_KEY');

const call = async (path, method = 'GET', body) => {
  const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`${res.status}`, json); process.exit(1); }
  return json;
};

if (cmd === 'list') {
  const { payouts } = await call(`/api/admin/payouts${id ? `?status=${id}` : ''}`);
  console.table(payouts.map((p) => ({ id: p.id, order: p.order_id, status: p.status, fcfa: p.amount_fcfa, to: `${p.operator} ${p.phone}`, attempts: p.attempts, error: p.error ?? '' })));
} else if (cmd === 'approve') console.log(await call(`/api/admin/payouts/${id}/approve`, 'POST'));
else if (cmd === 'retry') console.log(await call(`/api/admin/payouts/${id}/retry`, 'POST'));
else if (cmd === 'reject') console.log(await call(`/api/admin/payouts/${id}/reject`, 'POST', { reason: a }));
else if (cmd === 'resolve') console.log(await call(`/api/admin/payouts/${id}/resolve`, 'POST', { outcome: a, note: b }));
else console.log('Usage: list [status] | approve <id> | reject <id> <reason> | retry <id> | resolve <id> paid|failed <note>');
