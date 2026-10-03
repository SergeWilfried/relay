import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { fetchKycStatus, KYC_THRESHOLD_FCFA, type KycInfo } from '../lib/kycLive';
import { loadState, saveState } from '../lib/persist';
import type { Order } from '../lib/orders';

/** `amount` is in units of the pool's coin (e.g. 1.25 = 1.25 ETH). */
export interface PoolEvent { id: string; type: 'deposit' | 'withdrawal'; pool: string; amount: number; at: number }

interface AppState {
  /** KYC status — in production comes from the user's profile / verification partner webhook. */
  kyc: 'none' | 'verified';
  /** demo mode only: live mode takes the result from the server (Sumsub webhook) */
  setVerified: () => void;
  /** live mode: the server's view of the identity check (null while loading or in demo mode) */
  kycInfo: KycInfo | null;
  refreshKyc: () => Promise<KycInfo | null>;
  /** does an order worth this many FCFA need an identity check the user hasn't completed? */
  needsKyc: (fcfa: number) => boolean;
  /** coins the user has provided to each pool, by pool id, in that coin's units (missing / 0 = not joined). */
  positions: Record<string, number>;
  setPosition: (pool: string, amount: number) => void;
  poolEvents: PoolEvent[];
  addPoolEvent: (type: PoolEvent['type'], pool: string, amount: number) => void;
  /** submitted orders, newest first. Progress is derived from timestamps (see lib/orders). */
  orders: Order[];
  addOrder: (o: Order) => void;
  updateOrder: (id: string, patch: Partial<Order>) => void;
  removeOrder: (id: string) => void;
}

const Ctx = createContext<AppState | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('AppProvider missing');
  return c;
};

interface Saved { kyc: 'none' | 'verified'; positions: Record<string, number>; poolEvents: PoolEvent[]; orders: Order[] }

export function AppProvider({ children }: { children: ReactNode }) {
  const saved = loadState<Partial<Saved>>('app', {});
  const auth = useAuth();
  const live = auth.mode === 'privy';
  const [localKyc, setKyc] = useState<'none' | 'verified'>(saved.kyc ?? 'none');
  const [kycInfo, setKycInfo] = useState<KycInfo | null>(null);
  const refreshKyc = useCallback(async () => {
    if (!live) return null;
    try { const k = await fetchKycStatus(); setKycInfo(k); return k; } catch { return null; }
  }, [live]);
  useEffect(() => { void refreshKyc(); }, [refreshKyc]);
  // live: only the server can say a user is verified (the saved flag is ignored)
  const kyc: 'none' | 'verified' = live ? (kycInfo?.approved ? 'verified' : 'none') : localKyc;
  const threshold = kycInfo?.thresholdFcfa ?? KYC_THRESHOLD_FCFA;
  const needsKyc = (fcfa: number) => kyc !== 'verified' && fcfa > threshold;
  // (an older build stored one FCFA `position`; it is dropped: pools are crypto-only now)
  const [positions, setPositions] = useState<Record<string, number>>(saved.positions ?? {});
  const [poolEvents, setPoolEvents] = useState<PoolEvent[]>(saved.poolEvents ?? []);
  const [orders, setOrders] = useState<Order[]>(saved.orders ?? []);

  // everything the user would expect to survive a reload
  useEffect(() => { saveState('app', { kyc: localKyc, positions, poolEvents, orders } satisfies Saved); }, [localKyc, positions, poolEvents, orders]);

  const setPosition = (pool: string, amount: number) =>
    setPositions((p) => {
      const next = { ...p, [pool]: Math.max(0, amount) };
      if (next[pool] === 0) delete next[pool];
      return next;
    });
  const addPoolEvent = (type: PoolEvent['type'], pool: string, amount: number) =>
    setPoolEvents((l) => [{ id: Date.now().toString(36), type, pool, amount, at: Date.now() }, ...l]);
  const addOrder = (o: Order) => setOrders((l) => [o, ...l.filter((x) => x.id !== o.id)]);
  const updateOrder = (id: string, patch: Partial<Order>) => setOrders((l) => l.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const removeOrder = (id: string) => setOrders((l) => l.filter((o) => o.id !== id));

  return (
    <Ctx.Provider value={{ kyc, setVerified: () => setKyc('verified'), kycInfo, refreshKyc, needsKyc, positions, setPosition, poolEvents, addPoolEvent, orders, addOrder, updateOrder, removeOrder }}>
      {children}
    </Ctx.Provider>
  );
}
