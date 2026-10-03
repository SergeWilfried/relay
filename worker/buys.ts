import { SELL_ASSETS } from './assets';
import { getDepositProvider } from './deposit';
import type { DepositMethod, DepositProvider } from './deposit/types';
import { INSERT_BUY_SQL } from './buySql';
import { isDenied, normalizeEntry, type ListKind } from './lists';
import { notify } from './notify';
import { buyQuote } from './pricing';
import { validName, validTxHash } from './refundRules';
import { ensureProfile, evaluate, loadFacts, loadModes, logDecision, RuleDenied, windowStarts } from './rules';
import { holdActive } from './orders';

/**
 * Buy orders: the customer pays FCFA by mobile money and receives crypto.
 *   created -> collecting (the payment started) -> collected (the provider confirmed the FCFA) -> delivered (a person sent the crypto)
 *   collecting -> failed ; created -> expired
 * The crypto is SENT BY A PERSON from the treasury (Relay holds no treasury key) and recorded with its transaction hash, after the payment
 * is confirmed and any hold is released. The amount of crypto is fixed when the order is created, from server-side pricing.
 */
export type BuyStatus = 'created' | 'collecting' | 'collected' | 'delivered' | 'failed' | 'expired' | 'cancelled';

export interface BuyRow {
	id: string; user_id: string; asset: string; network: string; fcfa: number; platform_fee_fcfa: number; psp_fee_fcfa: number; network_fee_fcfa: number;
	amount_units: string; destination: string; operator: string; provider_code: string; phone: string; status: BuyStatus; auth_type: string | null;
	deposit_id: string | null; next_step: string | null; auth_url: string | null; failure: string | null; failure_detail: string | null; last_checked_at: number | null;
	collecting_at: number | null; collected_at: number | null; delivered_at: number | null; delivered_by: string | null; tx_hash: string | null;
	hold_rules: string | null; hold_message: string | null; hold_until: number | null; hold_released_at: number | null;
	expires_at: number; created_at: number; updated_at: number;
}

export class BuyError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }

/** What the customer's app sees. */
export interface BuyView {
	id: string; tab: 'buy'; status: BuyStatus; asset: string; fcfa: number; amountUnits: string; destination: string; operator: string;
	createdAt: number; expiresAt: number;
	/** how the customer approves the payment, from the provider's configuration */
	method: { authType: string; instructions: { en: string[]; fr: string[] } | null; codeInstructions: { en: string[]; fr: string[] } | null } | null;
	nextStep: string | null;
	/** REDIRECT_AUTH: send the customer here to approve the payment */
	authUrl: string | null;
	failure: string | null;
	/** the delivery transaction, once the crypto was sent */
	txHash: string | null;
	hold: { message: string } | null;
}

const ID = /^[a-z0-9]{6,32}$/;
const OPERATORS = new Set(['orange', 'wave', 'moov']); // pispi is not collected by pawaPay
const PHONE = /^\+\d{8,15}$/;
const PAY_WINDOW_MS = 15 * 60_000;
const CHECK_EVERY_MS = 4_000;
const NOT_FOUND_GRACE_MS = 120_000;
const MIN_FCFA = 1_000;
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ msg, ...extra }));
const kindOf = (network: string): ListKind => (network === 'Solana' ? 'solana' : 'evm');

const provider = (env: Env): DepositProvider => {
	const p = getDepositProvider(env);
	if (!p) throw new BuyError('Buying is not available yet', 503);
	return p;
};

const selectBuy = `SELECT * FROM buy_orders WHERE id = ?`;
export const getBuyRow = (env: Env, id: string) => env.DB.prepare(selectBuy).bind(id).first<BuyRow>();

async function view(env: Env, r: BuyRow): Promise<BuyView> {
	let method: BuyView['method'] = null;
	if ((r.status === 'created' || r.status === 'collecting') && getDepositProvider(env)) {
		const m: DepositMethod | null = await provider(env).method(r.operator, r.phone).catch(() => null);
		if (m) method = { authType: m.authType, instructions: m.instructions, codeInstructions: m.codeInstructions };
	}
	return {
		id: r.id, tab: 'buy', status: r.status, asset: r.asset, fcfa: r.fcfa, amountUnits: r.amount_units, destination: r.destination, operator: r.operator,
		createdAt: r.created_at, expiresAt: r.expires_at, method, nextStep: r.next_step, authUrl: r.status === 'collecting' ? r.auth_url : null,
		failure: r.failure, txHash: r.status === 'delivered' ? r.tx_hash : null,
		hold: holdActive(r) ? { message: r.hold_message ?? '' } : null,
	};
}

export interface CreateBuyInput { id: unknown; asset: unknown; amountFcfa: unknown; destination: unknown; providerId: unknown; phone: unknown }

/** Idempotent per (user, id): a retry returns the same order. */
export async function createBuyOrder(env: Env, userId: string, input: CreateBuyInput, country: string | null): Promise<BuyView> {
	const dep = provider(env);
	const id = typeof input.id === 'string' ? input.id : '';
	if (!ID.test(id)) throw new BuyError('Invalid order id');
	const existing = await getBuyRow(env, id);
	if (existing) {
		if (existing.user_id !== userId) throw new BuyError('Invalid order id'); // don't reveal other users' ids
		return view(env, await refreshBuy(env, existing));
	}
	const asset = typeof input.asset === 'string' ? SELL_ASSETS[input.asset] : undefined;
	if (!asset) throw new BuyError('Unsupported asset');
	const fcfa = input.amountFcfa;
	if (typeof fcfa !== 'number' || !Number.isInteger(fcfa) || fcfa < MIN_FCFA) throw new BuyError('Amount is below the minimum');
	if (input.providerId === 'pispi') throw new BuyError('Buying with PI-SPI is not available yet'); // PI-SPI is alias-based and the payment provider doesn't collect through it
	const operator = typeof input.providerId === 'string' && OPERATORS.has(input.providerId) ? input.providerId : null;
	if (!operator) throw new BuyError('Choose a mobile money provider');
	const phone = typeof input.phone === 'string' ? input.phone.replace(/[\s\-()]/g, '') : '';
	if (!PHONE.test(phone)) throw new BuyError('Enter your mobile money number with the country code, e.g. +2250789458900');
	const destination = normalizeEntry(kindOf(asset.network), input.destination);
	if (!destination) throw new BuyError(`Enter a valid ${asset.network} wallet address`);
	if (await isDenied(env, kindOf(asset.network), destination)) throw new BuyError('This wallet address cannot be used. Please contact support.', 403);

	// the provider must take this operator in this number's country, and the amount must fit its limits: refused now, before any money moves
	const method = await dep.method(operator, phone);
	if (!method) throw new BuyError('This provider is not available for your number');
	if (fcfa < method.min || fcfa > method.max) throw new BuyError('This amount is outside the provider limits');

	const q = buyQuote(asset.sym, fcfa, asset.decimals);
	if (q.amountUnits <= 0n) throw new BuyError('Amount is below the minimum');

	const now = Date.now();
	const profile = await ensureProfile(env, userId, country, now);
	const [facts, modes] = await Promise.all([loadFacts(env, userId, { amountFcfa: fcfa, phone, country }, profile, now), loadModes(env)]);
	const outcome = evaluate(facts, { modes });
	if (outcome.action === 'deny') {
		await logDecision(env, { userId, orderId: id, outcome });
		throw new RuleDenied(outcome.message, outcome.status, outcome.ruleIds);
	}
	const hold = outcome.action === 'hold' ? outcome : null;
	const w = windowStarts(now);
	const ins = await env.DB.prepare(INSERT_BUY_SQL).bind(
		userId, now, w.day, w.month, fcfa, outcome.limits.daily, outcome.limits.monthly,
		id, asset.sym, asset.network, q.platformFeeFcfa, q.pspFeeFcfa, q.networkFeeFcfa, q.amountUnits.toString(), destination, operator, method.code, phone, method.authType,
		hold ? JSON.stringify(hold.ruleIds) : null, hold ? hold.message : null, hold && hold.hours !== null ? now + hold.hours * 3_600_000 : null, now + PAY_WINDOW_MS,
	).run();
	if (ins.meta.changes === 0) {
		await logDecision(env, { userId, orderId: id, outcome: { ...outcome, action: 'deny', status: 422, message: 'Daily limit reached', ruleIds: ['R-04'] } });
		throw new RuleDenied('Daily limit reached', 422, ['R-04']);
	}
	await logDecision(env, { userId, orderId: id, outcome });
	if (country) await env.DB.prepare(`UPDATE user_profile SET last_country = ?, updated_at = ? WHERE user_id = ?`).bind(country, now, userId).run();
	log('buy.created', { id, asset: asset.sym, fcfa, provider: method.code, authType: method.authType });
	return view(env, (await getBuyRow(env, id))!);
}

/** Starts the payment. Idempotent: calling it again for an order that is already collecting just returns its state. */
export async function payBuyOrder(env: Env, userId: string, id: string, input: { preAuthCode?: unknown }, origin: string): Promise<BuyView> {
	const dep = provider(env);
	const r = await getBuyRow(env, id);
	if (!r || r.user_id !== userId) throw new BuyError('Not found', 404);
	if (r.status === 'collecting' || r.status === 'collected' || r.status === 'delivered') return view(env, await refreshBuy(env, r));
	if (r.status === 'created' && Date.now() > r.expires_at) {
		await env.DB.prepare(`UPDATE buy_orders SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'created'`).bind(Date.now(), id).run();
		throw new BuyError('This quote has expired. Please start the purchase again.', 409);
	}
	if (r.status !== 'created') throw new BuyError('This order can no longer be paid. Please start a new purchase.', 409);

	let code: string | undefined;
	if (r.auth_type === 'PREAUTH') {
		if (typeof input.preAuthCode !== 'string' || !/^[A-Za-z0-9]{1,36}$/.test(input.preAuthCode.trim())) throw new BuyError('Enter the code you received');
		code = input.preAuthCode.trim();
	}
	// only the redirect flow takes return URLs (pawaPay rejects parameters a provider doesn't support)
	const back = r.auth_type === 'REDIRECT_AUTH' ? `${origin}/trade/status/${id}` : null;
	let init;
	try {
		init = await dep.initiate({ reference: id, amountFcfa: r.fcfa, phone: r.phone, operator: r.operator, preAuthCode: code, ...(back ? { successUrl: back, failedUrl: `${back}?failed=1` } : {}) });
	} catch (e) {
		// the request may have reached the provider: treat the payment as started, and let the status check decide (it is idempotent by id)
		log('buy.initiate_unknown', { id, error: e instanceof Error ? e.message : String(e) });
		init = { state: 'accepted' as const, depositId: '', nextStep: null, authUrl: null };
	}
	const now = Date.now();
	if (init.state === 'rejected') {
		await env.DB.prepare(`UPDATE buy_orders SET status = 'failed', failure = ?, failure_detail = ?, updated_at = ? WHERE id = ? AND status = 'created'`).bind(init.error, init.detail, now, id).run();
		log('buy.rejected', { id, detail: init.detail });
		if (/credential|AUTHENTICATION|AUTHORISATION|401|403/i.test(init.detail)) await notify(env, { level: 'critical', title: 'Buy payment rejected by the payment provider: check the API token and permissions', details: { order: id, detail: init.detail } });
	} else {
		await env.DB.prepare(`UPDATE buy_orders SET status = 'collecting', deposit_id = ?, next_step = ?, auth_url = ?, collecting_at = ?, last_checked_at = ?, updated_at = ? WHERE id = ? AND status = 'created'`)
			.bind(init.depositId || null, init.nextStep, init.authUrl, now, now, now, id).run();
	}
	return view(env, (await getBuyRow(env, id))!);
}

/** Asks the provider where a collecting payment stands (at most every few seconds per order) and applies the answer. */
export async function refreshBuy(env: Env, r: BuyRow, force = false): Promise<BuyRow> {
	if (r.status !== 'collecting') return r;
	const now = Date.now();
	if (!force && r.last_checked_at && now - r.last_checked_at < CHECK_EVERY_MS) return r;
	const dep = getDepositProvider(env);
	if (!dep) return r;
	let s;
	try { s = await dep.status(r.id); } catch { return r; } // the provider is unreachable: keep what we know
	await env.DB.prepare(`UPDATE buy_orders SET last_checked_at = ? WHERE id = ?`).bind(now, r.id).run();
	if (s.state === 'completed') await settle(env, r.id, 'completed');
	else if (s.state === 'failed') await settle(env, r.id, 'failed', s.error, s.detail);
	else if (s.state === 'not_found') { if (now - (r.collecting_at ?? now) > NOT_FOUND_GRACE_MS) await settle(env, r.id, 'failed', 'The payment could not be started', 'pawaPay never received the deposit (NOT_FOUND)'); }
	else await env.DB.prepare(`UPDATE buy_orders SET next_step = COALESCE(?, next_step), auth_url = COALESCE(?, auth_url), updated_at = ? WHERE id = ? AND status = 'collecting'`).bind(s.nextStep, s.authUrl, now, r.id).run();
	return (await getBuyRow(env, r.id))!;
}

/** Applies a final payment result (from a callback or a status check). A conditional update, so a repeated or late result is harmless. */
export async function settle(env: Env, id: string, result: 'completed' | 'failed', error?: string, detail?: string): Promise<boolean> {
	const now = Date.now();
	if (result === 'completed') {
		const ok = (await env.DB.prepare(`UPDATE buy_orders SET status = 'collected', collected_at = ?, updated_at = ? WHERE id = ? AND status = 'collecting'`).bind(now, now, id).run()).meta.changes > 0;
		if (ok) {
			const r = (await getBuyRow(env, id))!;
			log('buy.collected', { id });
			await notify(env, { level: 'warning', title: 'Payment received: send the crypto to the customer', details: { order: id, asset: r.asset, amountUnits: r.amount_units, to: r.destination, paidFcfa: r.fcfa } });
		}
		return ok;
	}
	const ok = (await env.DB.prepare(`UPDATE buy_orders SET status = 'failed', failure = ?, failure_detail = ?, updated_at = ? WHERE id = ? AND status = 'collecting'`).bind(error ?? 'The payment could not be completed', detail ?? null, now, id).run()).meta.changes > 0;
	if (ok) log('buy.failed', { id, detail });
	return ok;
}

export async function getBuy(env: Env, userId: string, id: string): Promise<BuyView | null> {
	const r = await getBuyRow(env, id);
	if (!r || r.user_id !== userId) return null;
	return view(env, await refreshBuy(env, r));
}

export async function listBuys(env: Env, userId: string): Promise<BuyView[]> {
	const { results } = await env.DB.prepare(`SELECT * FROM buy_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`).bind(userId).all<BuyRow>();
	const out: BuyView[] = [];
	for (const r of results) out.push(await view(env, await refreshBuy(env, r)));
	return out;
}

// ---- delivery (a person, from the treasury) ------------------------------------------------------------------------------

async function event(env: Env, id: string, action: string, by: string, note?: string | null) {
	await env.DB.prepare(`INSERT INTO buy_events (buy_id, action, by_name, note, created_at) VALUES (?, ?, ?, ?, ?)`).bind(id, action, by, note ?? null, Date.now()).run();
}
function who(v: unknown): string {
	if (!validName(v)) throw new BuyError('Your name is required (2 to 40 letters): it is kept in the audit log');
	return v.trim();
}

export async function markDelivered(env: Env, id: string, byRaw: unknown, txHash: unknown): Promise<BuyRow> {
	const by = who(byRaw);
	const r = await getBuyRow(env, id);
	if (!r) throw new BuyError('Buy order not found', 404);
	if (r.status !== 'collected') throw new BuyError(r.status === 'delivered' ? 'This order was already delivered' : `The payment has not been collected (status: ${r.status}): nothing may be delivered`, 409);
	if (holdActive(r)) throw new BuyError(`Delivery is on hold (${r.hold_rules}). Release the hold first.`, 409);
	if (!validTxHash(r.network, txHash)) throw new BuyError(`That is not a valid ${r.network === 'Solana' ? 'Solana' : 'Ethereum'} transaction hash`);
	const now = Date.now();
	if (!((await env.DB.prepare(`UPDATE buy_orders SET status = 'delivered', tx_hash = ?, delivered_by = ?, delivered_at = ?, updated_at = ? WHERE id = ? AND status = 'collected'`).bind(txHash, by, now, now, id).run()).meta.changes > 0))
		throw new BuyError('This order was already delivered', 409);
	await event(env, id, 'delivered', by, txHash);
	log('buy.delivered', { id, by, tx: txHash });
	return (await getBuyRow(env, id))!;
}

export async function releaseBuyHold(env: Env, id: string, byRaw: unknown, note: unknown): Promise<BuyRow> {
	const by = who(byRaw);
	if (typeof note !== 'string' || note.trim().length < 3) throw new BuyError('A note is required');
	const r = (await env.DB.prepare(`UPDATE buy_orders SET hold_released_at = ?, updated_at = ? WHERE id = ? AND hold_rules IS NOT NULL AND hold_released_at IS NULL`).bind(Date.now(), Date.now(), id).run());
	if (r.meta.changes === 0) throw new BuyError('This order has no hold to release', 409);
	await event(env, id, 'released', by, note.trim());
	return (await getBuyRow(env, id))!;
}

export async function listBuysAdmin(env: Env, status?: string): Promise<(BuyRow & { events: { action: string; by_name: string; note: string | null; created_at: number }[] })[]> {
	const q = status ? env.DB.prepare(`SELECT * FROM buy_orders WHERE status = ? ORDER BY created_at DESC LIMIT 200`).bind(status) : env.DB.prepare(`SELECT * FROM buy_orders ORDER BY created_at DESC LIMIT 200`);
	const rows = (await q.all<BuyRow>()).results;
	if (!rows.length) return [];
	const ev = (await env.DB.prepare(`SELECT buy_id, action, by_name, note, created_at FROM buy_events WHERE buy_id IN (${rows.map(() => '?').join(',')}) ORDER BY id`).bind(...rows.map((r) => r.id)).all<{ buy_id: string; action: string; by_name: string; note: string | null; created_at: number }>()).results;
	return rows.map((r) => ({ ...r, events: ev.filter((e) => e.buy_id === r.id) }));
}

// ---- background (cron) ------------------------------------------------------------------------------------------------------

/**
 * Settles payments whose callback never came (this account's callback URL may point elsewhere), expires orders nobody started paying,
 * and reminds when a customer who has paid is still waiting for their crypto.
 */
export async function reconcileBuys(env: Env, now = Date.now()): Promise<{ checked: number; expired: number; reminded: number }> {
	const expired = (await env.DB.prepare(`UPDATE buy_orders SET status = 'expired', updated_at = ? WHERE status = 'created' AND expires_at < ?`).bind(now, now).run()).meta.changes;
	const { results } = await env.DB.prepare(`SELECT * FROM buy_orders WHERE status = 'collecting' AND (last_checked_at IS NULL OR last_checked_at < ?) LIMIT 30`).bind(now - 60_000).all<BuyRow>();
	for (const r of results) await refreshBuy(env, r, true);
	// a customer who has paid and is waiting: 30 minutes is a warning, 2 hours is critical (once per half hour per order)
	const { results: waiting } = await env.DB.prepare(`SELECT id, asset, amount_units, collected_at FROM buy_orders WHERE status = 'collected' AND collected_at < ?`).bind(now - 30 * 60_000).all<{ id: string; asset: string; amount_units: string; collected_at: number }>();
	let reminded = 0;
	for (const w of waiting) {
		const key = `buy:stale:${w.id}`;
		if (await env.EVENTS.get(key)) continue;
		await env.EVENTS.put(key, '1', { expirationTtl: 30 * 60 });
		const mins = Math.round((now - w.collected_at) / 60_000);
		await notify(env, { level: mins >= 120 ? 'critical' : 'warning', title: `A customer paid ${mins} minutes ago and is still waiting for their ${w.asset}`, details: { order: w.id, asset: w.asset, amountUnits: w.amount_units } });
		reminded++;
	}
	return { checked: results.length, expired, reminded };
}
