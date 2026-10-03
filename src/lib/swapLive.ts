import { tr } from '../i18n';
import type { QuoteParams } from './api';
import { fmtCrypto, fmtInt, fmtRate } from './format';
import { apiFetch } from './http';
import type { Order } from './orders';
import type { Quote } from './quote';
import { readError } from './serverOrders';

/** Token decimals: an amount sent to the server may not have more places than the token has. */
const DECIMALS: Record<string, number> = { ETH: 18, SOL: 9, USDT: 6, USDC: 6 };
const amountText = (n: number, sym: string) => n.toFixed(Math.min(8, DECIMALS[sym] ?? 6)).replace(/0+$/, '').replace(/\.$/, '');

export interface SwapStatusInfo {
  configured: boolean;
  signerId: string | null;
  policyIds: { ethereum: string | null; solana: string | null };
  wallets: { ethereum: { address: string; ready: boolean } | null; solana: { address: string; ready: boolean } | null };
  assets: string[];
}

/** Mirror of the Worker's SwapView (worker/swaps.ts). */
export interface ServerSwap {
  tab: 'swap';
  id: string;
  status: 'created' | 'submitted' | 'succeeded' | 'failed' | 'rejected';
  from: string;
  to: string;
  amountIn: string;
  estOut: string | null;
  minOut: string | null;
  /** what was actually received, once confirmed */
  amountOut: string | null;
  crossChain: boolean;
  txHash: string | null;
  failure: string | null;
}

interface ServerQuote {
  from: string; to: string; amountIn: string; estOut: string; minOut: string; slippageBps: number; crossChain: boolean;
  fees: { type: string; usd: string }[]; expiresAt: number | null; fcfaValue: number;
}

export async function fetchSwapStatus(): Promise<SwapStatusInfo> {
  const res = await apiFetch('/swap/status');
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as SwapStatusInfo;
}

/** The signed-in user's swap quote, mapped to the same shape the rest of the app already renders. */
export async function quoteSwapLive(p: QuoteParams, amount: number): Promise<Quote> {
  const res = await apiFetch('/swap/quote', { method: 'POST', body: JSON.stringify({ from: p.from.sym, to: p.to.sym, amount: amountText(amount, p.from.sym) }) });
  if (!res.ok) throw new Error(await readError(res));
  const q = (await res.json()) as ServerQuote;
  const bal = p.balance === undefined ? p.from.balance : p.balance;
  const est = Number(q.estOut), min = Number(q.minOut);
  const rate = `1 ${q.from} = ${fmtRate(est / Number(q.amountIn))} ${q.to}`;
  const feeUsd = q.fees.reduce((n, f) => n + Number(f.usd), 0);
  const pct = `${q.slippageBps / 100}%`;
  return {
    fromAmt: fmtCrypto(amount, 2, 8), toAmt: fmtRate(est),
    fromSub: `≈ ${fmtInt(q.fcfaValue)} FCFA`, toSub: tr('At least {amount} {sym}', { amount: fmtRate(min), sym: q.to }),
    rate,
    fee: q.crossChain ? tr('Fee: ≈ ${amount} · Network fee covered', { amount: feeUsd.toFixed(2) }) : tr('Fee: included in the rate · Network fee covered'),
    rows: [
      [tr('Rate'), rate],
      [tr('Minimum received'), `${fmtRate(min)} ${q.to} (${tr('slippage {pct}', { pct })})`],
      [tr('Network fee'), tr('Covered by Relay')],
      [tr('Swap fee'), q.crossChain ? `≈ $${feeUsd.toFixed(2)}` : tr('Included in the rate')],
      [tr('Est. arrival'), q.crossChain ? tr('~1 minute') : tr('~30 seconds')],
      [tr('You receive'), `${fmtRate(est)} ${q.to}`],
    ],
    summaryFrom: `${fmtCrypto(amount, 2, 8)} ${q.from}`, summaryTo: `${fmtRate(est)} ${q.to}`,
    insufficient: bal !== null && amount > bal, fcfaGross: q.fcfaValue, toValue: est,
  };
}

/** Submits the swap (the server runs the rules, then asks Privy to execute it from the customer's own wallet). Idempotent per order id. */
export async function createServerSwap(o: Order): Promise<ServerSwap> {
  const res = await apiFetch('/swap', { method: 'POST', body: JSON.stringify({ id: o.id, from: o.from.sym, to: o.to.sym, amount: amountText(o.amount, o.from.sym) }) });
  if (!res.ok) {
    const code = ((await res.clone().json().catch(() => ({}))) as { code?: string }).code;
    const err = new Error(res.status === 401 ? tr('Please sign in again to continue.') : await readError(res)) as Error & { code?: string };
    err.code = code;
    throw err;
  }
  return (await res.json()) as ServerSwap;
}

/** The patch to apply to a local swap so it mirrors the server's view; null when nothing changed. */
export function patchFromServerSwap(o: Order, s: ServerSwap): Partial<Order> | null {
  const same = o.swap && o.swap.status === s.status && o.swap.txHash === s.txHash && o.swap.amountOut === s.amountOut && o.swap.failure === s.failure;
  return same ? null : { swap: s };
}
