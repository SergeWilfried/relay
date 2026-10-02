import { Link, useLocation } from 'react-router-dom';
import { fmtInt } from '../../lib/format';
import { useT } from '../../i18n';

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
  const { state } = useLocation() as { state: { amount?: number } | null };
  return <Done title={t('Liquidity added')} sub={t('{amount} FCFA · FCFA rail pool', { amount: fmtInt(state?.amount ?? 0) })} />;
}
