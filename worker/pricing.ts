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
/** Same numbers as src/lib/fees.ts (test/pricing.test.ts keeps them equal). */
export const PLATFORM_FEE = 0.025;
export const PSP_FEE = 0.025;
export const TOTAL_FEE = PLATFORM_FEE + PSP_FEE;

export interface SellQuote {
	/** the crypto's value in FCFA */
	grossFcfa: number;
	/** what the customer receives: 95%, rounded DOWN to whole 100 FCFA (like the quote shown to them), so it can never exceed what they are owed */
	payoutFcfa: number;
	/** the PSP's share of the fee (passed through to the payment provider) */
	pspFeeFcfa: number;
	/** Relay's revenue. Takes the rounding remainder, so payout + platform + psp always equals gross exactly. */
	platformFeeFcfa: number;
}

export function sellQuote(asset: string, amount: string): SellQuote {
	const rate = FCFA_PER_UNIT[asset];
	if (!rate) throw new Error(`No price for ${asset}`);
	const grossFcfa = Math.round(Number(amount) * rate);
	const payoutFcfa = Math.floor((grossFcfa - grossFcfa * TOTAL_FEE) / 100) * 100;
	const pspFeeFcfa = Math.round(grossFcfa * PSP_FEE);
	return { grossFcfa, payoutFcfa, pspFeeFcfa, platformFeeFcfa: grossFcfa - payoutFcfa - pspFeeFcfa };
}

export const sellPayoutFcfa = (asset: string, amount: string) => sellQuote(asset, amount).payoutFcfa;
