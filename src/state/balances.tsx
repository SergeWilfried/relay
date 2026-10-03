import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ASSETS } from '../lib/data';
import { fetchEthereumBalances, fetchSolanaBalance } from '../lib/balances';

type Status = 'loading' | 'ready' | 'error';

interface BalancesState {
  /** Balance of `sym` in the user's Relay wallet. null = unknown (no wallet on that network, still loading, or the read failed). */
  get: (sym: string) => number | null;
  status: Status;
  refresh: () => void;
}

const Ctx = createContext<BalancesState | null>(null);
export const useBalances = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('BalancesProvider missing');
  return c;
};

const REFRESH_MS = 30_000;

export function BalancesProvider({ children }: { children: ReactNode }) {
  const { mode, wallets } = useAuth();
  const TEST = typeof localStorage !== 'undefined' && !!localStorage.getItem('relay-test-token'); // TEMPORARY TEST PATCH
  const [values, setValues] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<Status>('loading');
  const eth = wallets.Ethereum;
  const sol = wallets.Solana;
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (mode === 'demo' || TEST) return;
    const id = ++seq.current;
    const next: Record<string, number> = {};
    let failed = false;
    await Promise.all([
      eth ? fetchEthereumBalances(eth).then((b) => Object.assign(next, b), () => { failed = true; }) : null,
      sol ? fetchSolanaBalance(sol).then((b) => { next.SOL = b; }, () => { failed = true; }) : null,
    ]);
    if (id !== seq.current) return; // a newer request superseded this one
    // keep the last known value for anything that failed to refresh
    setValues((prev) => ({ ...prev, ...next }));
    setStatus(failed ? 'error' : 'ready');
  }, [mode, eth, sol]);

  useEffect(() => {
    if (mode === 'demo' || TEST) return;
    setStatus('loading');
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    const onVis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [mode, load]);

  const value = useMemo<BalancesState>(() => ({
    get: (sym) => (mode === 'demo' || TEST ? ASSETS.find((a) => a.sym === sym)?.balance ?? null : values[sym] ?? null),
    status: mode === 'demo' ? 'ready' : status,
    refresh: () => { void load(); },
  }), [mode, values, status, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
