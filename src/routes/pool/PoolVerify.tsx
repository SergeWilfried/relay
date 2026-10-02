import { useLocation, useNavigate } from 'react-router-dom';
import { KycSdk } from '../../components/Kyc';
import { useApp } from '../../state/app';

export default function PoolVerify() {
  const nav = useNavigate();
  const { state } = useLocation() as { state: { amount?: number } | null };
  const { setVerified } = useApp();
  // back to the deposit screen, which submits (and handles errors) with the amount already entered
  return (
    <div className="card">
      <KycSdk onApproved={() => { setVerified(); nav('/pool/add', { replace: true, state: { amount: state?.amount ?? 2_000_000, confirm: true } }); }} />
    </div>
  );
}
