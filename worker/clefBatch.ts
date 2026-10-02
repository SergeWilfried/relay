import { askClef, buildActivityState, PATTERN_QUESTIONS, patternVerdict, POINTS, type ActivityOrder } from './clef';
import { notify } from './notify';
import { BASE_LIMITS, loadModes } from './rules';

const DAY_MS = 86_400_000;
const MAX_USERS_PER_RUN = 50;
const MIN_ORDERS = 2; // one order has no pattern to find
const RECHECK_MS = 20 * 3_600_000;

/**
 * C-04: once a day, Clef reviews each recently active user's last 7 days of cash-outs. In SHADOW mode the call is only logged
 * (and an info alert says what it would have done). In ENFORCE mode a pattern >= 0.75 sets the user's clef_flag, which rule D-11
 * turns into a payout hold (D-11 has its own mode). Clef never blocks, freezes or moves money: a person clears the flag.
 */
export async function runPatternReview(env: Env): Promise<{ checked: number; flagged: number }> {
	const now = Date.now();
	const mode = (await loadModes(env))['C-04'] ?? POINTS['C-04']!.mode;
	const { results: users } = await env.DB.prepare(
		`SELECT o.user_id AS user_id FROM orders o LEFT JOIN user_profile p ON p.user_id = o.user_id
		 WHERE o.tab = 'sell' AND o.created_at >= ?1 AND p.clef_flag IS NULL
		   AND NOT EXISTS (SELECT 1 FROM clef_calls c WHERE c.point = 'C-04' AND c.subject = o.user_id AND c.answers IS NOT NULL AND c.created_at >= ?2)
		 GROUP BY o.user_id HAVING COUNT(*) >= ?3 ORDER BY COUNT(*) DESC LIMIT ?4`,
	).bind(now - 7 * DAY_MS, now - RECHECK_MS, MIN_ORDERS, MAX_USERS_PER_RUN).all<{ user_id: string }>();

	let flagged = 0;
	for (const { user_id } of users) {
		const { results: orders } = await env.DB.prepare(
			`SELECT o.amount_fcfa, o.asset, o.created_at, o.status, o.phone, (SELECT p.status FROM payouts p WHERE p.order_id = o.id) AS payout_status
			 FROM orders o WHERE o.user_id = ? AND o.tab = 'sell' AND o.created_at >= ?`,
		).bind(user_id, now - 7 * DAY_MS).all<ActivityOrder>();
		const prof = await env.DB.prepare('SELECT first_seen_at FROM user_profile WHERE user_id = ?').bind(user_id).first<{ first_seen_at: number }>();
		const denied = await env.DB.prepare(`SELECT COUNT(*) AS n FROM decisions WHERE user_id = ? AND decision = 'deny' AND created_at >= ?`).bind(user_id, now - 7 * DAY_MS).first<{ n: number }>();
		const state = buildActivityState(orders, {
			now, accountAgeDays: Math.floor((now - (prof?.first_seen_at ?? now)) / DAY_MS),
			perTxLimit: BASE_LIMITS.perTx, dailyLimit: BASE_LIMITS.daily, deniedRequests7d: denied?.n ?? 0,
		});
		const res = await askClef(env, POINTS['C-04']!, mode, user_id, state, PATTERN_QUESTIONS);
		const flag = res ? patternVerdict(res, now) : null;
		if (!flag) continue;
		flagged++;
		if (mode === 'enforce') await env.DB.prepare('UPDATE user_profile SET clef_flag = ?, updated_at = ? WHERE user_id = ?').bind(JSON.stringify(flag), now, user_id).run();
		await notify(env, {
			level: mode === 'enforce' ? 'warning' : 'info',
			title: mode === 'enforce' ? 'Clef flagged a user pattern: payouts are held while rule D-11 is enforced' : 'Clef would flag a user pattern (shadow mode, no action taken)',
			details: { user: user_id, pattern: flag.pattern, probability: flag.probability, clefCall: flag.callId },
		});
	}
	return { checked: users.length, flagged };
}

/** An analyst reviewed the flag; payouts return to normal. */
export async function clearClefFlag(env: Env, userId: string, note: string): Promise<boolean> {
	const r = await env.DB.prepare('UPDATE user_profile SET clef_flag = NULL, updated_at = ? WHERE user_id = ? AND clef_flag IS NOT NULL').bind(Date.now(), userId).run();
	console.log(JSON.stringify({ msg: 'clef.flag_cleared', user: userId, note, cleared: r.meta.changes > 0 }));
	return r.meta.changes > 0;
}
