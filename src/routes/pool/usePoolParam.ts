import { useSearchParams } from 'react-router-dom';
import { POOLS, poolAsset, type Asset, type Pool } from '../../lib/data';

/** The pool a flow screen (risk, add, withdraw, ...) refers to, from `?pool=<id>`. */
export function usePoolParam(): { pool: Pool; asset: Asset } | null {
  const [sp] = useSearchParams();
  const pool = POOLS.find((p) => p.id === sp.get('pool'));
  return pool ? { pool, asset: poolAsset(pool) } : null;
}
