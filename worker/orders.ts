import { normalizeAddress, SELL_ASSETS, toUnits } from './assets';
import { createDepositWallet } from './depositWallet';
import { sellPayoutFcfa } from './pricing';

export type OrderStatus = 'awaiting_deposit' | 'processing' | 'underpaid';

export interface PayoutView { status: string; amountFcfa: number; phoneMasked: string | null; paidAt: number | null; error: string | null }

interface OrderRow {
	id: string; user_id: string; asset: string; network: string; amount: string; amount_units: string;
	deposit_address: string; deposit_live: number; status: OrderStatus; deposit_tx: string | null;
	deposit_amount_units: string | null; note: string | null; expires_at: number; started_at: number | null; created_at: number;
	phone: string | null; operator: string | null;
	// joined from payouts
	p_status: string | null; p_amount: number | null; p_error: string | null; p_paid_at: number | null;
}

/** What the client sees. */
export interface OrderView {
	id: string; status: OrderStatus; asset: string; amount: string;
	depositAddress: string; depositLive: boolean; expiresAt: number;
	startedAt: number | null; depositTx: string | null; note: string | null; payout: PayoutView | null;
}

const mask = (p: string | null) => (p ? `${p.slice(0, 4)} ·· ${p.slice(-2)}` : null);

const view = (r: OrderRow): OrderView => ({
	id: r.id, status: r.status, asset: r.asset, amount: r.amount,
	depositAddress: r.deposit_address, depositLive: r.deposit_live === 1, expiresAt: r.expires_at,
	startedAt: r.started_at, depositTx: r.deposit_tx, note: r.note,
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
export async function createSellOrder(env: Env, userId: string, input: CreateOrderInput): Promise<OrderView> {
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

	const wallet = await createDepositWallet(env, asset, id);
	const now = Date.now();
	const address = normalizeAddress(asset.network, wallet.address);
	await env.DB.prepare(
		`INSERT INTO orders (id, user_id, tab, asset, network, amount, amount_units, provider_id, phone, operator, deposit_address,
		   deposit_wallet_id, deposit_live, status, expires_at, created_at, updated_at)
		 VALUES (?, ?, 'sell', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_deposit', ?, ?, ?)`,
	).bind(id, userId, asset.sym, asset.network, amount, toUnits(amount, asset.decimals).toString(),
		operator, phone, operator, address, wallet.walletId, wallet.live ? 1 : 0,
		now + DEPOSIT_WINDOW_MS, now, now).run();
	const row = await env.DB.prepare(`${SELECT_ORDER} WHERE o.id = ?`).bind(id).first<OrderRow>();
	return view(row!);
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
	const payoutAmount = sellPayoutFcfa(row.asset, row.amount);
	const [res] = await env.DB.batch([
		env.DB.prepare(`UPDATE orders SET status = 'processing', started_at = ?, deposit_tx = ?, deposit_amount_units = ?, note = ?, updated_at = ? WHERE id = ? AND status = 'awaiting_deposit'`)
			.bind(now, d.txHash ?? null, d.amountUnits.toString(), late ? 'Deposit arrived after the quote expired; converted at the current rate' : null, now, row.id),
		env.DB.prepare(`INSERT OR IGNORE INTO payouts (id, order_id, user_id, provider, phone, operator, amount_fcfa, status, created_at, updated_at)
			SELECT 'po' || o.id, o.id, o.user_id, ?, o.phone, o.operator, ?, 'pending_approval', ?, ? FROM orders o WHERE o.id = ? AND o.status = 'processing'`)
			.bind(env.PAYOUT_PROVIDER, payoutAmount, now, now, row.id),
	]);
	return { result: res!.meta.changes > 0 ? 'advanced' : 'ignored', orderId: row.id };
}
