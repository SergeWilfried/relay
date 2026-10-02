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
}

/** 1.5 -> "1.5", 0.000123 -> "0.000123" (never exponent notation, which the server rejects). */
const plain = (n: number) => n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');

async function readError(res: Response): Promise<string> {
  try { return ((await res.json()) as { error?: string }).error ?? `Request failed (${res.status})`; } catch { return `Request failed (${res.status})`; }
}

/** Registers a sell order and returns its deposit address. Idempotent per order id, so a retry is safe. */
export async function createServerOrder(o: Order): Promise<ServerOrder> {
  const res = await apiFetch('/orders', {
    method: 'POST',
    body: JSON.stringify({ id: o.id, asset: o.from.sym, amount: plain(o.amount), providerId: o.provider?.id, phone: o.phone }),
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'Please sign in again to continue.' : await readError(res));
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
