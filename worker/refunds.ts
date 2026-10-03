import { SELL_ASSETS } from './assets';
import { checkRefundable, validName, validTxHash } from './refundRules';
import { holdActive } from './orders';
import { isDenied, normalizeEntry, type ListKind } from './lists';
import { notify } from './notify';

/**
 * Crypto refunds for sell orders that can't be paid out. Relay has no treasury key (the deposit wallets can only forward to the
 * treasury), so a refund is SENT by a person from the treasury; Relay decides whether it may happen, who asked and who
 * approved, records the transaction, tells the customer, and stops the payout from also being made.
 *
 * requested -> approved (by a DIFFERENT person) -> sent (with the transaction hash), or cancelled before it is sent.
 */
export type RefundStatus = 'requested' | 'approved' | 'sent' | 'cancelled';
export interface RefundRow {
	id: string; order_id: string; user_id: string; asset: string; network: string; amount_units: string; destination: string; reason: string;
	status: RefundStatus; requested_by: string; approved_by: string | null; tx_hash: string | null; created_at: number; updated_at: number;
}

export class RefundError extends Error { status: number; constructor(message: string, status = 409) { super(message); this.status = status; } }

const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ msg, ...extra }));

const kindOf = (network: string): ListKind => (network === 'Solana' ? 'solana' : 'evm');

function who(v: unknown): string {
	if (!validName(v)) throw new RefundError('Your name is required (2 to 40 letters): it is kept in the audit log', 400);
	return (v as string).trim();
}

interface OrderForRefund { id: string; user_id: string; asset: string; network: string; status: string; note: string | null; deposit_amount_units: string | null; deposit_address: string; hold_rules: string | null; hold_until: number | null; hold_released_at: number | null; p_status: string | null; r_status: string | null }

const ORDER_SQL = `SELECT o.id, o.user_id, o.asset, o.network, o.status, o.note, o.deposit_amount_units, o.deposit_address, o.hold_rules, o.hold_until, o.hold_released_at,
	(SELECT p.status FROM payouts p WHERE p.order_id = o.id) AS p_status, (SELECT r.status FROM refunds r WHERE r.order_id = o.id) AS r_status
	FROM orders o WHERE o.id = ?`;

const refundable = (o: OrderForRefund) => checkRefundable({
	orderStatus: o.status, note: o.note, depositAmountUnits: o.deposit_amount_units, payoutStatus: o.p_status,
	holdA01Active: holdActive(o) && !!o.hold_rules?.includes('"A-01"'), existingRefundStatus: o.r_status,
});

async function event(env: Env, refundId: string, action: RefundStatus, by: string, note?: string | null) {
	await env.DB.prepare(`INSERT INTO refund_events (refund_id, action, by_name, note, created_at) VALUES (?, ?, ?, ?, ?)`).bind(refundId, action, by, note ?? null, Date.now()).run();
}

export const getRefund = (env: Env, id: string) => env.DB.prepare('SELECT * FROM refunds WHERE id = ?').bind(id).first<RefundRow>();

export async function createRefund(env: Env, input: { orderId: unknown; destination: unknown; reason: unknown; by: unknown; amountUnits?: unknown }): Promise<RefundRow> {
	const by = who(input.by);
	if (typeof input.orderId !== 'string') throw new RefundError('orderId is required', 400);
	if (typeof input.reason !== 'string' || input.reason.trim().length < 5) throw new RefundError('A reason is required (why is this order being refunded?)', 400);
	const o = await env.DB.prepare(ORDER_SQL).bind(input.orderId).first<OrderForRefund>();
	if (!o) throw new RefundError('Order not found', 404);
	const ok = refundable(o);
	if (!ok.ok) throw new RefundError(ok.reason);

	const asset = SELL_ASSETS[o.asset]!;
	const destination = normalizeEntry(kindOf(asset.network), input.destination);
	if (!destination) throw new RefundError(`The destination must be a valid ${asset.network === 'Solana' ? 'Solana' : 'Ethereum'} address`, 400);
	if (destination === normalizeEntry(kindOf(asset.network), o.deposit_address)) throw new RefundError("A refund can't go back to the order's own deposit wallet", 400);
	if (await isDenied(env, kindOf(asset.network), destination)) throw new RefundError('That destination is on the recipient denylist', 400);

	const deposited = BigInt(o.deposit_amount_units!);
	let amount = deposited;
	if (input.amountUnits !== undefined) {
		if (typeof input.amountUnits !== 'string' || !/^\d{1,40}$/.test(input.amountUnits)) throw new RefundError('amountUnits must be a whole number of base units', 400);
		amount = BigInt(input.amountUnits);
		if (amount <= 0n || amount > deposited) throw new RefundError('The refund must be more than zero and at most what was deposited', 400);
	}
	const id = `rf${o.id}`;
	const now = Date.now();
	// A cancelled refund can be started again: reuse its row (the order's refund is unique), keeping the old events in the log
	await env.DB.prepare(
		`INSERT INTO refunds (id, order_id, user_id, asset, network, amount_units, destination, reason, status, requested_by, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'requested', ?9, ?10, ?10)
		 ON CONFLICT(order_id) DO UPDATE SET amount_units = ?6, destination = ?7, reason = ?8, status = 'requested', requested_by = ?9, approved_by = NULL, tx_hash = NULL, created_at = ?10, updated_at = ?10
		 WHERE refunds.status = 'cancelled'`,
	).bind(id, o.id, o.user_id, o.asset, o.network, amount.toString(), destination, input.reason.trim(), by, now).run();
	await event(env, id, 'requested', by, input.reason.trim());
	log('refund.requested', { id, by });
	await notify(env, { level: 'info', title: 'Refund requested: needs a second person to approve', details: { refund: id, order: o.id, asset: o.asset, amountUnits: amount.toString(), requestedBy: by } });
	return (await getRefund(env, id))!;
}

async function move(env: Env, id: string, from: RefundStatus[], set: string, ...binds: unknown[]): Promise<boolean> {
	const marks = from.map(() => '?').join(',');
	const r = await env.DB.prepare(`UPDATE refunds SET ${set}, updated_at = ? WHERE id = ? AND status IN (${marks})`).bind(...binds, Date.now(), id, ...from).run();
	return r.meta.changes > 0;
}

/** Four eyes: the approver must be a different person from the requester. */
export async function approveRefund(env: Env, id: string, byRaw: unknown): Promise<RefundRow> {
	const by = who(byRaw);
	const r = await getRefund(env, id);
	if (!r) throw new RefundError('Refund not found', 404);
	if (r.requested_by.toLowerCase() === by.toLowerCase()) throw new RefundError('A refund must be approved by a different person than the one who requested it');
	if (!(await move(env, id, ['requested'], `status = 'approved', approved_by = ?`, by))) throw new RefundError('Only a requested refund can be approved');
	await event(env, id, 'approved', by);
	log('refund.approved', { id, by });
	return (await getRefund(env, id))!;
}

/**
 * Records that the refund was sent from the treasury. The funds must have reached the treasury first (the deposit is forwarded by
 * the sweep): for a deposit that was never swept, approving a refund queues the sweep, and this waits for it.
 */
export async function markRefundSent(env: Env, id: string, byRaw: unknown, txHash: unknown): Promise<RefundRow> {
	const by = who(byRaw);
	const r = await getRefund(env, id);
	if (!r) throw new RefundError('Refund not found', 404);
	if (!validTxHash(r.network, txHash)) throw new RefundError(`That is not a valid ${r.network === 'Solana' ? 'Solana' : 'Ethereum'} transaction hash`, 400);
	const sweep = await env.DB.prepare('SELECT status FROM sweeps WHERE order_id = ?').bind(r.order_id).first<{ status: string }>();
	if ((env.LIVE as string) === 'true' && sweep?.status !== 'submitted') throw new RefundError(`The deposit has not reached the treasury yet (sweep: ${sweep?.status ?? 'not queued'}), so it cannot have been refunded from there`);
	if (!(await move(env, id, ['approved'], `status = 'sent', tx_hash = ?`, txHash))) throw new RefundError('Only an approved refund can be marked as sent');
	await event(env, id, 'sent', by, txHash);
	log('refund.sent', { id, by, tx: txHash });
	return (await getRefund(env, id))!;
}

export async function cancelRefund(env: Env, id: string, byRaw: unknown, reason: unknown): Promise<RefundRow> {
	const by = who(byRaw);
	if (typeof reason !== 'string' || reason.trim().length < 3) throw new RefundError('A reason is required', 400);
	if (!(await move(env, id, ['requested', 'approved'], `status = 'cancelled'`))) throw new RefundError('Only a refund that has not been sent can be cancelled');
	await event(env, id, 'cancelled', by, reason.trim());
	log('refund.cancelled', { id, by });
	return (await getRefund(env, id))!;
}

export async function listRefunds(env: Env, status?: string): Promise<(RefundRow & { events: { action: string; by_name: string; note: string | null; created_at: number }[] })[]> {
	const q = status ? env.DB.prepare('SELECT * FROM refunds WHERE status = ? ORDER BY created_at DESC LIMIT 200').bind(status) : env.DB.prepare('SELECT * FROM refunds ORDER BY created_at DESC LIMIT 200');
	const rows = (await q.all<RefundRow>()).results;
	if (rows.length === 0) return [];
	const marks = rows.map(() => '?').join(',');
	const ev = (await env.DB.prepare(`SELECT refund_id, action, by_name, note, created_at FROM refund_events WHERE refund_id IN (${marks}) ORDER BY id`).bind(...rows.map((r) => r.id)).all<{ refund_id: string; action: string; by_name: string; note: string | null; created_at: number }>()).results;
	return rows.map((r) => ({ ...r, events: ev.filter((e) => e.refund_id === r.id) }));
}

export interface EligibleOrder { orderId: string; asset: string; network: string; reason: string; depositAmountUnits: string; payoutStatus: string | null; payoutError: string | null; suggestedDestination: string | null; createdAt: number }

/** Orders an analyst could refund: deposits smaller than the order and payouts that failed or were rejected, with no live refund yet. */
export async function listEligible(env: Env): Promise<EligibleOrder[]> {
	const { results } = await env.DB.prepare(
		`SELECT o.id, o.user_id, o.asset, o.network, o.status, o.note, o.deposit_amount_units, o.created_at, p.status AS p_status, p.error AS p_error,
		        o.hold_rules, o.hold_until, o.hold_released_at, o.deposit_address, (SELECT r.status FROM refunds r WHERE r.order_id = o.id) AS r_status
		 FROM orders o LEFT JOIN payouts p ON p.order_id = o.id
		 WHERE o.tab = 'sell' AND o.deposit_amount_units IS NOT NULL AND (o.status = 'underpaid' OR p.status IN ('failed', 'rejected'))
		 ORDER BY o.created_at DESC LIMIT 100`,
	).all<OrderForRefund & { created_at: number; p_error: string | null }>();
	const out: EligibleOrder[] = [];
	for (const o of results) {
		const ok = refundable({ ...o, p_status: o.p_status });
		if (!ok.ok) continue;
		out.push({
			orderId: o.id, asset: o.asset, network: o.network, reason: o.status === 'underpaid' ? (o.note ?? 'Deposit smaller than the order') : `Payout ${o.p_status}`,
			depositAmountUnits: o.deposit_amount_units!, payoutStatus: o.p_status, payoutError: o.p_error, createdAt: o.created_at,
			suggestedDestination: await usersWallet(env, o.user_id, o.network),
		});
	}
	return out;
}

/** The customer's own Relay wallet on the order's chain, from the wallet index kept by the Privy webhook (a suggestion: the analyst confirms it). */
async function usersWallet(env: Env, userId: string, network: string): Promise<string | null> {
	try {
		const v = JSON.parse((await env.EVENTS.get(`user:${userId}`)) ?? 'null') as { wallets?: { address: string; chain?: string }[] } | null;
		const want = network === 'Solana' ? 'solana' : 'ethereum';
		return v?.wallets?.find((w) => w.chain === want)?.address ?? null;
	} catch { return null; }
}

/** Reminds when a refund has waited too long (the customer was told 24 hours). Once per refund per day. */
export async function checkStaleRefunds(env: Env, now = Date.now()): Promise<number> {
	const { results } = await env.DB.prepare(`SELECT id, order_id, status, created_at FROM refunds WHERE status IN ('requested', 'approved') AND created_at < ?`).bind(now - 24 * 3_600_000).all<{ id: string; order_id: string; status: string; created_at: number }>();
	let n = 0;
	for (const r of results) {
		const key = `refund:stale:${r.id}`;
		if (await env.EVENTS.get(key)) continue;
		await env.EVENTS.put(key, '1', { expirationTtl: 24 * 3600 });
		await notify(env, { level: 'warning', title: `Refund waiting more than 24 hours (${r.status}): the customer was promised 24 hours`, details: { refund: r.id, order: r.order_id, hoursWaiting: Math.round((now - r.created_at) / 3_600_000) } });
		n++;
	}
	return n;
}
