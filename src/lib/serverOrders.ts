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

/** 1.5 -> "1.5", 0.000123 -> "0.000123" (never exponent notation, which the server rejects). */
const plain = (n: number) => n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');

async function readError(res: Response): Promise<string> {
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

export async function fetchServerOrder(id: string): Promise<ServerOrder | null> {
  const res = await apiFetch(`/orders/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ServerOrder;
}

export async function listServerOrders(): Promise<ServerOrder[]> {
  const res = await apiFetch('/orders');
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as { orders: ServerOrder[] }).orders;
}

/** The patch to apply to a local order so it mirrors the server's view; null when nothing changed. */
export function patchFromServer(o: Order, s: ServerOrder): Partial<Order> | null {
  const server: NonNullable<Order['server']> = { status: s.status, payout: s.payout?.status ?? null, payoutError: s.payout?.error ?? null, note: s.note, hold: s.hold?.message ?? null, refund: s.refund ?? null };
  const same = o.server && o.server.status === server.status && o.server.payout === server.payout && o.server.payoutError === server.payoutError && o.server.note === server.note && (o.server.hold ?? null) === server.hold && (o.server.refund?.status ?? null) === (server.refund?.status ?? null) && (o.server.refund?.txHash ?? null) === (server.refund?.txHash ?? null);
  const patch: Partial<Order> = same ? {} : { server };
  if (s.status === 'processing' && o.awaitingDeposit) Object.assign(patch, { awaitingDeposit: false, startedAt: s.startedAt ?? Date.now(), depositTx: s.depositTx ?? o.depositTx });
  return Object.keys(patch).length ? patch : null;
}

/** Terminal server states: nothing more to poll for. */
export const isSettled = (o: Order) => !!o.server && (o.server.status === 'underpaid' || ['paid', 'failed', 'rejected'].includes(o.server.payout ?? ''));
