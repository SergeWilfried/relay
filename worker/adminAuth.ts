/**
 * Back-office identity, permissions and the two-person rule. Import-free (Web Crypto only) so plain Node can test it.
 *
 * Roles (each includes the one before it):
 *   viewer    read everything operational
 *   operator  move money and run the day to day: approve / reject payouts, refunds, deliveries, sweeps, hold releases
 *   owner     change policy: rule modes, account status, denylists, Clef, and manage the team
 * The shared ADMIN_API_KEY is the "root" identity: it can manage the team and read, and nothing else, so no money ever moves
 * under a shared credential. If a key leaks or someone leaves, root issues a new personal key.
 */
export type Role = 'viewer' | 'operator' | 'owner';
export type ActorRole = Role | 'root';
export interface Actor { id: string; name: string; role: ActorRole }
export type Perm = 'read' | 'operate' | 'own' | 'manage';

const RANK: Record<Role, number> = { viewer: 0, operator: 1, owner: 2 };
export const isRole = (v: unknown): v is Role => v === 'viewer' || v === 'operator' || v === 'owner';

/** Which permission a request needs. Unknown writes need the strictest one (own), so a new endpoint is never open by accident. */
export function permFor(method: string, pathname: string): Perm {
	if (/^\/api\/admin\/(admins|audit)(\/|$)/.test(pathname)) return 'manage';
	if (method === 'GET' || method === 'HEAD') return 'read';
	const operate = [
		/^\/api\/admin\/payouts\/[A-Za-z0-9]+\/(approve|reject|retry|resolve|release-hold)$/,
		/^\/api\/admin\/payouts\/reconcile$/,
		/^\/api\/admin\/refunds(\/rf[a-z0-9]+\/(approve|sent|cancel))?$/,
		/^\/api\/admin\/buys\/[a-z0-9]+\/(delivered|release-hold)$/,
		/^\/api\/admin\/sweeps(\/run|\/[a-z0-9]+\/(retry|resolve))$/,
		/^\/api\/admin\/kyc\/[^/]+\/sync$/,
	];
	return operate.some((r) => r.test(pathname)) ? 'operate' : 'own';
}

export function canDo(role: ActorRole, perm: Perm): boolean {
	if (role === 'root') return perm === 'read' || perm === 'manage';
	if (perm === 'read') return true;
	if (perm === 'operate') return RANK[role] >= RANK.operator;
	if (perm === 'own') return RANK[role] >= RANK.owner;
	return role === 'owner'; // manage: owners (and root) run the team
}

export type TwoPerson = 'single' | 'first' | 'second' | 'same_person';
/**
 * Two-person approval. At or above `minFcfa` a payout needs two different people: the first approval is recorded, the second one
 * releases it. `minFcfa` 0 means every payout. Names are compared case-insensitively.
 */
export function twoPerson(input: { amountFcfa: number; minFcfa: number; firstApprover: string | null; approver: string }): TwoPerson {
	if (input.amountFcfa < input.minFcfa) return 'single';
	if (!input.firstApprover) return 'first';
	return input.firstApprover.toLowerCase() === input.approver.toLowerCase() ? 'same_person' : 'second';
}

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A new personal key: 256 random bits, shown once, stored only as a hash (so a database leak does not leak keys). */
export function generateKey(): string {
	return `rly_${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
}
export async function hashKey(key: string): Promise<string> {
	return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Names appear in audit rows and refund/payout records: an email-like or plain handle, lowercase. */
export const ADMIN_NAME = /^[a-z][a-z0-9._@+-]{2,59}$/;
export const normalizeName = (v: unknown): string | null => (typeof v === 'string' && ADMIN_NAME.test(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null);

/** A readable action name and target for the audit log. */
export function describe(method: string, pathname: string): { action: string; target: string | null } {
	const p = pathname.replace(/^\/api\/admin\//, '');
	const rules: [RegExp, (m: RegExpExecArray) => { action: string; target: string | null }][] = [
		[/^(payouts|refunds|buys|sweeps)\/([^/]+)\/([a-z-]+)$/, (m) => ({ action: `${m[1]}.${m[3]}`, target: m[2]! })],
		[/^users\/([^/]+)\/(status|clef-flag\/clear)$/, (m) => ({ action: `users.${m[2]!.replace('/', '-')}`, target: decodeURIComponent(m[1]!) })],
		[/^rules\/([^/]+)\/mode$/, (m) => ({ action: 'rules.mode', target: m[1]! })],
		[/^lists\/(\d+)$/, (m) => ({ action: 'lists.remove', target: m[1]! })],
		[/^admins\/([^/]+)\/(rotate-key|disable|enable|role)$/, (m) => ({ action: `admins.${m[2]}`, target: m[1]! })],
		[/^admins$/, () => ({ action: method === 'POST' ? 'admins.create' : 'admins.list', target: null })],
		[/^lists$/, () => ({ action: method === 'POST' ? 'lists.add' : 'lists.list', target: null })],
		[/^refunds$/, () => ({ action: method === 'POST' ? 'refunds.request' : 'refunds.list', target: null })],
		[/^kyc\/([^/]+)\/sync$/, (m) => ({ action: 'kyc.sync', target: decodeURIComponent(m[1]!) })],
	];
	for (const [re, f] of rules) { const m = re.exec(p); if (m) return f(m); }
	return { action: `${method.toLowerCase()}.${p.replace(/\//g, '.')}`, target: null };
}

/** The request fields worth keeping in the audit log. Never anything that could be a secret. */
const KEEP = ['note', 'reason', 'outcome', 'status', 'mode', 'kind', 'value', 'txHash', 'destination', 'orderId', 'amountUnits', 'role', 'name'];
export function auditDetails(body: unknown): string | null {
	if (!body || typeof body !== 'object') return null;
	const out: Record<string, unknown> = {};
	for (const k of KEEP) { const v = (body as Record<string, unknown>)[k]; if (v !== undefined && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) out[k] = typeof v === 'string' ? v.slice(0, 300) : v; }
	return Object.keys(out).length ? JSON.stringify(out) : null;
}
