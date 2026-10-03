import { useMemo } from 'react';
import { deriveProgress, type Order } from './orders';
import { useApp } from '../state/app';
import type { ServerLimits } from './limitsLive';

/**
 * Offline / demo fallback for the limits in worker/limits.ts, the single source of truth (test/limits.test.ts fails if these drift).
 * In live mode the numbers and the usage come from the server (`GET /api/limits`), so the Account page, the trade form and the rule
 * engine always agree: sells, buys AND swaps count, on every device.
 *  - unverified (no approved identity check): up to the KYC threshold per order and per day;
 *  - verified: 2M per transaction and day, 10M per month.
 */
export const LIMITS = {
  unverified: { perTx: 200_000, daily: 200_000, monthly: 2_000_000 },
  verified: { perTx: 2_000_000, daily: 2_000_000, monthly: 10_000_000 },
} as const;
export const KYC_THRESHOLD = 200_000;

export interface Usage { limit: number; used: number; remaining: number; pct: number }

export interface LimitState {
  /** the user's effective limits (what the Account page shows) */
  perTx: number;
  /** the verified tier's limits: an order up to these is allowed to try; above the user's own tier it asks for the identity check */
  ceiling: { perTx: number; daily: number; monthly: number };
  verified: boolean;
  kycThreshold: number;
  daily: Usage;
  monthly: Usage;
  /** the earliest moment each window resets (calendar day / month, device time) */
  dayResetsAt: Date;
  monthResetsAt: Date;
  /** null = within limits */
  check: (fcfa: number) => LimitBreach | null;
}

export type LimitBreach = { kind: 'perTx'; max: number } | { kind: 'daily'; remaining: number } | { kind: 'monthly'; remaining: number };

const usage = (limit: number, used: number): Usage => ({ limit, used, remaining: Math.max(0, limit - used), pct: Math.min(100, (used / limit) * 100) });

/** FCFA value of an order for limit purposes (what it moves through the rail). */
export const orderFcfa = (o: Order) => Math.round(o.quote.fcfaGross);

/**
 * Orders that count: submitted and not failed (an order still waiting for its deposit reserves its amount). With `server` (live mode)
 * the limits and the usage are the server's instead: they include other devices and swaps.
 */
export function computeLimits(orders: Order[], now = Date.now(), opts: { verified?: boolean; server?: ServerLimits | null } = {}): LimitState {
  const d = new Date(now);
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const counted = orders.filter((o) => o.submitted && deriveProgress(o, now).phase !== 'failed');
  const sum = (from: number) => counted.filter((o) => o.createdAt >= from).reduce((n, o) => n + orderFcfa(o), 0);
  const server = opts.server ?? null;
  const verified = server ? server.verified : !!opts.verified;
  const own = server ? server.limits : verified ? LIMITS.verified : LIMITS.unverified;
  const ceiling = server ? server.ceiling : LIMITS.verified;
  const daily = usage(own.daily, server ? server.used.day : sum(dayStart));
  const monthly = usage(own.monthly, server ? server.used.month : sum(monthStart));
  // what is left under the verified ceiling (an unverified user may try up to it: Review asks for the identity check)
  const dayLeft = Math.max(0, ceiling.daily - daily.used);
  const monthLeft = Math.max(0, ceiling.monthly - monthly.used);
  return {
    perTx: own.perTx, ceiling, verified, kycThreshold: server ? server.kycThresholdFcfa : KYC_THRESHOLD, daily, monthly,
    dayResetsAt: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
    monthResetsAt: new Date(d.getFullYear(), d.getMonth() + 1, 1),
    check: (fcfa) => {
      if (fcfa > ceiling.perTx) return { kind: 'perTx', max: ceiling.perTx };
      if (fcfa > dayLeft) return { kind: 'daily', remaining: dayLeft };
      if (fcfa > monthLeft) return { kind: 'monthly', remaining: monthLeft };
      return null;
    },
  };
}

export function useLimits(): LimitState {
  const { orders, kyc, serverLimits } = useApp();
  // recomputed when orders change; the day/month boundary is picked up on the next render
  return useMemo(() => computeLimits(orders, Date.now(), { verified: kyc === 'verified', server: serverLimits }), [orders, kyc, serverLimits]);
}

/** Does an order worth `fcfa` need an identity check the user hasn't completed? Same rule as K-01: the order, or the day's total, above the threshold. */
export function useNeedsKyc(): (fcfa: number) => boolean {
  const l = useLimits();
  return (fcfa) => !l.verified && (fcfa > l.kycThreshold || l.daily.used + fcfa > l.kycThreshold);
}
