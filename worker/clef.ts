/**
 * Clef (https://developers.cloudflare.com/workers-ai/models/clef/): a Workers AI decision model that takes a state and
 * typed questions and returns a probability for every option. Used here as a JUDGMENT layer only, as the protection matrix says:
 * it never signs, moves funds, blocks or freezes. Its answers feed the dynamic rules and alert triage, and every call is logged.
 *
 * Decision points built (the others need data that isn't server-side yet):
 *   C-05 alert triage     (clef-flash) false positive / review / urgent; a >= 0.95 false positive auto-closes an INFO alert
 *   C-04 daily batch      (clef)       none / mule / round trip / structuring; any pattern >= 0.75 sets a flag that rule D-11 holds on
 * Both start in SHADOW mode (the call is made and logged, nothing changes) and are promoted like rules:
 * PUT /api/admin/rules/C-05/mode. Disabled unless CLEF_ENABLED="true". Any failure or timeout returns null and the caller
 * carries on exactly as it did before Clef existed.
 * This file has no imports on purpose, so it can be unit-tested in plain Node.
 */
export type ClefModel = 'clef' | 'clef-flash';
export type Mode = 'shadow' | 'enforce';
export interface Point { id: string; version: number; mode: Mode; model: ClefModel; description: string }

export const POINTS: Record<string, Point> = {
	'C-05': { id: 'C-05', version: 1, mode: 'shadow', model: 'clef-flash', description: 'Alert triage: a false positive at >= 0.95 auto-closes an info alert (logged)' },
	'C-04': { id: 'C-04', version: 1, mode: 'shadow', model: 'clef', description: 'Daily 7-day activity review: any mule / round-trip / structuring pattern at >= 0.75 sets a flag; rule D-11 holds payouts' },
};
export const THRESHOLDS = { falsePositive: 0.95, pattern: 0.75 } as const;
const TIMEOUT_MS = 8_000;

export type Question =
	| { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
	| { type: 'choice'; instructions: string; criteria: Record<string, string> }
	| { type: 'score'; instructions: string; criteria: string[] };

/** Answer shapes from the model's output schema. */
export type Answer =
	| { type: 'noul'; noul: number }
	| { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
	| { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number };
export interface ClefResult { model: string; answers: Record<string, Answer>; usage: { input_tokens: number; output_tokens: number }; callId: number | null }

export const clefEnabled = (env: Env) => (env.CLEF_ENABLED as string | undefined) === 'true' && !!env.AI;

/**
 * Asks Clef. Returns null when disabled, on a timeout, an error or an answer that doesn't match what we asked for.
 * `mode` is the effective mode of the point (shadow unless promoted), recorded with the call.
 */
export async function askClef(env: Env, point: Point, mode: Mode, subject: string, state: unknown, questions: Record<string, Question>): Promise<ClefResult | null> {
	if (!clefEnabled(env)) return null;
	const started = Date.now();
	let answers: ClefResult['answers'] | null = null;
	let model: string | null = null;
	let usage: ClefResult['usage'] | null = null;
	let error: string | null = null;
	try {
		const out = (await Promise.race([
			// each model has its own path, and the binding rejects a mismatched `model` (found by calling it for real)
			env.AI.run(`@cf/cloudflare/${point.model}` as never, { model: point.model, state, questions } as never),
			new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Clef timed out')), TIMEOUT_MS)),
		])) as { model?: string; answers?: Record<string, Answer>; usage?: ClefResult['usage'] };
		const bad = Object.keys(questions).find((id) => out.answers?.[id]?.type !== questions[id]!.type);
		if (!out.answers || bad) throw new Error(`Unexpected Clef answer${bad ? ` for ${bad}` : ''}`);
		answers = out.answers; model = out.model ?? point.model; usage = out.usage ?? { input_tokens: 0, output_tokens: 0 };
	} catch (e) { error = e instanceof Error ? e.message : String(e); }

	let callId: number | null = null;
	try {
		const r = await env.DB.prepare(
			`INSERT INTO clef_calls (point, point_ver, mode, subject, model, questions, state, answers, input_tokens, output_tokens, latency_ms, error, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).bind(point.id, point.version, mode, subject, model ?? point.model, JSON.stringify(questions), JSON.stringify(state), answers ? JSON.stringify(answers) : null,
			usage?.input_tokens ?? null, usage?.output_tokens ?? null, Date.now() - started, error, Date.now()).run();
		callId = (r.meta.last_row_id as number | undefined) ?? null;
	} catch (e) { console.error(JSON.stringify({ msg: 'clef.log_failed', error: e instanceof Error ? e.message : String(e) })); }
	console.log(JSON.stringify({ msg: 'clef.call', point: point.id, mode, ok: !error, error, ms: Date.now() - started }));
	return answers ? { model: model!, answers, usage: usage!, callId } : null;
}

// ---- C-05: alert triage ------------------------------------------------------------------------------------------------

export const TRIAGE_QUESTIONS: Record<string, Question> = {
	priority: {
		type: 'choice',
		instructions: 'You triage operational alerts for a crypto to mobile-money exchange. How should this alert be handled?',
		criteria: {
			false_positive: 'Informational or expected: no person needs to act',
			review: 'A person should look at it during normal working hours',
			urgent: 'Money may be at risk or stuck: a person must act now',
		},
	},
};

export interface Triage { priority: string; probabilities: Record<string, number>; autoClose: boolean }
/** Pure: reads the triage answer. Only an INFO alert can auto-close: failures and unknown outcomes always reach a person. */
export function triageVerdict(res: ClefResult, level: 'critical' | 'warning' | 'info'): Triage | null {
	const a = res.answers.priority;
	if (a?.type !== 'choice') return null;
	return { priority: a.choice, probabilities: a.probabilities, autoClose: level === 'info' && (a.probabilities.false_positive ?? 0) >= THRESHOLDS.falsePositive };
}

// ---- C-04: daily activity review ---------------------------------------------------------------------------------------

export const PATTERN_QUESTIONS: Record<string, Question> = {
	pattern: {
		type: 'choice',
		instructions: 'You review one user\'s last 7 days of cash-out activity (crypto sold for mobile money) at an exchange for signs of money laundering. Which pattern, if any, best describes it?',
		criteria: {
			none: 'Ordinary use: no concerning pattern',
			mule: 'Pass-through account: many different payout numbers, or funds cashed out almost as fast as they arrive',
			round_trip: 'Repeated deposit and cash-out of the same value in short cycles with no apparent purpose',
			structuring: 'Amounts kept just under limits, or one larger amount split into several orders to avoid a limit',
		},
	},
};

export interface PatternFlag { pattern: string; probability: number; at: number; callId: number | null; model: string }
/** Pure: any non-"none" pattern at or above the threshold becomes a flag (the strongest one if several). */
export function patternVerdict(res: ClefResult, now: number): PatternFlag | null {
	const a = res.answers.pattern;
	if (a?.type !== 'choice') return null;
	const top = Object.entries(a.probabilities).filter(([k]) => k !== 'none').sort((x, y) => y[1] - x[1])[0];
	if (!top || top[1] < THRESHOLDS.pattern) return null;
	return { pattern: top[0], probability: Math.round(top[1] * 1000) / 1000, at: now, callId: res.callId, model: res.model };
}

export interface ActivityOrder { amount_fcfa: number | null; asset: string; created_at: number; status: string; payout_status: string | null; phone: string | null }
/**
 * Pure: the state sent to Clef. Pseudonymous on purpose: payout numbers become "number 1, 2, ..." (never the digits),
 * times are hours ago, and limits are given so "just under the limit" can be judged.
 */
export function buildActivityState(orders: ActivityOrder[], opts: { now: number; accountAgeDays: number; perTxLimit: number; dailyLimit: number; deniedRequests7d: number }) {
	const numbers = new Map<string, number>();
	const list = [...orders].sort((a, b) => a.created_at - b.created_at).map((o) => {
		const n = o.phone ? (numbers.get(o.phone) ?? numbers.set(o.phone, numbers.size + 1).get(o.phone)!) : null;
		return { hours_ago: Math.round(((opts.now - o.created_at) / 3_600_000) * 10) / 10, amount_fcfa: o.amount_fcfa, asset: o.asset, status: o.status, payout_status: o.payout_status, payout_number: n };
	});
	return {
		window: 'last 7 days', account_age_days: opts.accountAgeDays,
		limits_fcfa: { per_transaction: opts.perTxLimit, per_day: opts.dailyLimit },
		cash_out_orders: list, order_count: list.length, distinct_payout_numbers: numbers.size,
		total_fcfa: list.reduce((s, o) => s + (o.amount_fcfa ?? 0), 0), requests_denied_by_limits: opts.deniedRequests7d,
	};
}
