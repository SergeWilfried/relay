import { tr } from '../i18n';
import { apiFetch } from './http';
import { readError } from './serverOrders';

/** Orders above this (FCFA) need a completed identity check. The server decides; this only avoids a pointless round trip. */
export const KYC_THRESHOLD_FCFA = 200_000;

/** Mirror of the Worker's KycView (worker/kyc.ts). */
export interface KycInfo {
  configured: boolean;
  status: 'none' | 'pending' | 'approved' | 'rejected' | 'retry';
  approved: boolean;
  thresholdFcfa: number;
  message: string | null;
}

/** The server's refusal for an unverified order above the threshold (rule K-01). */
export const kycRequiredMessage = () => tr('Verify your identity to continue.');

const ok = async (res: Response) => { if (!res.ok) throw new Error(res.status === 401 ? tr('Please sign in again to continue.') : await readError(res)); };

export async function fetchKycStatus(): Promise<KycInfo> {
  const res = await apiFetch('/kyc/status');
  await ok(res);
  return (await res.json()) as KycInfo;
}

export async function fetchKycToken(): Promise<{ token: string; userId: string; level: string }> {
  const res = await apiFetch('/kyc/token', { method: 'POST', body: '{}' });
  await ok(res);
  return (await res.json()) as { token: string; userId: string; level: string };
}

/** Asks the server to pull the result from Sumsub now (the webhook usually arrives first). */
export async function syncKyc(): Promise<KycInfo> {
  const res = await apiFetch('/kyc/sync', { method: 'POST', body: '{}' });
  await ok(res);
  return (await res.json()) as KycInfo;
}

