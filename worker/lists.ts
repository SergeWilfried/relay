/**
 * Recipient denylist. Three kinds of entries:
 *  - phone  : a payout number. Rule R-08 refuses a new sell order whose payout goes to a listed number.
 *  - evm / solana : a blockchain address. (1) A deposit that arrives FROM a listed address is held (rule A-01): the payout can't be
 *    approved and the funds are not swept to the treasury. (2) The address is mirrored into a Privy condition set, which the
 *    user-wallet policies reference (`in_condition_set`) to deny transfers TO it. See scripts/privy-policy-defs.mjs.
 * Allowlists are deliberately not enforced here: see the README ("Allowlists").
 */
export type ListKind = 'phone' | 'evm' | 'solana';
export interface ListRow { id: number; list: string; kind: ListKind; value: string; note: string; added_by: string | null; created_at: number; privy_item_id: string | null }

const PHONE = /^\+\d{8,15}$/;
const EVM = /^0x[0-9a-fA-F]{40}$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Canonical form of a value, or null when it isn't a valid value for that kind. One form per address, so lookups can't be dodged by case or spacing. */
export function normalizeEntry(kind: string, raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const v = raw.trim();
	if (kind === 'phone') { const p = v.replace(/[\s\-()]/g, ''); return PHONE.test(p) ? p : null; }
	if (kind === 'evm') return EVM.test(v) ? v.toLowerCase() : null;
	if (kind === 'solana') return SOL.test(v) ? v : null;
	return null;
}

/** The kind of an on-chain address from the chain it was seen on. */
export const kindOfChain = (chain: 'ethereum' | 'solana'): ListKind => (chain === 'ethereum' ? 'evm' : 'solana');

export async function isDenied(env: Env, kind: ListKind, value: string): Promise<boolean> {
	const r = await env.DB.prepare(`SELECT 1 AS hit FROM recipient_lists WHERE list = 'deny' AND kind = ? AND value = ?`).bind(kind, value).first();
	return !!r;
}

export async function listEntries(env: Env, kind?: string): Promise<ListRow[]> {
	const q = kind ? env.DB.prepare(`SELECT * FROM recipient_lists WHERE kind = ? ORDER BY id DESC LIMIT 500`).bind(kind) : env.DB.prepare(`SELECT * FROM recipient_lists ORDER BY id DESC LIMIT 500`);
	return (await q.all<ListRow>()).results;
}

// ---- Privy condition-set mirror -----------------------------------------------------------------------------------------
// https://docs.privy.io/controls/policies/condition-sets : POST /v1/condition_sets/{id}/condition_set_items with [{value}],
// DELETE /v1/condition_sets/{id}/condition_set_items/{item_id}. Verified against a real Privy app (see the README).

const setIdFor = (env: Env, kind: ListKind): string | undefined => (kind === 'evm' ? env.PRIVY_DENY_SET_EVM : kind === 'solana' ? env.PRIVY_DENY_SET_SOL : undefined) || undefined;

const privyHeaders = (env: Env) => ({ 'content-type': 'application/json', 'privy-app-id': env.PRIVY_APP_ID, authorization: `Basic ${btoa(`${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`)}` });

/** Reads the id of the item we just added from Privy's answer (an array of items, or an object holding one). */
export function itemIdFrom(body: unknown, value: string): string | null {
	const items = Array.isArray(body) ? body : Array.isArray((body as { items?: unknown })?.items) ? (body as { items: unknown[] }).items : [body];
	for (const it of items) {
		const o = it as { id?: unknown; value?: unknown } | null;
		if (o && typeof o.id === 'string' && (o.value === undefined || String(o.value).toLowerCase() === value.toLowerCase())) return o.id;
	}
	return null;
}

export type Sync = { synced: true; itemId: string | null } | { synced: false; reason: string };

export async function pushToPrivy(env: Env, kind: ListKind, value: string): Promise<Sync> {
	const setId = setIdFor(env, kind);
	if (!setId) return { synced: false, reason: kind === 'phone' ? 'phone numbers are not mirrored to Privy' : 'no Privy condition set configured (PRIVY_DENY_SET_EVM / PRIVY_DENY_SET_SOL)' };
	try {
		const res = await fetch(`https://api.privy.io/v1/condition_sets/${encodeURIComponent(setId)}/condition_set_items`, { method: 'POST', headers: privyHeaders(env), body: JSON.stringify([{ value }]), signal: AbortSignal.timeout(8000) });
		if (!res.ok) return { synced: false, reason: `Privy ${res.status}: ${(await res.text()).slice(0, 200)}` };
		return { synced: true, itemId: itemIdFrom(await res.json().catch(() => null), value) };
	} catch (e) { return { synced: false, reason: e instanceof Error ? e.message : String(e) }; }
}

export async function removeFromPrivy(env: Env, kind: ListKind, itemId: string): Promise<Sync> {
	const setId = setIdFor(env, kind);
	if (!setId) return { synced: false, reason: 'no Privy condition set configured' };
	try {
		const res = await fetch(`https://api.privy.io/v1/condition_sets/${encodeURIComponent(setId)}/condition_set_items/${encodeURIComponent(itemId)}`, { method: 'DELETE', headers: privyHeaders(env), signal: AbortSignal.timeout(8000) });
		return res.ok || res.status === 404 ? { synced: true, itemId: null } : { synced: false, reason: `Privy ${res.status}: ${(await res.text()).slice(0, 200)}` };
	} catch (e) { return { synced: false, reason: e instanceof Error ? e.message : String(e) }; }
}

export class ListError extends Error {}

/** Adds an entry (idempotent) and mirrors addresses to Privy. The entry is enforced locally even if the Privy sync fails. */
export async function addEntry(env: Env, kind: string, rawValue: unknown, note: string, by: string): Promise<{ entry: ListRow; sync: Sync }> {
	const value = normalizeEntry(kind, rawValue);
	if (!value) throw new ListError(`Not a valid ${kind === 'phone' ? 'phone number (+ and country code)' : kind === 'evm' ? 'EVM address (0x…)' : kind === 'solana' ? 'Solana address' : 'entry'}`);
	await env.DB.prepare(`INSERT OR IGNORE INTO recipient_lists (list, kind, value, note, added_by, created_at) VALUES ('deny', ?, ?, ?, ?, ?)`).bind(kind, value, note, by, Date.now()).run();
	let entry = (await env.DB.prepare(`SELECT * FROM recipient_lists WHERE list = 'deny' AND kind = ? AND value = ?`).bind(kind, value).first<ListRow>())!;
	if (kind === 'phone') return { entry, sync: { synced: false, reason: 'phone numbers are enforced by Relay only (not mirrored to Privy)' } };
	if (entry.privy_item_id) return { entry, sync: { synced: true, itemId: entry.privy_item_id } };
	const sync = await pushToPrivy(env, kind as ListKind, value);
	if (sync.synced && sync.itemId) {
		await env.DB.prepare(`UPDATE recipient_lists SET privy_item_id = ? WHERE id = ?`).bind(sync.itemId, entry.id).run();
		entry = { ...entry, privy_item_id: sync.itemId };
	}
	console.log(JSON.stringify({ msg: 'lists.added', kind, id: entry.id, by, synced: sync.synced }));
	return { entry, sync };
}

export async function removeEntry(env: Env, id: number, by: string): Promise<{ removed: boolean; sync: Sync | null }> {
	const e = await env.DB.prepare(`SELECT * FROM recipient_lists WHERE id = ?`).bind(id).first<ListRow>();
	if (!e) return { removed: false, sync: null };
	// Privy first: if its set can't be updated we keep the local entry too, so the two never disagree about a removal
	let sync: Sync | null = null;
	if (e.privy_item_id) {
		sync = await removeFromPrivy(env, e.kind, e.privy_item_id);
		if (!sync.synced) return { removed: false, sync };
	}
	await env.DB.prepare(`DELETE FROM recipient_lists WHERE id = ?`).bind(id).run();
	console.log(JSON.stringify({ msg: 'lists.removed', kind: e.kind, id, by }));
	return { removed: true, sync };
}

/** Re-pushes address entries that never reached Privy (no set configured at the time, or an error). */
export async function resyncEntries(env: Env): Promise<{ pushed: number; failed: number; skipped: number }> {
	const { results } = await env.DB.prepare(`SELECT * FROM recipient_lists WHERE list = 'deny' AND kind IN ('evm', 'solana') AND privy_item_id IS NULL`).all<ListRow>();
	let pushed = 0, failed = 0, skipped = 0;
	for (const e of results) {
		if (!setIdFor(env, e.kind)) { skipped++; continue; }
		const s = await pushToPrivy(env, e.kind, e.value);
		if (s.synced) { pushed++; if (s.itemId) await env.DB.prepare(`UPDATE recipient_lists SET privy_item_id = ? WHERE id = ?`).bind(s.itemId, e.id).run(); } else failed++;
	}
	return { pushed, failed, skipped };
}
