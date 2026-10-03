import { notify } from './notify';
import { fcfaValue } from './pricing';
import { ensureProfile, evaluate, LIMIT_GUARD, loadFacts, loadModes, logDecision, RuleDenied, windowStarts } from './rules';
import { createPrivySwapClient, PrivySwapError, type PrivySwapClient, type SwapAction } from './swap/privy';
import { fromBaseUnits, planSwap, SWAP_ASSETS, type SwapWallets } from './swapPlan';

/**
 * Swaps through Privy's swap wallet action. The customer's own embedded wallet holds and signs everything; Relay's server key (added to
 * the wallet as a signer with the customer's consent) only asks Privy to run the swap. Relay's job here: choose and validate the swap
 * (only these assets, always the customer's own destination wallet, bounded slippage), run the same rules as every other money movement,
 * record the intent, and follow the result (Privy's webhook, or by asking for the action's status).
 */
export type SwapStatus = 'created' | 'submitted' | 'succeeded' | 'failed' | 'rejected';
export interface SwapRow {
	id: string; user_id: string; wallet_id: string; from_asset: string; to_asset: string; input_units: string; cross_chain: number; slippage_bps: number;
	quoted_units: string | null; min_units: string | null; fcfa_value: number; status: SwapStatus; action_id: string | null; tx_hash: string | null;
	output_units: string | null; failure: string | null; failure_detail: string | null; last_checked_at: number | null; created_at: number; updated_at: number; completed_at: number | null;
}

export class SwapError extends Error {
	status: number; code: string | null;
	constructor(message: string, status = 400, code: string | null = null) { super(message); this.status = status; this.code = code; }
}

export const DEFAULT_SLIPPAGE_BPS = 50;
const ID = /^[a-z0-9]{6,32}$/;
const CHECK_EVERY_MS = 4_000;
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ msg, ...extra }));

const client = (env: Env, deps?: { client?: PrivySwapClient }) => deps?.client ?? createPrivySwapClient(env);
export const swapsConfigured = (env: Env) => !!env.PRIVY_SIGNER_ID && !!env.PRIVY_SIGNER_PRIVATE_KEY;

export interface SwapStatusView { configured: boolean; signerId: string | null; policyIds: { ethereum: string | null; solana: string | null }; wallets: { ethereum: { address: string; ready: boolean } | null; solana: { address: string; ready: boolean } | null }; assets: string[] }

/** What the app needs before it offers swaps: is the server set up, and has the customer authorised the signer on each wallet? */
export async function swapStatus(env: Env, userId: string, deps?: { client?: PrivySwapClient }): Promise<SwapStatusView> {
	const configured = swapsConfigured(env);
	const view: SwapStatusView = { configured, signerId: configured ? env.PRIVY_SIGNER_ID : null, policyIds: { ethereum: env.PRIVY_SWAP_POLICY_EVM || null, solana: env.PRIVY_SWAP_POLICY_SOL || null }, wallets: { ethereum: null, solana: null }, assets: Object.keys(SWAP_ASSETS) };
	if (!configured) return view;
	const u = await mapPrivy(() => client(env, deps).wallets(userId));
	for (const c of ['ethereum', 'solana'] as const) if (u.wallets[c]) view.wallets[c] = { address: u.wallets[c]!.address, ready: u.delegated[c] };
	return view;
}

export interface QuoteView {
	from: string; to: string; amountIn: string; estOut: string; minOut: string; slippageBps: number; crossChain: boolean;
	/** swap fees in USD for cross-chain routes ([] on one chain, where the fee is inside the rate) */
	fees: { type: string; usd: string }[];
	expiresAt: number | null; fcfaValue: number;
}

export async function quoteSwap(env: Env, userId: string, input: { from: unknown; to: unknown; amount: unknown; slippageBps?: unknown }, deps?: { client?: PrivySwapClient }): Promise<QuoteView> {
	if (!swapsConfigured(env)) throw new SwapError('Swaps are not available yet', 503);
	const c = client(env, deps);
	const u = await mapPrivy(() => c.wallets(userId));
	const slip = input.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
	const plan = planSwap({ from: input.from, to: input.to, amount: input.amount, slippageBps: slip, wallets: u.wallets });
	if (!plan.ok) throw new SwapError(plan.error);
	const q = await mapPrivy(() => c.quote(plan.req.walletId, plan.req.body));
	return {
		from: plan.from.sym, to: plan.to.sym, amountIn: String(input.amount).trim(), estOut: fromBaseUnits(q.estOutputAmount, plan.to.decimals), minOut: fromBaseUnits(q.minimumOutputAmount, plan.to.decimals),
		slippageBps: slip as number, crossChain: plan.req.crossChain, fees: q.estimatedFees.map((f) => ({ type: f.type, usd: f.amount })), expiresAt: q.expiresAt, fcfaValue: fcfaValue(plan.from.sym, String(input.amount)),
	};
}

async function mapPrivy<T>(fn: () => Promise<T>): Promise<T> {
	try { return await fn(); }
	catch (e) { if (e instanceof PrivySwapError) throw new SwapError(e.message, e.status === 429 ? 429 : 400, e.code); throw e; }
}

/** What the customer's app sees. */
export interface SwapView {
	id: string; tab: 'swap'; status: SwapStatus; from: string; to: string; amountIn: string; estOut: string | null; minOut: string | null; amountOut: string | null;
	crossChain: boolean; txHash: string | null; failure: string | null; createdAt: number;
}
const view = (r: SwapRow): SwapView => {
	const f = SWAP_ASSETS[r.from_asset]!, t = SWAP_ASSETS[r.to_asset]!;
	return {
		id: r.id, tab: 'swap', status: r.status, from: r.from_asset, to: r.to_asset, amountIn: fromBaseUnits(r.input_units, f.decimals),
		estOut: r.quoted_units ? fromBaseUnits(r.quoted_units, t.decimals) : null, minOut: r.min_units ? fromBaseUnits(r.min_units, t.decimals) : null,
		amountOut: r.output_units ? fromBaseUnits(r.output_units, t.decimals) : null, crossChain: r.cross_chain === 1, txHash: r.tx_hash, failure: r.failure, createdAt: r.created_at,
	};
};

export const getSwapRow = (env: Env, id: string) => env.DB.prepare('SELECT * FROM swap_orders WHERE id = ?').bind(id).first<SwapRow>();

/** Idempotent per (user, id): a retry returns the same swap and never submits a second one (Privy gets the same idempotency key). */
export async function createSwap(env: Env, userId: string, input: { id: unknown; from: unknown; to: unknown; amount: unknown; slippageBps?: unknown }, country: string | null, deps?: { client?: PrivySwapClient }): Promise<SwapView> {
	if (!swapsConfigured(env)) throw new SwapError('Swaps are not available yet', 503);
	const id = typeof input.id === 'string' ? input.id : '';
	if (!ID.test(id)) throw new SwapError('Invalid order id');
	const existing = await getSwapRow(env, id);
	if (existing) {
		if (existing.user_id !== userId) throw new SwapError('Invalid order id'); // don't reveal other users' ids
		return view(await refreshSwap(env, existing, false, deps));
	}
	const c = client(env, deps);
	const u = await mapPrivy(() => c.wallets(userId));
	const slippage = (input.slippageBps ?? DEFAULT_SLIPPAGE_BPS) as number;
	const plan = planSwap({ from: input.from, to: input.to, amount: input.amount, slippageBps: slippage, wallets: u.wallets });
	if (!plan.ok) throw new SwapError(plan.error);
	// the customer must have authorised Relay's signer on the wallet that will sign
	if (!u.delegated[plan.from.chain]) throw new SwapError('Enable swaps for this wallet first', 409, 'signer_required');

	// the same rules as every other movement of value: frozen or restricted accounts, sanctioned countries, the per-transaction cap
	const now = Date.now();
	const value = fcfaValue(plan.from.sym, String(input.amount));
	const profile = await ensureProfile(env, userId, country, now);
	const outcome = evaluate(await loadFacts(env, userId, { amountFcfa: value, phone: '', country }, profile, now), { modes: await loadModes(env) });
	if (outcome.action !== 'allow') {
		await logDecision(env, { userId, orderId: id, outcome });
		// a hold (a restricted account) means "no money moves until a person looks"; for a swap that is a refusal
		throw new RuleDenied(outcome.action === 'deny' ? outcome.message : outcome.message, outcome.action === 'deny' ? outcome.status : 403, outcome.ruleIds);
	}
	await logDecision(env, { userId, orderId: id, outcome });

	// the daily and monthly checks are repeated INSIDE the insert (like sells and buys), so two swaps racing past the read above can't both fit
	const w = windowStarts(now);
	const ins = await env.DB.prepare(
		`INSERT INTO swap_orders (id, user_id, wallet_id, from_asset, to_asset, input_units, cross_chain, slippage_bps, fcfa_value, status, created_at, updated_at)
		 SELECT ?8, ?1, ?9, ?10, ?11, ?12, ?13, ?14, ?5, 'created', ?2, ?2
		 WHERE ${LIMIT_GUARD}`,
	).bind(userId, now, w.day, w.month, value, outcome.limits.daily, outcome.limits.monthly, id, plan.req.walletId, plan.from.sym, plan.to.sym, plan.req.body.base_amount, plan.req.crossChain ? 1 : 0, slippage).run();
	if (ins.meta.changes === 0) throw new RuleDenied('Daily limit reached', 422, ['R-04']);

	// what we expect to receive, for the record (a failed quote here must not block the swap: Privy quotes again when it executes)
	let quoted: { est: string; min: string } | null = null;
	try { const q = await c.quote(plan.req.walletId, { ...plan.req.body, slippage_bps: slippage }); quoted = { est: q.estOutputAmount, min: q.minimumOutputAmount }; } catch { /* recorded without it */ }

	let action: SwapAction;
	try {
		action = await c.execute(plan.req.walletId, { ...plan.req.body, slippage_bps: slippage }, { referenceId: id, idempotencyKey: `swap-${id}` });
	} catch (e) {
		if (e instanceof PrivySwapError) {
			// Privy answered with a definite refusal: nothing was submitted
			await env.DB.prepare(`UPDATE swap_orders SET status = 'failed', failure = ?, failure_detail = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status = 'created'`).bind(e.message, e.detail, Date.now(), Date.now(), id).run();
			log('swap.refused', { id, detail: e.detail });
			if (e.code === 'config') await notify(env, { level: 'critical', title: 'Swaps are refused by Privy: check the dashboard (swaps enabled, gas sponsorship) and the signer', details: { swap: id, detail: e.detail } });
			return view((await getSwapRow(env, id))!);
		}
		// a timeout or network error: Privy may have the request. Keep it open: asking again with the same idempotency key is safe, and the webhook will settle it.
		log('swap.execute_unknown', { id, error: e instanceof Error ? e.message : String(e) });
		await env.DB.prepare(`UPDATE swap_orders SET quoted_units = ?, min_units = ?, updated_at = ? WHERE id = ?`).bind(quoted?.est ?? null, quoted?.min ?? null, Date.now(), id).run();
		throw new SwapError('We could not confirm the swap. Check your activity before trying again.', 502);
	}
	await env.DB.prepare(`UPDATE swap_orders SET status = 'submitted', action_id = ?, quoted_units = ?, min_units = ?, last_checked_at = ?, updated_at = ? WHERE id = ? AND status = 'created'`)
		.bind(action.id, quoted?.est ?? null, quoted?.min ?? null, Date.now(), Date.now(), id).run();
	log('swap.submitted', { id, action: action.id, from: plan.from.sym, to: plan.to.sym });
	if (action.status !== 'pending') await settleSwap(env, { actionId: action.id, status: action.status, outputUnits: action.outputAmount, txHash: action.txHash, failure: action.failureReason });
	return view((await getSwapRow(env, id))!);
}

/** Applies a final result (from Privy's webhook or a status check). Conditional on `submitted`, so a repeated or late result is harmless. */
export async function settleSwap(env: Env, r: { referenceId?: string | null; actionId?: string | null; status: 'pending' | 'succeeded' | 'failed' | 'rejected'; outputUnits?: string | null; txHash?: string | null; failure?: string | null }): Promise<boolean> {
	if (r.status === 'pending') return false;
	const row = r.referenceId ? await getSwapRow(env, r.referenceId) : r.actionId ? await env.DB.prepare('SELECT * FROM swap_orders WHERE action_id = ?').bind(r.actionId).first<SwapRow>() : null;
	if (!row) return false;
	const now = Date.now();
	const failure = r.status === 'succeeded' ? null : r.status === 'rejected' ? 'This swap was not allowed' : 'The swap could not be completed';
	const done = (await env.DB.prepare(
		`UPDATE swap_orders SET status = ?, output_units = COALESCE(?, output_units), tx_hash = COALESCE(?, tx_hash), action_id = COALESCE(action_id, ?), failure = ?, failure_detail = ?, completed_at = ?, updated_at = ?
		 WHERE id = ? AND status IN ('created', 'submitted')`,
	).bind(r.status, r.outputUnits ?? null, r.txHash ?? null, r.actionId ?? null, failure, r.status === 'succeeded' ? null : (r.failure ?? null), now, now, row.id).run()).meta.changes > 0;
	if (done) log('swap.settled', { id: row.id, status: r.status });
	return done;
}

/** Asks Privy for a submitted swap's state (at most every few seconds per swap) and applies it. */
export async function refreshSwap(env: Env, r: SwapRow, force = false, deps?: { client?: PrivySwapClient }): Promise<SwapRow> {
	if (r.status !== 'submitted' || !r.action_id) return r;
	const now = Date.now();
	if (!force && r.last_checked_at && now - r.last_checked_at < CHECK_EVERY_MS) return r;
	try {
		const a = await client(env, deps).action(r.wallet_id, r.action_id);
		await env.DB.prepare('UPDATE swap_orders SET last_checked_at = ? WHERE id = ?').bind(now, r.id).run();
		await settleSwap(env, { actionId: a.id, status: a.status, outputUnits: a.outputAmount, txHash: a.txHash, failure: a.failureReason });
	} catch { /* Privy unreachable: keep what we know; the webhook or the next check settles it */ }
	return (await getSwapRow(env, r.id))!;
}

export async function getSwap(env: Env, userId: string, id: string, deps?: { client?: PrivySwapClient }): Promise<SwapView | null> {
	const r = await getSwapRow(env, id);
	return r && r.user_id === userId ? view(await refreshSwap(env, r, false, deps)) : null;
}

export async function listSwaps(env: Env, userId: string, deps?: { client?: PrivySwapClient }): Promise<SwapView[]> {
	const { results } = await env.DB.prepare('SELECT * FROM swap_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(userId).all<SwapRow>();
	const out: SwapView[] = [];
	for (const r of results) out.push(view(await refreshSwap(env, r, false, deps)));
	return out;
}

/** Cron: settles swaps whose webhook never arrived, and raises the alarm about one stuck for a long time. */
export async function reconcileSwaps(env: Env, now = Date.now()): Promise<{ checked: number; stuck: number }> {
	if (!swapsConfigured(env)) return { checked: 0, stuck: 0 };
	const { results } = await env.DB.prepare(`SELECT * FROM swap_orders WHERE status = 'submitted' LIMIT 30`).all<SwapRow>();
	let stuck = 0;
	for (const r of results) {
		const fresh = await refreshSwap(env, r, true);
		if (fresh.status === 'submitted' && now - fresh.created_at > 15 * 60_000) {
			const key = `swap:stuck:${fresh.id}`;
			if (await env.EVENTS.get(key)) continue;
			await env.EVENTS.put(key, '1', { expirationTtl: 3600 });
			await notify(env, { level: 'warning', title: 'A swap has been pending for more than 15 minutes', details: { swap: fresh.id, action: fresh.action_id, from: fresh.from_asset, to: fresh.to_asset } });
			stuck++;
		}
	}
	return { checked: results.length, stuck };
}
