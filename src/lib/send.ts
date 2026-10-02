import { ERC20 } from './balances';

/** Decimal amount (as a number) to base units without float error: 0.1 ETH -> 100000000000000000n */
export function toUnits(amount: number, decimals: number): bigint {
  const [whole, frac = ''] = amount.toFixed(decimals).split('.');
  return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals));
}

const pad32 = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');

export type SendPlan =
  | { kind: 'evm'; to: string; value: `0x${string}`; data?: string; chainId: 1 }
  | { kind: 'sol'; to: string; lamports: bigint };

/** What to send for a sell deposit. null = this asset can't be sent from a Relay wallet (e.g. BTC). */
export function planSend(sym: string, deposit: string, amount: number): SendPlan | null {
  if (amount <= 0) return null;
  if (sym === 'ETH') return { kind: 'evm', to: deposit, value: `0x${toUnits(amount, 18).toString(16)}`, chainId: 1 };
  const token = ERC20[sym];
  if (token) {
    // ERC-20 transfer(address,uint256)
    const data = `0xa9059cbb${pad32(deposit)}${pad32(toUnits(amount, token.decimals).toString(16))}`;
    return { kind: 'evm', to: token.address, value: '0x0', data, chainId: 1 };
  }
  if (sym === 'SOL') return { kind: 'sol', to: deposit, lamports: toUnits(amount, 9) };
  return null;
}
