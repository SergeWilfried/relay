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
  uncountedPaid: number;
}
export const getRevenue = (days: number) => call<Revenue>(`/revenue?days=${days}`);
