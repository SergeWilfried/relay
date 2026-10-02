import { Link, useLocation } from 'react-router-dom';
import { useT } from '../../i18n';
import { fmtCrypto } from '../../lib/format';
import { usePoolParam } from './usePoolParam';

export function Done({ title, sub }: { title: string; sub: string }) {
  const { t } = useT();
  return (
    <div className="done-card">
      <div className="check">✓</div>
      <div className="status-t">{title}</div>
      <div className="status-s">{sub}</div>
      <Link to="/pool" className="btn sec fit" style={{ textDecoration: 'none' }}>{t('Back to pools')}</Link>
    </div>
  );
}

export default function PoolDone() {
  const { t } = useT();
  const p = usePoolParam();
  const { state } = useLocation() as { state: { amount?: number } | null };
  const amount = p ? fmtCrypto(state?.amount ?? 0, 2, p.asset.dec) : '0';
  return <Done title={t('Liquidity added')} sub={t('{amount} {sym} · {name} pool', { amount, sym: p?.pool.sym ?? '', name: p?.pool.name ?? '' })} />;
}
