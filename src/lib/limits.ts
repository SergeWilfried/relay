import { useMemo } from 'react';
import { deriveProgress, type Order } from './orders';
import { useApp } from '../state/app';

/**
 * Transaction limits, in FCFA. PLACEHOLDER VALUES: set them from your compliance policy.
 * They are enforced in the app (trade form) and shown on the Account page. The server does not enforce
 * them yet (it doesn't know a user's KYC status), so treat this as a UX guard, not a control.
 */
export const LIMITS = { perTx: 5_000_000, daily: 10_000_000, monthly: 50_000_000 } as const;

export interface Usage { limit: number; used: number; remaining: number; pct: number }

export interface LimitState {
  perTx: number;
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

/** Orders that count: submitted and not failed (an order still waiting for its deposit reserves its amount). */
export function computeLimits(orders: Order[], now = Date.now()): LimitState {
  const d = new Date(now);
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const counted = orders.filter((o) => o.submitted && deriveProgress(o, now).phase !== 'failed');
  const sum = (from: number) => counted.filter((o) => o.createdAt >= from).reduce((n, o) => n + orderFcfa(o), 0);
  const daily = usage(LIMITS.daily, sum(dayStart));
  const monthly = usage(LIMITS.monthly, sum(monthStart));
  return {
    perTx: LIMITS.perTx, daily, monthly,
    dayResetsAt: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
    monthResetsAt: new Date(d.getFullYear(), d.getMonth() + 1, 1),
    check: (fcfa) => {
      if (fcfa > LIMITS.perTx) return { kind: 'perTx', max: LIMITS.perTx };
      if (fcfa > daily.remaining) return { kind: 'daily', remaining: daily.remaining };
      if (fcfa > monthly.remaining) return { kind: 'monthly', remaining: monthly.remaining };
      return null;
    },
  };
}

export function useLimits(): LimitState {
  const { orders } = useApp();
  // recomputed when orders change; the day/month boundary is picked up on the next render
  return useMemo(() => computeLimits(orders), [orders]);
}
