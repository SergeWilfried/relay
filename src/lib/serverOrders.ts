import { tr } from '../i18n';
import { apiFetch } from './http';
import type { Order } from './orders';

/** Mirror of the Worker's OrderView (worker/orders.ts). */
export interface ServerPayout {
  status: 'pending_approval' | 'approved' | 'sending' | 'paid' | 'failed' | 'rejected';
  amountFcfa: number;
  phoneMasked: string | null;
  paidAt: number | null;
  error: string | null;
}

export interface ServerOrder {
  tab: 'sell';
  id: string;
  status: 'awaiting_deposit' | 'processing' | 'underpaid';
  payout: ServerPayout | null;
  depositAddress: string;
  depositLive: boolean;
  expiresAt: number;
  startedAt: number | null;
  depositTx: string | null;
  note: string | null;
  /** set while a rule holds the payout for review */
  hold: { message: string; until: number | null } | null;
  /** a crypto refund of this order's deposit; null when there is none */
  refund: { status: 'requested' | 'approved' | 'sent'; txHash: string | null } | null;
}

/** How the customer approves a purchase's payment, from the payment provider's configuration. */
export interface BuyMethod { authType: string; instructions: { en: string[]; fr: string[] } | null; codeInstructions: { en: string[]; fr: string[] } | null }

/** Mirror of the Worker's BuyView (worker/buys.ts). */
export interface ServerBuy {
  tab: 'buy';
  id: string;
  status: 'created' | 'collecting' | 'collected' | 'delivered' | 'failed' | 'expired' | 'cancelled';
  asset: string;
  fcfa: number;
  amountUnits: string;
  destination: string;
  expiresAt: number;
  method: BuyMethod | null;
  nextStep: string | null;
  /** REDIRECT_AUTH (Wave): send the customer here to approve the payment */
  authUrl: string | null;
  failure: string | null;
  txHash: string | null;
  hold: { message: string } | null;
}

/** 1.5 -> "1.5", 0.000123 -> "0.000123" (never exponent notation, which the server rejects). */
const plain = (n: number) => n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');

export async function readError(res: Response): Promise<string> {
  // the server replies in English; known messages are translated, anything else is shown as received
  const fallback = tr('Request failed ({status})', { status: res.status });
  try { const e = ((await res.json()) as { error?: string }).error; return e ? tr(e) : fallback; } catch { return fallback; }
}

/** Registers a sell order and returns its deposit address. Idempotent per order id, so a retry is safe. */
export async function createServerOrder(o: Order): Promise<ServerOrder> {
  const res = await apiFetch('/orders', {
    method: 'POST',
    body: JSON.stringify({ id: o.id, asset: o.from.sym, amount: plain(o.amount), providerId: o.provider?.id, phone: o.phone }),
  });
  if (!res.ok) throw new Error(res.status === 401 ? tr('Please sign in again to continue.') : await readError(res));
  return (await res.json()) as ServerOrder;
}

export async function fetchServerOrder(id: string): Promise<ServerOrder | ServerBuy | import('./swapLive').ServerSwap | null> {
  const res = await apiFetch(`/orders/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ServerOrder | ServerBuy | import('./swapLive').ServerSwap;
}

/** The user's server orders: cash-outs and purchases. */
export async function listServerOrders(): Promise<{ orders: ServerOrder[]; buys: ServerBuy[]; swaps: import('./swapLive').ServerSwap[] }> {
  const res = await apiFetch('/orders');
  if (!res.ok) throw new Error(await readError(res));
  const j = (await res.json()) as { orders: ServerOrder[]; buys?: ServerBuy[]; swaps?: import('./swapLive').ServerSwap[] };
  return { orders: j.orders, buys: j.buys ?? [], swaps: j.swaps ?? [] };
}

/** Registers a purchase (the quote is fixed, nothing is charged yet). Idempotent per order id. */
export async function createServerBuy(o: Order): Promise<ServerBuy> {
  const res = await apiFetch('/orders', {
    method: 'POST',
    body: JSON.stringify({ id: o.id, tab: 'buy', asset: o.from.sym, amountFcfa: Math.round(o.amount), destination: o.wallet, providerId: o.provider?.id, phone: o.phone }),
  });
  if (!res.ok) throw new Error(res.status === 401 ? tr('Please sign in again to continue.') : await readError(res));
  return (await res.json()) as ServerBuy;
}

/** Starts the mobile money payment. For Orange Burkina Faso the one-time code goes along. */
export async function payServerBuy(id: string, preAuthCode?: string): Promise<ServerBuy> {
  const res = await apiFetch(`/orders/${encodeURIComponent(id)}/pay`, { method: 'POST', body: JSON.stringify(preAuthCode ? { preAuthCode } : {}) });
  if (!res.ok) throw new Error(res.status === 401 ? tr('Please sign in again to continue.') : await readError(res));
  return (await res.json()) as ServerBuy;
}

/** The patch to apply to a local order so it mirrors the server's view; null when nothing changed. */
export function patchFromServer(o: Order, s: ServerOrder): Partial<Order> | null {
  const server: NonNullable<Order['server']> = { status: s.status, payout: s.payout?.status ?? null, payoutError: s.payout?.error ?? null, note: s.note, hold: s.hold?.message ?? null, refund: s.refund ?? null };
  const same = o.server && o.server.status === server.status && o.server.payout === server.payout && o.server.payoutError === server.payoutError && o.server.note === server.note && (o.server.hold ?? null) === server.hold && (o.server.refund?.status ?? null) === (server.refund?.status ?? null) && (o.server.refund?.txHash ?? null) === (server.refund?.txHash ?? null);
  const patch: Partial<Order> = same ? {} : { server };
  if (s.status === 'processing' && o.awaitingDeposit) Object.assign(patch, { awaitingDeposit: false, startedAt: s.startedAt ?? Date.now(), depositTx: s.depositTx ?? o.depositTx });
  return Object.keys(patch).length ? patch : null;
}

/** The patch to apply to a local purchase so it mirrors the server's view; null when nothing changed. */
export function patchFromServerBuy(o: Order, b: ServerBuy): Partial<Order> | null {
  const same = o.buy && o.buy.status === b.status && o.buy.authUrl === b.authUrl && o.buy.nextStep === b.nextStep && o.buy.failure === b.failure && o.buy.txHash === b.txHash && (o.buy.hold?.message ?? null) === (b.hold?.message ?? null) && o.buy.amountUnits === b.amountUnits;
  if (same) return null;
  const patch: Partial<Order> = { buy: b };
  if (b.status === 'collected' && o.startedAt === null) patch.startedAt = Date.now();
  return patch;
}

/** Terminal server states: nothing more to poll for. */
export const isSettled = (o: Order) => (o.tab === 'swap' && !!o.swap && ['succeeded', 'failed', 'rejected'].includes(o.swap.status)) || (o.tab === 'buy' && !!o.buy && ['delivered', 'failed', 'expired', 'cancelled'].includes(o.buy.status)) || !!o.server && (o.server.status === 'underpaid' || ['paid', 'failed', 'rejected'].includes(o.server.payout ?? ''));
