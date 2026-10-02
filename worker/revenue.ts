import { PLATFORM_FEE, PSP_FEE, TOTAL_FEE } from './pricing';

/**
 * Revenue from payouts (cash-outs): the customer pays 5% of an order's value, 2.5% to Relay (platform fee) and 2.5% to the
 * payment provider (PSP fee, passed through). It is recognised when the payout is PAID; payouts still moving are reported as
 * pending, and failed or rejected ones earn nothing. Amounts come from the split stored on each payout when it was created.
 * Sells only: buys and swaps aren't server orders yet, so their fees aren't here. Payouts created before migration 0007 have
 * no split and are counted separately.
 */
export interface Totals { count: number; grossFcfa: number; platformFeeFcfa: number; pspFeeFcfa: number; payoutFcfa: number }
export interface DayRow extends Totals { day: string }
export interface Breakdown extends Totals { key: string }
export interface Revenue {
	feeRates: { platform: number; psp: number; total: number };
	days: number;
	paid: Totals;
	pending: Totals;
	daily: DayRow[];
	byAsset: Breakdown[];
	byOperator: Breakdown[];
	/** paid payouts without a fee split (created before migration 0007) */
	uncountedPaid: number;
}

const COLS = `COUNT(*) AS count, COALESCE(SUM(p.gross_fcfa), 0) AS grossFcfa, COALESCE(SUM(p.platform_fee_fcfa), 0) AS platformFeeFcfa,
	COALESCE(SUM(p.psp_fee_fcfa), 0) AS pspFeeFcfa, COALESCE(SUM(p.amount_fcfa), 0) AS payoutFcfa`;

export async function revenueReport(env: Env, days: number, now = Date.now()): Promise<Revenue> {
	const since = days > 0 ? now - days * 86_400_000 : 0;
	const paidWhere = `p.status = 'paid' AND p.gross_fcfa IS NOT NULL AND p.paid_at >= ?`;
	const [paid, pending, daily, byAsset, byOperator, legacy] = await env.DB.batch([
		env.DB.prepare(`SELECT ${COLS} FROM payouts p WHERE ${paidWhere}`).bind(since),
		env.DB.prepare(`SELECT ${COLS} FROM payouts p WHERE p.status IN ('pending_approval', 'approved', 'sending') AND p.gross_fcfa IS NOT NULL`),
		env.DB.prepare(`SELECT strftime('%Y-%m-%d', p.paid_at / 1000, 'unixepoch') AS day, ${COLS} FROM payouts p WHERE ${paidWhere} GROUP BY day ORDER BY day`).bind(since),
		env.DB.prepare(`SELECT o.asset AS key, ${COLS} FROM payouts p JOIN orders o ON o.id = p.order_id WHERE ${paidWhere} GROUP BY o.asset ORDER BY SUM(p.platform_fee_fcfa) DESC`).bind(since),
		env.DB.prepare(`SELECT COALESCE(p.operator, 'unknown') AS key, ${COLS} FROM payouts p WHERE ${paidWhere} GROUP BY p.operator ORDER BY SUM(p.platform_fee_fcfa) DESC`).bind(since),
		env.DB.prepare(`SELECT COUNT(*) AS n FROM payouts p WHERE p.status = 'paid' AND p.gross_fcfa IS NULL AND p.paid_at >= ?`).bind(since),
	]);
	return {
		feeRates: { platform: PLATFORM_FEE, psp: PSP_FEE, total: TOTAL_FEE },
		days,
		paid: paid!.results[0] as unknown as Totals,
		pending: pending!.results[0] as unknown as Totals,
		daily: daily!.results as unknown as DayRow[],
		byAsset: byAsset!.results as unknown as Breakdown[],
		byOperator: byOperator!.results as unknown as Breakdown[],
		uncountedPaid: (legacy!.results[0] as { n: number }).n,
	};
}
