import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadState, saveState } from '../lib/persist';
import type { Order } from '../lib/orders';

export interface PoolEvent { id: string; type: 'deposit' | 'withdrawal'; amount: number; at: number }

interface AppState {
  /** KYC status — in production comes from the user's profile / verification partner webhook. */
  kyc: 'none' | 'verified';
  setVerified: () => void;
  /** FCFA currently provided to the rail pool; 0 = not joined. */
  position: number;
  setPosition: (n: number) => void;
  poolEvents: PoolEvent[];
  addPoolEvent: (type: PoolEvent['type'], amount: number) => void;
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

interface Saved { kyc: 'none' | 'verified'; position: number; poolEvents: PoolEvent[]; orders: Order[] }

export function AppProvider({ children }: { children: ReactNode }) {
  const saved = loadState<Partial<Saved>>('app', {});
  const [kyc, setKyc] = useState<'none' | 'verified'>(saved.kyc ?? 'none');
  const [position, setPosition] = useState(saved.position ?? 0);
  const [poolEvents, setPoolEvents] = useState<PoolEvent[]>(saved.poolEvents ?? []);
  const [orders, setOrders] = useState<Order[]>(saved.orders ?? []);

  // everything the user would expect to survive a reload
  useEffect(() => { saveState('app', { kyc, position, poolEvents, orders } satisfies Saved); }, [kyc, position, poolEvents, orders]);

  const addPoolEvent = (type: PoolEvent['type'], amount: number) =>
    setPoolEvents((l) => [{ id: Date.now().toString(36), type, amount, at: Date.now() }, ...l]);
  const addOrder = (o: Order) => setOrders((l) => [o, ...l.filter((x) => x.id !== o.id)]);
  const updateOrder = (id: string, patch: Partial<Order>) => setOrders((l) => l.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const removeOrder = (id: string) => setOrders((l) => l.filter((o) => o.id !== id));

  return (
    <Ctx.Provider value={{ kyc, setVerified: () => setKyc('verified'), position, setPosition, poolEvents, addPoolEvent, orders, addOrder, updateOrder, removeOrder }}>
      {children}
    </Ctx.Provider>
  );
}
