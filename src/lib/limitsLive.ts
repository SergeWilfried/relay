import { tr } from '../i18n';
import { apiFetch } from './http';
import { readError } from './serverOrders';

/** Mirror of the Worker's LimitsView (worker/rules.ts): the server's effective limits and usage. */
export interface ServerLimits {
  tier: number;
  verified: boolean;
  limits: { perTx: number; daily: number; monthly: number };
  /** the verified tier's limits: what an identity check unlocks */
  ceiling: { perTx: number; daily: number; monthly: number };
  used: { day: number; month: number };
  kycThresholdFcfa: number;
  minFcfa: number;
}

export async function fetchServerLimits(): Promise<ServerLimits> {
  const res = await apiFetch('/limits');
  if (!res.ok) throw new Error(res.status === 401 ? tr('Please sign in again to continue.') : await readError(res));
  return (await res.json()) as ServerLimits;
}
