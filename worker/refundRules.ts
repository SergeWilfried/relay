/** Pure refund rules (no imports, so they are unit-tested in plain Node). See worker/refunds.ts for the workflow. */

export interface Refundable {
	orderStatus: string; note: string | null; depositAmountUnits: string | null;
	payoutStatus: string | null; holdA01Active: boolean; existingRefundStatus: string | null;
}

/** Pure: may this order be refunded? Returns the reason it may not, in words for the analyst. */
export function checkRefundable(o: Refundable): { ok: true } | { ok: false; reason: string } {
	if (o.existingRefundStatus && o.existingRefundStatus !== 'cancelled') return { ok: false, reason: `This order already has a refund (${o.existingRefundStatus})` };
	if (o.orderStatus === 'awaiting_deposit') return { ok: false, reason: 'Nothing was deposited for this order' };
	if (!o.depositAmountUnits) return { ok: false, reason: 'No deposit amount is recorded for this order' };
	if (o.holdA01Active) return { ok: false, reason: 'The deposit came from a denylisted address (compliance hold): it is not refunded automatically' };
	if (o.orderStatus === 'underpaid') {
		if (/^Wrong asset/i.test(o.note ?? '')) return { ok: false, reason: 'A wrong-asset or wrong-chain deposit cannot be swept by Relay: recover it by hand from the deposit wallet' };
		return { ok: true };
	}
	if (o.orderStatus === 'processing') {
		if (o.payoutStatus === 'failed' || o.payoutStatus === 'rejected') return { ok: true };
		if (o.payoutStatus === 'paid') return { ok: false, reason: 'The customer was already paid out: nothing to refund' };
		return { ok: false, reason: 'The payout is still in progress: reject it (or wait for it to fail) before refunding' };
	}
	return { ok: false, reason: 'This order cannot be refunded' };
}

const TX_EVM = /^0x[0-9a-fA-F]{64}$/;
const TX_SOL = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;
const NAME = /^[\p{L}][\p{L}\p{N} ._'@+-]{1,59}$/u; // also admin names (worker/adminAuth.ts: lowercase handles or emails)


export const validTxHash = (network: string, h: unknown): h is string => typeof h === 'string' && (network === 'Solana' ? TX_SOL : TX_EVM).test(h);
export const validName = (v: unknown): v is string => typeof v === 'string' && NAME.test(v.trim());
