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

/** Flat network fee charged on a purchase, in FCFA (the delivery transaction). Same number as src/lib/fees.ts. */
export const NETWORK_FEE_FCFA = 710;

export interface BuyQuote {
	/** what the customer pays */
	fcfa: number;
	platformFeeFcfa: number;
	pspFeeFcfa: number;
	networkFeeFcfa: number;
	/** crypto to deliver, in base units: what is left after the fees, at the rate, rounded DOWN */
	amountUnits: bigint;
}

/** Server-side purchase pricing: the customer pays `fcfa`; 5% in fees and the network fee come off; the rest buys crypto at the (placeholder) rate. */
export function buyQuote(asset: string, fcfa: number, decimals: number): BuyQuote {
	const rate = FCFA_PER_UNIT[asset];
	if (!rate) throw new Error(`No price for ${asset}`);
	const pspFeeFcfa = Math.round(fcfa * PSP_FEE);
	const platformFeeFcfa = Math.round(fcfa * TOTAL_FEE) - pspFeeFcfa;
	const net = Math.max(0, fcfa - pspFeeFcfa - platformFeeFcfa - NETWORK_FEE_FCFA);
	// integer maths: net FCFA / (FCFA per unit) * 10^decimals, with the rate carried in millionths of an FCFA so SOL's fractional rate is exact enough
	const rateMicro = BigInt(Math.round(rate * 1e6));
	const amountUnits = (BigInt(net) * 10n ** BigInt(decimals) * 1_000_000n) / rateMicro;
	return { fcfa, platformFeeFcfa, pspFeeFcfa, networkFeeFcfa: NETWORK_FEE_FCFA, amountUnits };
}
