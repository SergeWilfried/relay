/**
 * Which swaps Relay offers through Privy's swap wallet action, and how an app-level request ("100 USDC -> SOL") becomes Privy's request.
 * Pure (no I/O), so it is unit-tested. Privy: https://docs.privy.io/wallets/actions/swap/overview
 */
export type Chain = 'ethereum' | 'solana';
export interface SwapAsset { sym: string; chain: Chain; caip2: string; /** "native" or the token contract / mint */ address: string; decimals: number }

export const ETH_CAIP2 = 'eip155:1';
export const SOL_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'; // Solana mainnet-beta

/** The assets that can be swapped: ETH, USDT and USDC on Ethereum, SOL on Solana. BTC can't (no wallet, no route). */
export const SWAP_ASSETS: Record<string, SwapAsset> = {
	ETH: { sym: 'ETH', chain: 'ethereum', caip2: ETH_CAIP2, address: 'native', decimals: 18 },
	USDT: { sym: 'USDT', chain: 'ethereum', caip2: ETH_CAIP2, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
	USDC: { sym: 'USDC', chain: 'ethereum', caip2: ETH_CAIP2, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
	SOL: { sym: 'SOL', chain: 'solana', caip2: SOL_CAIP2, address: 'native', decimals: 9 },
};

export interface SwapWallets { ethereum?: { id: string; address: string }; solana?: { id: string; address: string } }

export interface PrivySwapRequest {
	/** the wallet (by id) that holds the input token and signs */
	walletId: string;
	body: {
		source: { caip2: string; asset_address: string };
		destination: { asset_address: string; caip2: string; destination_address?: string };
		base_amount: string;
		amount_type: 'exact_input';
		slippage_bps?: number;
	};
	crossChain: boolean;
}

/** Decimal string -> base units without float error. null when it isn't a positive amount with at most `decimals` places. */
export function toBaseUnits(amount: string, decimals: number): string | null {
	const m = /^(\d{1,18})(?:\.(\d{1,18}))?$/.exec(amount.trim());
	if (!m) return null;
	const frac = m[2] ?? '';
	if (frac.length > decimals) return null;
	const units = BigInt(m[1]! + frac.padEnd(decimals, '0'));
	return units > 0n ? units.toString() : null;
}

export type PlanResult = { ok: true; req: PrivySwapRequest; from: SwapAsset; to: SwapAsset } | { ok: false; error: string };

export const MIN_SLIPPAGE_BPS = 10;
export const MAX_SLIPPAGE_BPS = 300; // 3%: beyond this a swap is more likely a mistake or an attack than a trade

export function planSwap(i: { from: unknown; to: unknown; amount: unknown; slippageBps?: unknown; wallets: SwapWallets }): PlanResult {
	const from = typeof i.from === 'string' ? SWAP_ASSETS[i.from] : undefined;
	const to = typeof i.to === 'string' ? SWAP_ASSETS[i.to] : undefined;
	if (!from || !to) return { ok: false, error: 'This asset can’t be swapped' };
	if (from.sym === to.sym) return { ok: false, error: 'Choose two different assets' };
	const units = typeof i.amount === 'string' ? toBaseUnits(i.amount, from.decimals) : null;
	if (!units) return { ok: false, error: 'Enter a valid amount' };
	let slippage: number | undefined;
	if (i.slippageBps !== undefined) {
		if (typeof i.slippageBps !== 'number' || !Number.isInteger(i.slippageBps) || i.slippageBps < MIN_SLIPPAGE_BPS || i.slippageBps > MAX_SLIPPAGE_BPS) return { ok: false, error: 'Slippage must be between 0.1% and 3%' };
		slippage = i.slippageBps;
	}
	const source = i.wallets[from.chain];
	if (!source) return { ok: false, error: 'You need a wallet on this network to swap it' };
	const crossChain = from.chain !== to.chain;
	let destination: PrivySwapRequest['body']['destination'] = { asset_address: to.address, caip2: to.caip2 };
	if (crossChain) {
		const target = i.wallets[to.chain];
		if (!target) return { ok: false, error: 'You need a wallet on the destination network to swap into it' };
		destination = { ...destination, destination_address: target.address }; // always the customer's OWN wallet, never taken from the request
	}
	return { ok: true, from, to, req: { walletId: source.id, crossChain, body: { source: { caip2: from.caip2, asset_address: from.address }, destination, base_amount: units, amount_type: 'exact_input', ...(slippage ? { slippage_bps: slippage } : {}) } } };
}

/** Base units of the output token -> a human decimal string (no float error). */
export function fromBaseUnits(units: string, decimals: number): string {
	try {
		const n = BigInt(units), base = 10n ** BigInt(decimals);
		const frac = (n % base).toString().padStart(decimals, '0').replace(/0+$/, '');
		return `${n / base}${frac ? `.${frac}` : ''}`;
	} catch { return units; }
}
