import type { SellAsset } from './assets';

export interface DepositWallet { address: string; walletId: string | null; live: boolean }

const hex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * One fresh deposit address per order, so an incoming transfer maps to exactly one order.
 *  - LIVE=true: a Privy server wallet is created (https://docs.privy.io/api-reference/wallets/create). Privy then
 *    emits wallet.funds_deposited webhooks for it.
 *  - otherwise: a random placeholder address that is NOT a real wallet (live:false). The client refuses to send
 *    real funds to non-live addresses; deposits are simulated with scripts/send-test-webhook.mjs.
 */
export async function createDepositWallet(env: Env, asset: SellAsset, orderId: string): Promise<DepositWallet> {
	// `LIVE` is a string var; widen it so the comparison isn't narrowed to the literal in the generated types
	if ((env.LIVE as string) !== 'true') {
		const address = asset.chainType === 'ethereum' ? `0x${hex(20)}` : hex(32).slice(0, 44);
		return { address, walletId: null, live: false };
	}
	if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) throw new Error('PRIVY_APP_ID / PRIVY_APP_SECRET are required when LIVE=true');
	const res = await fetch('https://api.privy.io/v1/wallets', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'privy-app-id': env.PRIVY_APP_ID,
			authorization: `Basic ${btoa(`${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`)}`,
			'privy-idempotency-key': `deposit-wallet-${orderId}`, // safe to retry: the same order always gets the same wallet
		},
		body: JSON.stringify({ chain_type: asset.chainType, external_id: orderId.slice(0, 64), display_name: `Deposit ${orderId}` }),
	});
	if (!res.ok) throw new Error(`Privy wallet creation failed (${res.status})`);
	const w = (await res.json()) as { id?: string; address?: string };
	if (!w.address || !w.id) throw new Error('Privy wallet response missing id/address');
	return { address: w.address, walletId: w.id, live: true };
}
