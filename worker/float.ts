import { parsePhone } from './payout/pawapay.ts';

/**
 * The payout float: our prepaid wallet with the payment provider, one per country. A payout debits the wallet of the RECIPIENT'S country
 * and fails if that wallet is empty; a purchase (a deposit) credits the wallet of the PAYER'S country. So the question that matters is not
 * only "how much is in the wallet" but "does it cover what is already committed", and how long it lasts at the current pace.
 * Pure (no I/O), so it is unit-tested.
 */
export interface WalletBalance { country: string; currency: string; balance: number; provider?: string }
export interface PayoutFlow { phone: string | null; amount_fcfa: number; status: string; paid_at: number | null }
export interface BuyFlow { phone: string; fcfa: number; collected_at: number | null }

export type FloatStatus = 'ok' | 'low' | 'critical';
export interface FloatRow {
	country: string; currency: string; balance: number | null;
	/** the wallet is reserved for one provider (pawaPay's `provider` field) */
	provider: string | null;
	floor: number;
	/** payouts already waiting for approval or in flight: money the wallet must still cover */
	committedFcfa: number; committedCount: number;
	/** actually paid out / collected from purchases in the last 24 hours (our own records) */
	out24hFcfa: number; in24hFcfa: number;
	/** average paid out per day over the last 7 days */
	avgDailyOutFcfa: number;
	/** days the money left after committed payouts lasts at that pace; null when nothing has been paid out lately */
	coverDays: number | null;
	status: FloatStatus;
	reasons: string[];
}

const DAY = 86_400_000;
const IN_FLIGHT = new Set(['pending_approval', 'approved', 'sending']);
export const RELAY_COUNTRIES = ['CIV', 'SEN', 'BFA'];

export function floatReport(i: { balances: WalletBalance[]; payouts: PayoutFlow[]; buys: BuyFlow[]; floor: number; now: number; countries?: string[] }): FloatRow[] {
	const countryOf = (phone: string | null) => (phone ? parsePhone(phone)?.country ?? null : null);
	return (i.countries ?? RELAY_COUNTRIES).map((country) => {
		const wallet = i.balances.find((b) => b.country === country && b.currency === 'XOF');
		const mine = i.payouts.filter((p) => countryOf(p.phone) === country);
		const committed = mine.filter((p) => IN_FLIGHT.has(p.status));
		const paid = mine.filter((p) => p.status === 'paid' && p.paid_at !== null);
		const sum = (xs: { amount_fcfa: number }[]) => xs.reduce((n, x) => n + x.amount_fcfa, 0);
		const committedFcfa = sum(committed);
		const out24hFcfa = sum(paid.filter((p) => i.now - p.paid_at! <= DAY));
		const avgDailyOutFcfa = Math.round(sum(paid.filter((p) => i.now - p.paid_at! <= 7 * DAY)) / 7);
		const in24hFcfa = i.buys.filter((b) => countryOf(b.phone) === country && b.collected_at !== null && i.now - b.collected_at <= DAY).reduce((n, b) => n + b.fcfa, 0);
		const balance = wallet ? wallet.balance : null;
		const free = balance === null ? null : balance - committedFcfa;
		const reasons: string[] = [];
		let status: FloatStatus = 'ok';
		if (balance === null) { status = 'critical'; reasons.push('No XOF wallet for this country on the payment provider account'); }
		else {
			if (balance <= 0) { status = 'critical'; reasons.push('The wallet is empty: every payout here will fail'); }
			else if (free! < 0) { status = 'critical'; reasons.push('Payouts already waiting need more than the wallet holds'); }
			else if (balance < i.floor) { status = 'low'; reasons.push('Below the minimum float'); }
		}
		return {
			country, currency: 'XOF', balance, provider: wallet?.provider || null, floor: i.floor,
			committedFcfa, committedCount: committed.length, out24hFcfa, in24hFcfa, avgDailyOutFcfa,
			coverDays: free !== null && avgDailyOutFcfa > 0 ? Math.max(0, Math.round((free / avgDailyOutFcfa) * 10) / 10) : null,
			status, reasons,
		};
	});
}
