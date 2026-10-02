import { useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApp } from '../state/app';
import { isSettled, listServerOrders, patchFromServer } from './serverOrders';

const POLL_MS = 6000;

/**
 * Keeps server-backed orders in step with the server (deposit confirmed, payout approved / paid / failed).
 * Polls only while at least one such order is unsettled. In production, swap polling for push (SSE / websocket).
 */
export function useOrderSync() {
  const { mode } = useAuth();
  const { orders, updateOrder } = useApp();
  const ref = useRef(orders);
  ref.current = orders;
  const active = mode === 'privy' && orders.some((o) => o.synced && o.submitted && !isSettled(o));

  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = async () => {
      try {
        const server = await listServerOrders();
        if (stop) return;
        for (const s of server) {
          const local = ref.current.find((o) => o.id === s.id && o.synced);
          const patch = local && patchFromServer(local, s);
          if (local && patch) updateOrder(local.id, patch);
        }
      } catch { /* offline or transient: try again next tick */ }
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => { stop = true; clearInterval(t); };
  }, [active, updateOrder]);
}
