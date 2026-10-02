/** Assets a user can sell, and how a deposit of each shows up on chain. */
export interface SellAsset {
	sym: string;
	network: 'Ethereum' | 'Solana';
	chainType: 'ethereum' | 'solana';
	caip2Prefix: string; // eip155:1 | solana:
	decimals: number;
	/** ERC-20 contract / SPL mint; absent = native token */
	token?: string;
}

export const SELL_ASSETS: Record<string, SellAsset> = {
	ETH: { sym: 'ETH', network: 'Ethereum', chainType: 'ethereum', caip2Prefix: 'eip155:1', decimals: 18 },
	USDT: { sym: 'USDT', network: 'Ethereum', chainType: 'ethereum', caip2Prefix: 'eip155:1', decimals: 6, token: '0xdac17f958d2ee523a2206206994597c13d831ec7' },
	USDC: { sym: 'USDC', network: 'Ethereum', chainType: 'ethereum', caip2Prefix: 'eip155:1', decimals: 6, token: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
	SOL: { sym: 'SOL', network: 'Solana', chainType: 'solana', caip2Prefix: 'solana:', decimals: 9 },
};

/** Decimal string -> base units, without float error. */
export function toUnits(amount: string, decimals: number): bigint {
	const [whole = '0', frac = ''] = amount.split('.');
	return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals));
}

/** EVM addresses are case-insensitive; Solana's are not. */
export const normalizeAddress = (network: string, address: string) => (network === 'Solana' ? address : address.toLowerCase());
