import { normalizeAddress, SELL_ASSETS, toUnits } from './assets';
import { notify } from './notify';
import { createDepositWallet } from './depositWallet';
import { sellQuote } from './pricing';
import { COUNTED, ensureProfile, evaluate, loadFacts, loadModes, logDecision, RuleDenied, windowStarts, type Outcome } from './rules';

export type OrderStatus = 'awaiting_deposit' | 'processing' | 'underpaid';

export interface PayoutView { status: string; amountFcfa: number; phoneMasked: string | null; paidAt: number | null; error: string | null }

interface OrderRow {
	id: string; user_id: string; asset: string; network: string; amount: string; amount_units: string;
	deposit_address: string; deposit_live: number; status: OrderStatus; deposit_tx: string | null;
	deposit_amount_units: string | null; note: string | null; expires_at: number; started_at: number | null; created_at: number;
	phone: string | null; operator: string | null;
	hold_rules: string | null; hold_message: string | null; hold_until: number | null; hold_released_at: number | null;
	// joined from payouts
	p_status: string | null; p_amount: number | null; p_error: string | null; p_paid_at: number | null;
}

/** What the client sees. */
export interface OrderView {
	id: string; status: OrderStatus; asset: string; amount: string;
	depositAddress: string; depositLive: boolean; expiresAt: number;
	startedAt: number | null; depositTx: string | null; note: string | null; payout: PayoutView | null;
	/** set while the payout is held for review; the client shows the message */
	hold: { message: string; until: number | null } | null;
}

const mask = (p: string | null) => (p ? `${p.slice(0, 4)} ·· ${p.slice(-2)}` : null);

/** A hold is active until it is released or its time runs out. NULL hold_until means "until an analyst releases it". */
export const holdActive = (r: { hold_rules: string | null; hold_until: number | null; hold_released_at: number | null }, now = Date.now()) =>
	!!r.hold_rules && r.hold_released_at === null && (r.hold_until === null || now < r.hold_until);

const view = (r: OrderRow): OrderView => ({
	id: r.id, status: r.status, asset: r.asset, amount: r.amount,
	depositAddress: r.deposit_address, depositLive: r.deposit_live === 1, expiresAt: r.expires_at,
	startedAt: r.started_at, depositTx: r.deposit_tx, note: r.note,
	hold: holdActive(r) ? { message: r.hold_message ?? '', until: r.hold_until } : null,
	payout: r.p_status ? { status: r.p_status, amountFcfa: r.p_amount ?? 0, phoneMasked: mask(r.phone), paidAt: r.p_paid_at, error: r.p_error } : null,
});

const SELECT_ORDER = `SELECT o.*, p.status AS p_status, p.amount_fcfa AS p_amount, p.error AS p_error, p.paid_at AS p_paid_at
	FROM orders o LEFT JOIN payouts p ON p.order_id = o.id`;

const DEPOSIT_WINDOW_MS = 15 * 60_000;
const MAX_AMOUNT = 1_000_000;

export class BadRequest extends Error {}

const ID = /^[a-z0-9]{6,32}$/;
const AMOUNT = /^\d{1,12}(\.\d{1,18})?$/;

export interface CreateOrderInput { id: unknown; asset: unknown; amount: unknown; providerId?: unknown; phone?: unknown }

const OPERATORS = new Set(['orange', 'wave', 'pispi', 'moov']);
const PHONE = /^\+\d{8,15}$/;

/** Idempotent per (user, id): retrying the same request returns the same order and deposit address. */
export async function createSellOrder(env: Env, userId: string, input: CreateOrderInput, country: string | null = null, defer: (p: Promise<unknown>) => void = (p) => void p): Promise<OrderView> {
	const id = typeof input.id === 'string' ? input.id : '';
	const asset = typeof input.asset === 'string' ? SELL_ASSETS[input.asset] : undefined;
	const amount = typeof input.amount === 'string' ? input.amount : typeof input.amount === 'number' ? String(input.amount) : '';
	if (!ID.test(id)) throw new BadRequest('Invalid order id');
	if (!asset) throw new BadRequest('Unsupported asset');
	if (!AMOUNT.test(amount) || Number(amount) <= 0 || Number(amount) > MAX_AMOUNT) throw new BadRequest('Invalid amount');
	const operator = typeof input.providerId === 'string' && OPERATORS.has(input.providerId) ? input.providerId : null;
	const phone = typeof input.phone === 'string' ? input.phone.replace(/[\s\-()]/g, '') : '';
	if (!operator) throw new BadRequest('Choose a mobile money provider');
	if (!PHONE.test(phone)) throw new BadRequest('Enter your mobile money number with the country code, e.g. +2250789458900');

	const existing = await env.DB.prepare(`${SELECT_ORDER} WHERE o.id = ?`).bind(id).first<OrderRow>();
	if (existing) {
		if (existing.user_id !== userId) throw new BadRequest('Invalid order id'); // don't reveal other users' ids
		return view(existing);
	}

	// Rules run before a wallet is created: a denied order costs nothing. The FCFA value is priced here, never taken from the client.
	const now = Date.now();
	const amountFcfa = sellQuote(asset.sym, amount).payoutFcfa;
	const profile = await ensureProfile(env, userId, country, now);
	const facts = await loadFacts(env, userId, { amountFcfa, phone, country }, profile, now);
	const outcome = evaluate(facts, { modes: await loadModes(env) });
	if (outcome.action === 'deny') return deny(env, userId, id, outcome);

	const wallet = await createDepositWallet(env, asset, id);
	const address = normalizeAddress(asset.network, wallet.address);
	const w = windowStarts(now);
	const hold = outcome.action === 'hold' ? outcome : null;
	// The daily and monthly checks are repeated INSIDE the insert (with the effective, possibly scaled, limits), so two
	// requests racing past the read above can't both fit under the limit: the second insert matches no rows.
	const ins = await env.DB.prepare(
		`INSERT INTO orders (id, user_id, tab, asset, network, amount, amount_units, provider_id, phone, operator, deposit_address,
		   deposit_wallet_id, deposit_live, status, expires_at, created_at, updated_at, amount_fcfa, hold_rules, hold_message, hold_until)
		 SELECT ?8, ?1, 'sell', ?9, ?10, ?11, ?12, ?13, ?14, ?13, ?15, ?16, ?17, 'awaiting_deposit', ?18, ?2, ?2, ?5, ?19, ?20, ?21
		 WHERE (SELECT COALESCE(SUM(o.amount_fcfa), 0) FROM orders o WHERE ${COUNTED} AND o.created_at >= ?3) + ?5 <= ?6
		   AND (SELECT COALESCE(SUM(o.amount_fcfa), 0) FROM orders o WHERE ${COUNTED} AND o.created_at >= ?4) + ?5 <= ?7`,
	).bind(userId, now, w.day, w.month, amountFcfa, outcome.limits.daily, outcome.limits.monthly,
		id, asset.sym, asset.network, amount, toUnits(amount, asset.decimals).toString(), operator, phone, address,
		wallet.walletId, wallet.live ? 1 : 0, now + DEPOSIT_WINDOW_MS,
		hold ? JSON.stringify(hold.ruleIds) : null, hold ? hold.message : null, hold && hold.hours !== null ? now + hold.hours * 3_600_000 : null).run();
	if (ins.meta.changes === 0) {
		// lost a race: re-read and report the limit that now applies
		const again = evaluate(await loadFacts(env, userId, { amountFcfa, phone, country }, profile, now), { modes: await loadModes(env) });
		const lost: Outcome & { action: 'deny' } = again.action === 'deny' ? again
			: { action: 'deny', status: 422, message: 'Daily limit reached', ruleIds: ['R-04'], fired: again.fired, limits: again.limits, facts: again.facts };
		return deny(env, userId, id, lost);
	}
	await logDecision(env, { userId, orderId: id, outcome });
	// not awaited: triage may call a model, and the customer's request must not wait for an alert
	if (hold) defer(notify(env, { level: 'info', title: 'Payout will be held for review', details: { order: id, rules: hold.ruleIds.join(', '), amountFcfa, until: hold.hours === null ? 'released by an analyst' : `${hold.hours} h` } }));
	if (country) await env.DB.prepare(`UPDATE user_profile SET last_country = ?, updated_at = ? WHERE user_id = ?`).bind(country, now, userId).run();
	const row = await env.DB.prepare(`${SELECT_ORDER} WHERE o.id = ?`).bind(id).first<OrderRow>();
	return view(row!);
}

async function deny(env: Env, userId: string, orderId: string, outcome: Outcome & { action: 'deny' }): Promise<never> {
	await logDecision(env, { userId, orderId, outcome });
	throw new RuleDenied(outcome.message, outcome.status, outcome.ruleIds);
}

export async function getOrder(env: Env, userId: string, id: string): Promise<OrderView | null> {
	const row = await env.DB.prepare(`${SELECT_ORDER} WHERE o.id = ? AND o.user_id = ?`).bind(id, userId).first<OrderRow>();
	return row ? view(row) : null;
}

export async function listOrders(env: Env, userId: string): Promise<OrderView[]> {
	const { results } = await env.DB.prepare(`${SELECT_ORDER} WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 50`).bind(userId).all<OrderRow>();
	return results.map(view);
}

export interface Deposit {
	recipient: string;
	caip2?: string;
	/** native when absent; otherwise the token contract / mint */
	assetAddress?: string;
	isNative: boolean;
	amountUnits: bigint;
	txHash?: string;
}

export type DepositResult = 'no_order' | 'advanced' | 'underpaid' | 'ignored';

/**
 * Applies a confirmed on-chain deposit to the order that owns the receiving address.
 * The status change is a single conditional UPDATE, so two webhooks for the same deposit can't both advance it.
 */
export async function applyDeposit(env: Env, d: Deposit): Promise<{ result: DepositResult; orderId?: string }> {
	const candidates = [d.recipient, d.recipient.toLowerCase()];
	const row = await env.DB.prepare(`${SELECT_ORDER} WHERE o.deposit_address IN (?, ?) AND o.tab = 'sell'`).bind(...candidates).first<OrderRow>();
	if (!row) return { result: 'no_order' };
	if (row.status !== 'awaiting_deposit') return { result: 'ignored', orderId: row.id }; // already advanced (or a second transfer)

	const asset = SELL_ASSETS[row.asset]!;
	const sameChain = !d.caip2 || d.caip2.startsWith(asset.caip2Prefix);
	const sameAsset = asset.token ? !d.isNative && d.assetAddress?.toLowerCase() === asset.token : d.isNative;
	const now = Date.now();
	const late = now > row.expires_at;

	if (!sameChain || !sameAsset) {
		await env.DB.prepare(`UPDATE orders SET status = 'underpaid', note = ?, deposit_tx = ?, updated_at = ? WHERE id = ? AND status = 'awaiting_deposit'`)
			.bind('Wrong asset or chain received', d.txHash ?? null, now, row.id).run();
		return { result: 'underpaid', orderId: row.id };
	}
	if (d.amountUnits < BigInt(row.amount_units)) {
		await env.DB.prepare(`UPDATE orders SET status = 'underpaid', note = ?, deposit_tx = ?, deposit_amount_units = ?, updated_at = ? WHERE id = ? AND status = 'awaiting_deposit'`)
			.bind('Deposit smaller than the order amount', d.txHash ?? null, d.amountUnits.toString(), now, row.id).run();
		return { result: 'underpaid', orderId: row.id };
	}
	// Confirm the deposit and create the payout in ONE batch (a transaction): an order can't be 'processing' without its payout.
	// The payout starts as pending_approval: a person releases the money.
	const q = sellQuote(row.asset, row.amount);
	const [res] = await env.DB.batch([
		env.DB.prepare(`UPDATE orders SET status = 'processing', started_at = ?, deposit_tx = ?, deposit_amount_units = ?, note = ?, updated_at = ? WHERE id = ? AND status = 'awaiting_deposit'`)
			.bind(now, d.txHash ?? null, d.amountUnits.toString(), late ? 'Deposit arrived after the quote expired; converted at the current rate' : null, now, row.id),
		env.DB.prepare(`INSERT OR IGNORE INTO payouts (id, order_id, user_id, provider, phone, operator, amount_fcfa, gross_fcfa, platform_fee_fcfa, psp_fee_fcfa, status, created_at, updated_at)
			SELECT 'po' || o.id, o.id, o.user_id, ?, o.phone, o.operator, ?, ?, ?, ?, 'pending_approval', ?, ? FROM orders o WHERE o.id = ? AND o.status = 'processing'`)
			.bind(env.PAYOUT_PROVIDER, q.payoutFcfa, q.grossFcfa, q.platformFeeFcfa, q.pspFeeFcfa, now, now, row.id),
	]);
	return { result: res!.meta.changes > 0 ? 'advanced' : 'ignored', orderId: row.id };
}
