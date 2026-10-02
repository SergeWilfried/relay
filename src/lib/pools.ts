import { useCallback, useEffect, useState } from 'react';
import { POOLS, type Pool } from './data';
import { mockFlag } from './mock';

/**
 * Pools API stand-in. Replace the body with `fetch('/api/pools')`.
 * In dev, `localStorage['relay-mock-pools'] = 'empty' | 'error'` simulates those responses.
 */
async function fetchPools(): Promise<Pool[]> {
  await new Promise((r) => setTimeout(r, 250));
  let mock: string | null = null;
  if (import.meta.env.DEV) mock = mockFlag('pools');
  if (mock === 'error') throw new Error('Pools unavailable');
  if (mock === 'empty') return [];
  return POOLS;
}

export type PoolsState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; pools: Pool[] };

// last good response: revisiting the tab shows it instantly while a refresh runs in the background
let cache: Pool[] | null = null;

export function usePools() {
  const [state, setState] = useState<PoolsState>(cache ? { status: 'ready', pools: cache } : { status: 'loading' });
  const load = useCallback(() => {
    // keep showing cached pools during a background refresh; only show the spinner when there's nothing to show
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    fetchPools().then(
      (pools) => { cache = pools; setState({ status: 'ready', pools }); },
      () => setState((s) => (s.status === 'ready' ? s : { status: 'error' })),
    );
  }, []);
  useEffect(load, [load]);
  return { state, retry: load };
}
