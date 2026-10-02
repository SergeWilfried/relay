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
