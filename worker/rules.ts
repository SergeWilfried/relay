/**
 * Server-side rule engine for new sell orders (the fiat-out ramp), following the protection matrix:
 *  - Rules are versioned data (id, version, mode, condition, action), evaluated in a fixed order by `phase`:
 *      2 account status (P-06 restricted, P-07 frozen) -> 3 hard blocks (sanctions) -> 4 limits (adjusted by D-03)
 *      -> 5 dynamic holds (D-01, D-02, D-09). (Phase 1, circuit breakers, is not built yet.)
 *  - "Hold, don't reject": suspicious activity HOLDS the payout for review with a clear user message; only limits,
 *    sanctions and frozen accounts are refused.
 *  - "Most restrictive wins": deny > hold > allow; among holds, the longest (or "until review") applies.
 *  - "Shadow first": a rule in mode 'shadow' is evaluated and logged but never changes the outcome. New rules ship in
 *    shadow; promote one at a time with PUT /api/admin/rules/:id/mode (stored in KV, no deploy needed).
 *  - Everything is logged: see `logDecision` (rule id, version, mode, applied, inputs, final action, user message).
 * The decision is made HERE from server-priced amounts and server-side history, never from anything the client claims.
 */
import { KYC_THRESHOLD_FCFA, LIMITS, MIN_FCFA, tierLimits } from './limits.ts';
export { KYC_THRESHOLD_FCFA, MIN_FCFA, tierLimits };

export type Mode = 'shadow' | 'enforce';
export type RuleAction =
	| { type: 'deny'; status: number }
	| { type: 'hold'; hours?: number } // no hours = until an analyst releases it
	| { type: 'scale_limits'; factor: number };

type Cmp = { lt?: number; lte?: number; gt?: number; gte?: number; eq?: number | string | boolean | null; in?: (string | null)[] };
export interface Rule {
	id: string; version: number; mode: Mode; phase: 2 | 3 | 4 | 5;
	description: string;
	/** every key is a fact name; all must match (AND). A bare value means eq. */
	when: Record<string, Cmp | string | number | boolean>;
	action: RuleAction;
	user_message: string;
}

/** The verified tier's limits (the ceiling). Per-user limits come from tierLimits(): see worker/limits.ts, the single source of truth. */
export const BASE_LIMITS = LIMITS.verified;
/** ISO 3166-1 alpha-2, by request IP. Deny-only (an IP can be spoofed, so a country never grants anything). Have compliance confirm this list. */
export const BLOCKED_COUNTRIES = ['KP', 'IR', 'SY', 'CU'];

export const RULES: Rule[] = [
	{ id: 'P-07', version: 1, mode: 'enforce', phase: 2, description: 'Frozen account: all fiat-out denied pending a compliance decision',
		when: { user_status: 'frozen' }, action: { type: 'deny', status: 403 }, user_message: 'Your account is under review. Please contact support.' },
	{ id: 'P-06', version: 1, mode: 'enforce', phase: 2, description: 'Restricted (high-risk) account: every payout is held for review',
		when: { user_status: 'restricted' }, action: { type: 'hold' }, user_message: 'Your payout is under review. We will update you shortly.' },
	{ id: 'R-01', version: 1, mode: 'enforce', phase: 3, description: 'Request from a sanctioned country',
		when: { country_blocked: true }, action: { type: 'deny', status: 403 }, user_message: 'Service is not available in your country' },
	{ id: 'K-01', version: 1, mode: 'enforce', phase: 3, description: 'Order, or the day\'s total, above the KYC threshold without an approved identity check',
		when: { kyc_required: true, kyc_approved: false }, action: { type: 'deny', status: 403 }, user_message: 'Verify your identity to continue.' },
	{ id: 'R-08', version: 1, mode: 'enforce', phase: 3, description: 'Payout number is on the recipient denylist',
		when: { payout_number_denied: true }, action: { type: 'deny', status: 403 }, user_message: 'This payout number cannot be used. Please contact support.' },
	{ id: 'R-02', version: 1, mode: 'enforce', phase: 4, description: 'Below the minimum amount',
		when: { amount_fcfa: { lt: MIN_FCFA } }, action: { type: 'deny', status: 422 }, user_message: 'Amount is below the minimum' },
	{ id: 'R-03', version: 2, mode: 'enforce', phase: 4, description: 'Over the per-transaction limit',
		when: { over_per_tx_fcfa: { gt: 0 } }, action: { type: 'deny', status: 422 }, user_message: 'Exceeds the per-transaction limit' },
	{ id: 'R-04', version: 2, mode: 'enforce', phase: 4, description: 'Over the daily limit',
		when: { over_day_fcfa: { gt: 0 } }, action: { type: 'deny', status: 422 }, user_message: 'Daily limit reached' },
	{ id: 'R-05', version: 2, mode: 'enforce', phase: 4, description: 'Over the monthly limit',
		when: { over_month_fcfa: { gt: 0 } }, action: { type: 'deny', status: 422 }, user_message: 'Monthly limit reached' },
	{ id: 'R-06', version: 1, mode: 'enforce', phase: 4, description: 'Too many orders waiting for a deposit',
		when: { open_orders: { gte: 3 } }, action: { type: 'deny', status: 429 }, user_message: 'Too many open orders. Complete them or wait for them to expire.' },
	{ id: 'R-07', version: 1, mode: 'enforce', phase: 4, description: 'Too many orders in an hour',
		when: { orders_last_hour: { gte: 10 } }, action: { type: 'deny', status: 429 }, user_message: 'Too many orders in a short time. Try again later.' },
	{ id: 'D-03', version: 1, mode: 'shadow', phase: 4, description: 'Account younger than 14 days: all limits at 50%',
		when: { account_age_days: { lt: 14 } }, action: { type: 'scale_limits', factor: 0.5 }, user_message: '' },
	{ id: 'D-01', version: 1, mode: 'shadow', phase: 5, description: 'New country since the last request: hold fiat-out 24 h (no device signal on the server yet)',
		when: { country_changed: true }, action: { type: 'hold', hours: 24 }, user_message: 'For your security, your payout is on hold for 24 hours after a sign-in from a new country.' },
	{ id: 'D-02', version: 1, mode: 'shadow', phase: 5, description: 'Payout number differs from the ones used before: hold 48 h',
		when: { payout_number_changed: true }, action: { type: 'hold', hours: 48 }, user_message: 'For your security, a payout to a new number is on hold for 48 hours.' },
	{ id: 'D-11', version: 1, mode: 'shadow', phase: 5, description: 'Clef (C-04) flagged a laundering pattern: hold payouts until an analyst clears the flag (the P-06 effect)',
		when: { clef_flag_active: true }, action: { type: 'hold' }, user_message: 'Your payout is under review, usually under 2 hours.' },
	{ id: 'D-09', version: 1, mode: 'shadow', phase: 5, description: 'Limit probing: 3+ requests within 10% of the per-transaction limit in 7 days',
		when: { near_limit_requests_7d: { gte: 3 } }, action: { type: 'hold' }, user_message: 'Your payout is under review, usually under 2 hours.' },
];

/** Inputs loaded from the database and the request (see loadFacts). */
export interface BaseFacts {
	amount_fcfa: number; country: string | null; user_status: string; account_age_days: number; tier: number;
	day_fcfa: number; month_fcfa: number; open_orders: number; orders_last_hour: number;
	country_changed: boolean; payout_number_changed: boolean;
	/** Clef (C-04) flagged a pattern in this user's recent activity and an analyst hasn't cleared it */
	clef_flag_active: boolean;
	/** the payout number is on the recipient denylist (worker/lists.ts) */
	payout_number_denied: boolean;
	/** the user has an approved identity check (worker/kyc.ts) */
	kyc_approved: boolean;
	/** earlier requests in the last 7 days between 90% and 100% of the per-transaction limit (this request is added by evaluate) */
	prior_near_limit_7d: number;
}
export type Facts = BaseFacts & Record<string, number | string | boolean | null>;

export interface Fired { id: string; version: number; mode: Mode; action: RuleAction['type']; applied: boolean }
export type Outcome =
	| { action: 'allow'; fired: Fired[]; limits: Limits; facts: Facts }
	| { action: 'deny'; status: number; message: string; ruleIds: string[]; fired: Fired[]; limits: Limits; facts: Facts }
	| { action: 'hold'; hours: number | null; message: string; ruleIds: string[]; fired: Fired[]; limits: Limits; facts: Facts };
export interface Limits { perTx: number; daily: number; monthly: number; factor: number }

const matches = (v: unknown, spec: Cmp | string | number | boolean): boolean => {
	if (typeof spec !== 'object') return v === spec;
	const n = typeof v === 'number' ? v : NaN;
	if (spec.lt !== undefined && !(n < spec.lt)) return false;
	if (spec.lte !== undefined && !(n <= spec.lte)) return false;
	if (spec.gt !== undefined && !(n > spec.gt)) return false;
	if (spec.gte !== undefined && !(n >= spec.gte)) return false;
	if (spec.eq !== undefined && v !== spec.eq) return false;
	if (spec.in !== undefined && !spec.in.includes(v as string | null)) return false;
	return true;
};
const fires = (r: Rule, f: Facts) => Object.entries(r.when).every(([k, spec]) => matches(f[k], spec));

const SEVERITY = { allow: 0, hold: 1, deny: 2 } as const;

/** Pure: no I/O, so it is unit-tested. `modes` overrides each rule's configured mode (promote shadow -> enforce without a deploy). */
export function evaluate(base: BaseFacts, opts: { rules?: Rule[]; modes?: Record<string, Mode> } = {}): Outcome {
	const rules = opts.rules ?? RULES;
	const modeOf = (r: Rule): Mode => opts.modes?.[r.id] ?? r.mode;
	const fired: Fired[] = [];
	const hit = new Map<string, Rule>(); // enforced rules that fired
	const record = (r: Rule) => {
		const applied = modeOf(r) === 'enforce';
		fired.push({ id: r.id, version: r.version, mode: modeOf(r), action: r.action.type, applied });
		if (applied) hit.set(r.id, r);
	};

	const near = base.amount_fcfa >= 0.9 * BASE_LIMITS.perTx && base.amount_fcfa <= BASE_LIMITS.perTx ? 1 : 0;
	const facts0: Facts = { ...base, country_blocked: !!base.country && BLOCKED_COUNTRIES.includes(base.country), kyc_required: base.amount_fcfa > KYC_THRESHOLD_FCFA || base.day_fcfa + base.amount_fcfa > KYC_THRESHOLD_FCFA, near_limit_requests_7d: base.prior_near_limit_7d + near };

	// D-03 style rules first: "tier limits adjusted by D-03" (phase 4 of the matrix order)
	let factor = 1;
	for (const r of rules) if (r.action.type === 'scale_limits' && fires(r, facts0)) { record(r); if (modeOf(r) === 'enforce') factor = Math.min(factor, r.action.factor); }

	const t = tierLimits(base.tier);
	const limits: Limits = { perTx: Math.floor(t.perTx * factor), daily: Math.floor(t.daily * factor), monthly: Math.floor(t.monthly * factor), factor };
	const facts: Facts = {
		...facts0,
		over_per_tx_fcfa: base.amount_fcfa - limits.perTx,
		over_day_fcfa: base.day_fcfa + base.amount_fcfa - limits.daily,
		over_month_fcfa: base.month_fcfa + base.amount_fcfa - limits.monthly,
	};

	for (const r of [...rules].sort((a, b) => a.phase - b.phase)) if (r.action.type !== 'scale_limits' && fires(r, facts)) record(r);

	const enforced = [...hit.values()];
	const denies = enforced.filter((r) => r.action.type === 'deny');
	if (denies.length) {
		const first = denies[0]!; // lowest phase first: the order of the matrix decides which message the user sees
		return { action: 'deny', status: (first.action as { status: number }).status, message: first.user_message, ruleIds: denies.map((r) => r.id), fired, limits, facts };
	}
	const holds = enforced.filter((r) => r.action.type === 'hold');
	if (holds.length) {
		const untilReview = holds.find((r) => (r.action as { hours?: number }).hours === undefined);
		const longest = holds.reduce((a, b) => ((b.action as { hours?: number }).hours ?? 0) > ((a.action as { hours?: number }).hours ?? 0) ? b : a);
		const pick = untilReview ?? longest;
		return { action: 'hold', hours: untilReview ? null : (longest.action as { hours: number }).hours, message: pick.user_message, ruleIds: holds.map((r) => r.id), fired, limits, facts };
	}
	return { action: 'allow', fired, limits, facts };
}

export const severity = (o: Outcome) => SEVERITY[o.action];

export class RuleDenied extends Error {
	status: number;
	ruleIds: string[];
	constructor(message: string, status: number, ruleIds: string[]) { super(message); this.status = status; this.ruleIds = ruleIds; }
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Calendar day / month in UTC, which is local time in Senegal, Côte d'Ivoire and Burkina Faso (all UTC+0). */
export const windowStarts = (now: number) => {
	const d = new Date(now);
	return { day: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), month: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) };
};

/**
 * Orders that count against a user's limits: not underpaid, not an unpaid order whose window has closed, and not a
 * rejected or failed payout (that money never left). Shared by the read and by the atomic insert so they can't drift.
 */
export const COUNTED = `o.user_id = ?1 AND o.amount_fcfa IS NOT NULL AND o.status != 'underpaid'
	AND NOT (o.status = 'awaiting_deposit' AND o.expires_at < ?2)
	AND COALESCE((SELECT p.status FROM payouts p WHERE p.order_id = o.id), '') NOT IN ('rejected', 'failed')`;

/**
 * Buy orders that count against a user's limits (together with sells): not failed, expired or cancelled, and not an unpaid one whose
 * window has closed. Uses ?1 = user and ?2 = now, like COUNTED.
 */
export const BUY_COUNTED = `b.user_id = ?1 AND b.status NOT IN ('failed', 'expired', 'cancelled') AND NOT (b.status = 'created' AND b.expires_at < ?2)`;

/** Swaps that count against a user's limits (same ?1 user as COUNTED): not failed or rejected, since that value never moved. */
export const SWAP_COUNTED = `s.user_id = ?1 AND s.status NOT IN ('failed', 'rejected')`;

/** Total FCFA a user has moved since `since` (a bind placeholder such as '?3'): sells + buys + swaps. One definition for the read and the guards. */
export const usageSince = (since: string) =>
	`(SELECT COALESCE(SUM(o.amount_fcfa), 0) FROM orders o WHERE ${COUNTED} AND o.created_at >= ${since})
	 + (SELECT COALESCE(SUM(b.fcfa), 0) FROM buy_orders b WHERE ${BUY_COUNTED} AND b.created_at >= ${since})
	 + (SELECT COALESCE(SUM(s.fcfa_value), 0) FROM swap_orders s WHERE ${SWAP_COUNTED} AND s.created_at >= ${since})`;

/**
 * WHERE-clause for the atomic inserts of sells, buys and swaps: the new amount (?5) still fits the daily (?6) and monthly (?7) limits.
 * Binds: ?1 user, ?2 now, ?3 start of day, ?4 start of month.
 */
export const LIMIT_GUARD = `${usageSince('?3')} + ?5 <= ?6 AND ${usageSince('?4')} + ?5 <= ?7`;

export interface Profile { firstSeenAt: number; lastCountry: string | null; status: string; clefFlag: boolean; kycApproved: boolean }

/** Creates the profile on first sight (account age starts here) and returns it. */
export async function ensureProfile(env: Env, userId: string, country: string | null, now: number): Promise<Profile> {
	const read = () => env.DB.prepare(`SELECT p.first_seen_at, p.last_country, p.status, p.clef_flag, (SELECT 1 FROM kyc k WHERE k.user_id = p.user_id AND k.status = 'approved') AS kyc_ok FROM user_profile p WHERE p.user_id = ?`).bind(userId).first<{ first_seen_at: number; last_country: string | null; status: string; clef_flag: string | null; kyc_ok: number | null }>();
	// the profile exists for every returning user, and this runs on every authenticated request (including 6-second polls): read first, write only the first time
	let r = await read();
	if (!r) {
		await env.DB.prepare(`INSERT OR IGNORE INTO user_profile (user_id, first_seen_at, last_country, updated_at) VALUES (?, ?, ?, ?)`).bind(userId, now, country, now).run();
		r = await read();
	}
	return { firstSeenAt: r!.first_seen_at, lastCountry: r!.last_country, status: r!.status, clefFlag: !!r!.clef_flag, kycApproved: !!r!.kyc_ok };
}

export async function loadModes(env: Env): Promise<Record<string, Mode>> {
	try { return JSON.parse((await env.EVENTS.get('rules:modes')) ?? '{}') as Record<string, Mode>; } catch { return {}; }
}

export async function setRuleMode(env: Env, id: string, mode: Mode): Promise<void> {
	const modes = await loadModes(env);
	modes[id] = mode;
	await env.EVENTS.put('rules:modes', JSON.stringify(modes));
	console.log(JSON.stringify({ msg: 'rules.mode_changed', id, mode }));
}

export async function setUserStatus(env: Env, userId: string, status: 'normal' | 'restricted' | 'frozen', note: string): Promise<void> {
	const now = Date.now();
	await env.DB.prepare(`INSERT INTO user_profile (user_id, first_seen_at, status, status_note, updated_at) VALUES (?1, ?2, ?3, ?4, ?2)
		ON CONFLICT(user_id) DO UPDATE SET status = ?3, status_note = ?4, updated_at = ?2`).bind(userId, now, status, note).run();
	console.log(JSON.stringify({ msg: 'rules.user_status', user: userId, status, note }));
}

export async function loadFacts(env: Env, userId: string, input: { amountFcfa: number; phone: string; country: string | null; /** a PI-SPI alias is checked against the alias denylist, case-insensitively */ kind?: 'phone' | 'alias' }, profile: Profile, now: number): Promise<BaseFacts> {
	const w = windowStarts(now);
	// seven independent reads: one round trip's worth of waiting instead of seven
	const [usage, rate, phones, near, buys, swaps, denied] = await Promise.all([
		env.DB.prepare(
			`SELECT
			   COALESCE(SUM(CASE WHEN o.created_at >= ?3 THEN o.amount_fcfa END), 0) AS day,
			   COALESCE(SUM(CASE WHEN o.created_at >= ?4 THEN o.amount_fcfa END), 0) AS month,
			   COALESCE(SUM(CASE WHEN o.status = 'awaiting_deposit' THEN 1 END), 0) AS open
			 FROM orders o WHERE ${COUNTED} AND o.created_at >= ?4`,
		).bind(userId, now, w.day, w.month).first<{ day: number; month: number; open: number }>(),
		// velocity counts every order created, whatever happened to it (a burst of cancelled orders is still a burst)
		env.DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND created_at >= ?`).bind(userId, now - HOUR_MS).first<{ n: number }>(),
		env.DB.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(phone = ?), 0) AS same FROM orders WHERE user_id = ? AND phone IS NOT NULL`).bind(input.phone, userId).first<{ total: number; same: number }>(),
		env.DB.prepare(`SELECT COUNT(*) AS n FROM decisions WHERE user_id = ? AND created_at >= ? AND amount_fcfa >= ? AND amount_fcfa <= ?`)
			.bind(userId, now - 7 * DAY_MS, 0.9 * BASE_LIMITS.perTx, BASE_LIMITS.perTx).first<{ n: number }>(),
		// buys count toward the same daily / monthly limits and the open-order cap
		env.DB.prepare(
			`SELECT COALESCE(SUM(CASE WHEN b.created_at >= ?3 THEN b.fcfa END), 0) AS day, COALESCE(SUM(CASE WHEN b.created_at >= ?4 THEN b.fcfa END), 0) AS month,
			        COALESCE(SUM(CASE WHEN b.status IN ('created', 'collecting') THEN 1 END), 0) AS open
			 FROM buy_orders b WHERE ${BUY_COUNTED} AND b.created_at >= ?4`,
		).bind(userId, now, w.day, w.month).first<{ day: number; month: number; open: number }>(),
		// swaps count too: the limits are about value moved, whichever screen moved it
		env.DB.prepare(
			`SELECT COALESCE(SUM(CASE WHEN s.created_at >= ?3 THEN s.fcfa_value END), 0) AS day, COALESCE(SUM(s.fcfa_value), 0) AS month
			 FROM swap_orders s WHERE ${SWAP_COUNTED} AND s.created_at >= ?4`,
		).bind(userId, now, w.day, w.month).first<{ day: number; month: number }>(),
		// inline (not worker/lists.ts) so this file stays free of imports and testable in plain Node
		env.DB.prepare(`SELECT 1 AS hit FROM recipient_lists WHERE list = 'deny' AND kind = ? AND value = ?`).bind(input.kind ?? 'phone', input.kind === 'alias' ? input.phone.toLowerCase() : input.phone).first(),
	]);
	return {
		amount_fcfa: input.amountFcfa, country: input.country, user_status: profile.status,
		account_age_days: Math.floor((now - profile.firstSeenAt) / DAY_MS), tier: profile.kycApproved ? 1 : 0, kyc_approved: profile.kycApproved,
		day_fcfa: (usage?.day ?? 0) + (buys?.day ?? 0) + (swaps?.day ?? 0), month_fcfa: (usage?.month ?? 0) + (buys?.month ?? 0) + (swaps?.month ?? 0), open_orders: (usage?.open ?? 0) + (buys?.open ?? 0), orders_last_hour: rate?.n ?? 0,
		country_changed: !!input.country && !!profile.lastCountry && input.country !== profile.lastCountry,
		// a first-ever number is the baseline, not a change
		payout_number_changed: (phones?.total ?? 0) > 0 && (phones?.same ?? 0) === 0,
		prior_near_limit_7d: near?.n ?? 0,
		clef_flag_active: profile.clefFlag,
		payout_number_denied: !!denied,
	};
}

/** What the customer sees on the Account page and in the trade form: their effective limits and what they have used (from the server's records). */
export interface LimitsView {
	tier: number; verified: boolean;
	limits: { perTx: number; daily: number; monthly: number };
	/** the verified tier's limits: what verification unlocks */
	ceiling: { perTx: number; daily: number; monthly: number };
	used: { day: number; month: number };
	kycThresholdFcfa: number; minFcfa: number;
}

export async function loadLimitsView(env: Env, userId: string, now: number): Promise<LimitsView> {
	const profile = await ensureProfile(env, userId, null, now);
	const w = windowStarts(now);
	const r = await env.DB.prepare(`SELECT ${usageSince('?3')} AS day, ${usageSince('?4')} AS month`).bind(userId, now, w.day, w.month).first<{ day: number; month: number }>();
	const tier = profile.kycApproved ? 1 : 0;
	return { tier, verified: profile.kycApproved, limits: { ...tierLimits(tier) }, ceiling: { ...LIMITS.verified }, used: { day: r?.day ?? 0, month: r?.month ?? 0 }, kycThresholdFcfa: KYC_THRESHOLD_FCFA, minFcfa: MIN_FCFA };
}

export async function logDecision(env: Env, d: { userId: string; orderId: string; outcome: Outcome }) {
	const o = d.outcome;
	const message = o.action === 'allow' ? null : o.message;
	console.log(JSON.stringify({ msg: 'rules.decision', user: d.userId, order: d.orderId, decision: o.action, fired: o.fired, amountFcfa: o.facts.amount_fcfa }));
	// The structured log line above is the fallback record. A failed audit INSERT must never turn an already-created
	// order into a 500 (the client would retry a request that partly succeeded), so it is reported, not thrown.
	try { await env.DB.prepare(`INSERT INTO decisions (user_id, order_id, decision, rules, amount_fcfa, country, created_at, fired, facts, message, tier)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
		.bind(d.userId, d.orderId, o.action, JSON.stringify(o.action === 'allow' ? [] : o.ruleIds), o.facts.amount_fcfa, o.facts.country, Date.now(), JSON.stringify(o.fired), JSON.stringify(o.facts), message, o.facts.tier).run();
	} catch (e) { console.error(JSON.stringify({ msg: 'rules.decision_log_failed', order: d.orderId, error: e instanceof Error ? e.message : String(e) })); }
}
