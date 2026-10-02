import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { KycSdk } from '../../components/Kyc';
import { useApp } from '../../state/app';
import { usePoolParam } from './usePoolParam';

export default function PoolVerify() {
  const nav = useNavigate();
  const { state } = useLocation() as { state: { amount?: number } | null };
  const { setVerified } = useApp();
  const p = usePoolParam();
  if (!p) return <Navigate to="/pool" replace />;
  // back to the deposit screen, which submits (and handles errors) with the amount already entered
  return (
    <div className="card">
      <KycSdk onApproved={() => { setVerified(); nav(`/pool/add?pool=${p.pool.id}`, { replace: true, state: { amount: state?.amount, confirm: true } }); }} />
    </div>
  );
}
