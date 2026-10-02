import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { KycIntro } from '../../components/Kyc';
import { useT } from '../../i18n';
import { usePoolParam } from './usePoolParam';

export default function PoolKyc() {
  const nav = useNavigate();
  const { t } = useT();
  const { state } = useLocation();
  const p = usePoolParam();
  if (!p) return <Navigate to="/pool" replace />;
  const id = p.pool.id;
  return <div className="card"><KycIntro compact title={t('Verify to start earning')} onBack={() => nav(`/pool/add?pool=${id}`)} onStart={() => nav(`/pool/verify?pool=${id}`, { state })} /></div>;
}
