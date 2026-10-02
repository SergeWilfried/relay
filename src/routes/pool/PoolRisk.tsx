import { Navigate, useNavigate } from 'react-router-dom';
import { BackHeader } from '../../components/BackHeader';
import { useT } from '../../i18n';
import { usePoolParam } from './usePoolParam';

export default function PoolRisk() {
  const nav = useNavigate();
  const { t } = useT();
  const p = usePoolParam();
  if (!p) return <Navigate to="/pool" replace />;
  const sym = p.pool.sym;
  return (
    <div className="card">
      <BackHeader title={t('Before you deposit')} to={`/pool/${p.pool.id}`} />
      <div className="risk">
        <div><b>{t('Price exposure')}</b><p>{t('You deposit {sym} and withdraw {sym}. Its value in FCFA can rise or fall while it is in the pool.', { sym })}</p></div>
        <div><b>{t('Utilization risk')}</b><p>{t('Your funds help settle swaps and cash-outs. At high utilization, withdrawals can take up to 24h.')}</p></div>
        <div><b>{t('Not a bank deposit')}</b><p>{t('Yield comes from transaction fees and is not guaranteed or state-insured.')}</p></div>
      </div>
      <button className="btn" onClick={() => nav(`/pool/add?pool=${p.pool.id}`, { replace: true })}>{t('I understand — continue')}</button>
    </div>
  );
}
