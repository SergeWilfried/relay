/**
 * Named back-office accounts and the audit log (see worker/adminAuth.ts for roles and the two-person rule).
 * Keys are generated here, shown once, and stored only as a SHA-256 hash.
 */
import { auditDetails, describe, generateKey, hashKey, isRole, normalizeName, type Actor, type Role } from './adminAuth';
import { safeEqual } from './svix';

export class AdminError extends Error {
	status: number;
	constructor(message: string, status = 400) { super(message); this.status = status; }
}

export interface AdminRow { id: string; name: string; role: Role; active: number; created_by: string; created_at: number; last_used_at: number | null; disabled_at: number | null; disabled_by: string | null }
const COLS = 'id, name, role, active, created_by, created_at, last_used_at, disabled_at, disabled_by';

/** Who is calling? The root key (an env secret), or a personal key looked up by its hash. null = nobody. */
export async function authenticateAdmin(request: Request, env: Env): Promise<Actor | null> {
	const key = /^Bearer (.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
	if (!key) return null;
	if (env.ADMIN_API_KEY && env.ADMIN_API_KEY.length >= 16 && safeEqual(key, env.ADMIN_API_KEY)) return { id: 'root', name: 'root', role: 'root' };
	if (!key.startsWith('rly_') || key.length > 100) return null;
	const row = await env.DB.prepare('SELECT id, name, role, last_used_at FROM admins WHERE key_hash = ? AND active = 1').bind(await hashKey(key)).first<{ id: string; name: string; role: Role; last_used_at: number | null }>();
	if (!row) return null;
	const now = Date.now();
	if (!row.last_used_at || now - row.last_used_at > 60_000) await env.DB.prepare('UPDATE admins SET last_used_at = ? WHERE id = ?').bind(now, row.id).run();
	return { id: row.id, name: row.name, role: row.role };
}

export const listAdmins = async (env: Env): Promise<AdminRow[]> => (await env.DB.prepare(`SELECT ${COLS} FROM admins ORDER BY created_at`).all<AdminRow>()).results;
const getAdmin = (env: Env, id: string) => env.DB.prepare(`SELECT ${COLS} FROM admins WHERE id = ?`).bind(id).first<AdminRow>();

async function activeOwners(env: Env): Promise<number> {
	return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM admins WHERE role = 'owner' AND active = 1`).first<{ n: number }>())?.n ?? 0;
}

/** Creates a person. The key is returned once and never again: only its hash is kept. */
export async function createAdmin(env: Env, by: Actor, input: { name: unknown; role: unknown }): Promise<{ admin: AdminRow; key: string }> {
	const name = normalizeName(input.name);
	if (!name) throw new AdminError('name must be 3 to 60 characters: lowercase letters, digits and . _ @ + - (an email works), starting with a letter');
	if (!isRole(input.role)) throw new AdminError('role must be viewer, operator or owner');
	const key = generateKey();
	const id = `adm${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
	try {
		await env.DB.prepare('INSERT INTO admins (id, name, role, key_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, name, input.role, await hashKey(key), by.name, Date.now()).run();
	} catch (e) {
		if (/UNIQUE/i.test(e instanceof Error ? e.message : '')) throw new AdminError('That name is already taken', 409);
		throw e;
	}
	return { admin: (await getAdmin(env, id))!, key };
}

/** A new key for a person (the old one stops working at once). Used when a key leaks or a phone is lost. */
export async function rotateKey(env: Env, id: string): Promise<{ admin: AdminRow; key: string }> {
	const a = await getAdmin(env, id);
	if (!a) throw new AdminError('Not found', 404);
	if (!a.active) throw new AdminError('This account is disabled', 409);
	const key = generateKey();
	await env.DB.prepare('UPDATE admins SET key_hash = ? WHERE id = ?').bind(await hashKey(key), id).run();
	return { admin: a, key };
}

/** Disable (or re-enable) a person. You can't disable yourself, and the last active owner can't be disabled (nobody could manage the team). */
export async function setActive(env: Env, by: Actor, id: string, active: boolean): Promise<AdminRow> {
	const a = await getAdmin(env, id);
	if (!a) throw new AdminError('Not found', 404);
	if (!active) {
		if (a.id === by.id) throw new AdminError('You cannot disable your own account', 409);
		if (a.role === 'owner' && a.active && (await activeOwners(env)) <= 1) throw new AdminError('This is the last active owner: create another owner first', 409);
	}
	await env.DB.prepare('UPDATE admins SET active = ?, disabled_at = ?, disabled_by = ? WHERE id = ?').bind(active ? 1 : 0, active ? null : Date.now(), active ? null : by.name, id).run();
	return (await getAdmin(env, id))!;
}

/** Change a person's role. Same last-owner guard; you can't change your own role. */
export async function setRole(env: Env, by: Actor, id: string, role: unknown): Promise<AdminRow> {
	if (!isRole(role)) throw new AdminError('role must be viewer, operator or owner');
	const a = await getAdmin(env, id);
	if (!a) throw new AdminError('Not found', 404);
	if (a.id === by.id) throw new AdminError('You cannot change your own role', 409);
	if (a.role === 'owner' && role !== 'owner' && a.active && (await activeOwners(env)) <= 1) throw new AdminError('This is the last active owner: create another owner first', 409);
	await env.DB.prepare('UPDATE admins SET role = ? WHERE id = ?').bind(role, id).run();
	return (await getAdmin(env, id))!;
}

/** Appends one audit row. A failure to log must not undo an action that already happened, so it is reported, not thrown. */
export async function writeAudit(env: Env, a: { actor: Actor; method: string; pathname: string; status: number; ip: string | null; body: unknown }): Promise<void> {
	const { action, target } = describe(a.method, a.pathname);
	const line = { msg: 'admin.audit', actor: a.actor.name, role: a.actor.role, action, target, status: a.status };
	console.log(JSON.stringify(line));
	try {
		await env.DB.prepare('INSERT INTO admin_audit (at, actor, role, method, path, action, target, status, ip, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
			.bind(Date.now(), a.actor.name, a.actor.role, a.method, a.pathname, action, target, a.status, a.ip, auditDetails(a.body)).run();
	} catch (e) { console.error(JSON.stringify({ ...line, msg: 'admin.audit_failed', error: e instanceof Error ? e.message : String(e) })); }
}

export interface AuditRow { id: number; at: number; actor: string; role: string; method: string; path: string; action: string; target: string | null; status: number; ip: string | null; details: string | null }
export async function listAudit(env: Env, opts: { actor?: string | null; before?: number | null; limit?: number }): Promise<AuditRow[]> {
	const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
	const where: string[] = []; const binds: unknown[] = [];
	if (opts.actor) { where.push('actor = ?'); binds.push(opts.actor); }
	if (opts.before) { where.push('id < ?'); binds.push(opts.before); }
	return (await env.DB.prepare(`SELECT * FROM admin_audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).bind(...binds, limit).all<AuditRow>()).results;
}
