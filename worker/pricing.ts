/**
 * Server-side payout pricing. The amount a user is paid is decided HERE, never taken from the client.
 * PLACEHOLDER RATES: these mirror the app's mock rates (src/lib/data.ts). Replace with a real rate feed
 * (and a rate lock tied to the order quote) before going live.
 */
const FCFA_PER_UNIT: Record<string, number> = {
	ETH: 1_652_400,
	SOL: 1_652_400 / 19.67,
	USDT: 600,
	USDC: 600,
};
const RAIL_FEE = 0.0025;

export function sellPayoutFcfa(asset: string, amount: string): number {
	const rate = FCFA_PER_UNIT[asset];
	if (!rate) throw new Error(`No price for ${asset}`);
	const gross = Number(amount) * rate;
	return Math.round((gross - gross * RAIL_FEE) / 100) * 100; // whole 100 FCFA, like the quote shown to the user
}
