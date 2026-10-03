/** Admin API client. Uses the ADMIN_API_KEY the admin types in; it is kept in sessionStorage only (cleared when the tab closes). */
export interface AdminPayout {
  id: string;
  order_id: string;
  user_id: string;
  provider: string;
  phone: string | null;
  operator: string | null;
  amount_fcfa: number;
  status: 'pending_approval' | 'approved' | 'sending' | 'paid' | 'failed' | 'rejected';
  provider_ref: string | null;
  attempts: number;
  error: string | null;
  created_at: number;
  paid_at: number | null;
  asset: string;
  order_amount: string;
  network: string;
  deposit_tx: string | null;
  order_note: string | null;
  /** set when a rule put the payout on hold (see worker/rules.ts) */
  hold_rules: string | null;
  hold_message: string | null;
  hold_until: number | null;
  hold_released_at: number | null;
}

const KEY = 'relay-admin-key';
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export const getKey = () => { try { return sessionStorage.getItem(KEY) ?? ''; } catch { return ''; } };
export const setKey = (k: string) => { try { k ? sessionStorage.setItem(KEY, k) : sessionStorage.removeItem(KEY); } catch { /* ignore */ } };

export class AdminAuthError extends Error {}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/admin${path}`, {
    method,
    headers: { authorization: `Bearer ${getKey()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (res.status === 401) throw new AdminAuthError('That admin key was not accepted.');
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

export const listPayouts = () => call<{ payouts: AdminPayout[] }>('/payouts').then((r) => r.payouts);
export const approve = (id: string) => call<AdminPayout>(`/payouts/${id}/approve`, 'POST');
export const retry = (id: string) => call<AdminPayout>(`/payouts/${id}/retry`, 'POST');
export const reject = (id: string, reason: string) => call<AdminPayout>(`/payouts/${id}/reject`, 'POST', { reason });
export const resolve = (id: string, outcome: 'paid' | 'failed', note: string) => call<AdminPayout>(`/payouts/${id}/resolve`, 'POST', { outcome, note });
export const releaseHold = (id: string, note: string) => call<AdminPayout>(`/payouts/${id}/release-hold`, 'POST', { note });

export interface AdminSweep {
  order_id: string;
  wallet_id: string | null;
  chain: 'ethereum' | 'solana';
  asset: string;
  amount_units: string;
  status: 'pending' | 'sending' | 'submitted' | 'failed' | 'unknown';
  attempts: number;
  tx_hash: string | null;
  tx_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export const listSweeps = () => call<{ sweeps: AdminSweep[] }>('/sweeps').then((r) => r.sweeps);
export const runSweeps = () => call<{ queued: number; processed: number }>('/sweeps/run', 'POST');
export const retrySweep = (orderId: string) => call<AdminSweep>(`/sweeps/${orderId}/retry`, 'POST');
export const resolveSweep = (orderId: string, outcome: 'submitted' | 'failed', note: string, txHash?: string) =>
  call<AdminSweep>(`/sweeps/${orderId}/resolve`, 'POST', { outcome, note, ...(txHash ? { txHash } : {}) });

export interface RevenueTotals { count: number; grossFcfa: number; platformFeeFcfa: number; pspFeeFcfa: number; payoutFcfa: number }
export interface Revenue {
  feeRates: { platform: number; psp: number; total: number };
  days: number;
  paid: RevenueTotals;
  pending: RevenueTotals;
  daily: (RevenueTotals & { day: string })[];
  byAsset: (RevenueTotals & { key: string })[];
  byOperator: (RevenueTotals & { key: string })[];
  byType: (RevenueTotals & { key: string })[];
  uncountedPaid: number;
}
export const getRevenue = (days: number) => call<Revenue>(`/revenue?days=${days}`);

export interface AdminRefund {
  id: string;
  order_id: string;
  user_id: string;
  asset: string;
  network: string;
  amount_units: string;
  destination: string;
  reason: string;
  status: 'requested' | 'approved' | 'sent' | 'cancelled';
  requested_by: string;
  approved_by: string | null;
  tx_hash: string | null;
  created_at: number;
  updated_at: number;
  events: { action: string; by_name: string; note: string | null; created_at: number }[];
}
export interface EligibleOrder { orderId: string; asset: string; network: string; reason: string; depositAmountUnits: string; payoutStatus: string | null; payoutError: string | null; suggestedDestination: string | null; createdAt: number }

const NAME_KEY = 'relay-admin-name';
export const getName = () => { try { return sessionStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } };
export const setName = (n: string) => { try { sessionStorage.setItem(NAME_KEY, n); } catch { /* ignore */ } };

export const listRefunds = () => call<{ refunds: AdminRefund[] }>('/refunds').then((r) => r.refunds);
export const listEligible = () => call<{ orders: EligibleOrder[] }>('/refunds/eligible').then((r) => r.orders);
export const createRefund = (b: { orderId: string; destination: string; reason: string; by: string; amountUnits?: string }) => call<AdminRefund>('/refunds', 'POST', b);
export const approveRefund = (id: string, by: string) => call<AdminRefund>(`/refunds/${id}/approve`, 'POST', { by });
export const markRefundSent = (id: string, by: string, txHash: string) => call<AdminRefund>(`/refunds/${id}/sent`, 'POST', { by, txHash });
export const cancelRefund = (id: string, by: string, reason: string) => call<AdminRefund>(`/refunds/${id}/cancel`, 'POST', { by, reason });

export interface AdminBuy {
  id: string;
  user_id: string;
  asset: string;
  network: string;
  fcfa: number;
  amount_units: string;
  destination: string;
  operator: string;
  provider_code: string;
  status: 'created' | 'collecting' | 'collected' | 'delivered' | 'failed' | 'expired' | 'cancelled';
  failure: string | null;
  failure_detail: string | null;
  tx_hash: string | null;
  delivered_by: string | null;
  hold_rules: string | null;
  hold_message: string | null;
  hold_until: number | null;
  hold_released_at: number | null;
  collected_at: number | null;
  delivered_at: number | null;
  created_at: number;
  events: { action: string; by_name: string; note: string | null; created_at: number }[];
}
export const listBuys = () => call<{ buys: AdminBuy[] }>('/buys').then((r) => r.buys);
export const markDelivered = (id: string, by: string, txHash: string) => call<AdminBuy>(`/buys/${id}/delivered`, 'POST', { by, txHash });
export const releaseBuyHold = (id: string, by: string, note: string) => call<AdminBuy>(`/buys/${id}/release-hold`, 'POST', { by, note });

export interface FloatRow {
  country: string;
  currency: string;
  balance: number | null;
  provider: string | null;
  floor: number;
  committedFcfa: number;
  committedCount: number;
  out24hFcfa: number;
  in24hFcfa: number;
  avgDailyOutFcfa: number;
  coverDays: number | null;
  status: 'ok' | 'low' | 'critical';
  reasons: string[];
}
export interface FloatView { provider: string; floor: number; generatedAt: number; rows: FloatRow[] | null }
export const getFloat = () => call<FloatView>('/payouts/float');
