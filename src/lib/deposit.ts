import type { Asset } from './data';

/**
 * Where a user sends crypto to fund a sell order.
 * PRODUCTION: this comes from the order API (a per-order address). Until then it is read from
 * VITE_DEPOSIT_ADDR_ETH / _SOL / _BTC; if unset we fall back to a placeholder and mark it NOT live,
 * and the app refuses to move real funds to it.
 */
export interface DepositTarget { address: string; live: boolean }

export function depositTargetFor(asset: Asset): DepositTarget {
  const env = import.meta.env as Record<string, string | undefined>;
  const key = asset.net === 'Solana' ? 'VITE_DEPOSIT_ADDR_SOL' : asset.net === 'Bitcoin' ? 'VITE_DEPOSIT_ADDR_BTC' : 'VITE_DEPOSIT_ADDR_ETH';
  const configured = env[key]?.trim();
  return configured ? { address: configured, live: true } : { address: asset.deposit, live: false };
}
